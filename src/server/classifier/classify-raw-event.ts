import { db } from "@/lib/db";
import { resolveAttendees } from "@/server/dpoh-registry/resolve-attendee";
import { classifyMeeting, type ClassificationResult } from "./classify-meeting";

export interface ClassifyEventResult {
  detectedMeetingId: string;
  verdict: ClassificationResult["verdict"];
  confidence: number;
  hadDpoh: boolean;
  reasonCount: number;
  attendeeCount: number;
}

/**
 * Classify a single RawCalendarEvent. Idempotent — re-running replaces
 * the existing DetectedMeeting row's reasons + attendees cleanly.
 */
export async function classifyRawEvent(rawEventId: string): Promise<ClassifyEventResult> {
  const event = await db.rawCalendarEvent.findUniqueOrThrow({
    where: { id: rawEventId },
    select: {
      id: true,
      tenantId: true,
      title: true,
      startsAt: true,
      endsAt: true,
      attendees: true,
    },
  });

  const attendeesArr = event.attendees as Array<{
    email: string | null;
    displayName: string | null;
  }>;
  const resolutions = await resolveAttendees(event.tenantId, attendeesArr);

  const result = classifyMeeting(
    { title: event.title, startsAt: event.startsAt, endsAt: event.endsAt },
    resolutions,
  );

  // Pick employeeEmail (first internal) and institutionId (highest-priority gov)
  const employeeEmail = resolutions.find((r) => r.isInternal)?.email ?? "unknown@unknown";
  const institutionId =
    resolutions.find((r) => r.signal === "gov-with-named-dpoh")?.institutionId ??
    resolutions.find((r) => r.signal === "gov-attendee-unknown-role")?.institutionId ??
    resolutions.find((r) => r.institutionId)?.institutionId ??
    null;

  const detected = await db.$transaction(async (tx) => {
    // Wipe prior reasons + attendees if this event was previously classified
    const existing = await tx.detectedMeeting.findUnique({ where: { rawEventId } });
    if (existing) {
      await tx.classificationReason.deleteMany({ where: { meetingId: existing.id } });
      await tx.meetingAttendee.deleteMany({ where: { meetingId: existing.id } });
    }

    const meeting = await tx.detectedMeeting.upsert({
      where: { rawEventId },
      create: {
        tenantId: event.tenantId,
        rawEventId,
        title: event.title ?? "(no title)",
        startAt: event.startsAt ?? new Date(),
        endAt: event.endsAt ?? new Date(),
        employeeEmail,
        institutionId,
        hadDpoh: result.hadDpoh,
        classification: result.verdict,
        classificationConfidence: result.confidence,
        status: result.verdict === "needs-info" ? "needs-info" : "auto-drafted",
      },
      update: {
        title: event.title ?? "(no title)",
        startAt: event.startsAt ?? new Date(),
        endAt: event.endsAt ?? new Date(),
        employeeEmail,
        institutionId,
        hadDpoh: result.hadDpoh,
        classification: result.verdict,
        classificationConfidence: result.confidence,
        status: result.verdict === "needs-info" ? "needs-info" : "auto-drafted",
      },
    });

    if (result.reasons.length > 0) {
      await tx.classificationReason.createMany({
        data: result.reasons.map((r) => ({
          meetingId: meeting.id,
          ok: r.ok,
          text: r.text,
          citation: r.citation,
          weight: r.weight,
        })),
      });
    }

    const attendeeRows = resolutions
      .filter((r) => r.email)
      .map((r) => ({
        meetingId: meeting.id,
        name: r.displayName ?? r.email ?? "(unknown)",
        email: r.email!,
        resolvedOfficialId: r.resolvedOfficialId,
        isInternal: r.isInternal,
        isDpoh: r.isDpoh,
      }));
    if (attendeeRows.length > 0) {
      await tx.meetingAttendee.createMany({ data: attendeeRows });
    }

    return { meetingId: meeting.id, attendeeCount: attendeeRows.length };
  });

  return {
    detectedMeetingId: detected.meetingId,
    verdict: result.verdict,
    confidence: result.confidence,
    hadDpoh: result.hadDpoh,
    reasonCount: result.reasons.length,
    attendeeCount: detected.attendeeCount,
  };
}
