import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

// Hardcoded MVP defaults for Deep Sky. Future: read from OrgProfile.
const DEFAULT_SUBJECTS_FOR_DEEP_SKY = [
  "Environment",
  "Climate Change",
  "Energy",
  "Science and Technology",
  "Industry",
];

export interface DraftMcrInput {
  meetingId: string;
  subjects: Array<{ subjectId: string; source: string }>;
  institutionId: string | null;
  namedLobbyists: Array<{ name: string; email: string }>;
  description: string | null;
  descriptionSource: string | null;
  provenance: Record<string, { value: unknown; source: string; confidence: number }>;
}

export interface GenerateResult {
  draftMcrId: string;
  meetingId: string;
  subjectCount: number;
  namedLobbyistCount: number;
}

/**
 * Generate (or regenerate) a DraftMcr for a DetectedMeeting.
 * Idempotent: upserts on meetingId. Field provenance tracks where each
 * pre-filled value came from per the description-source levels in CLAUDE.md.
 */
export async function generateDraftMcr(detectedMeetingId: string): Promise<GenerateResult> {
  const meeting = await db.detectedMeeting.findUniqueOrThrow({
    where: { id: detectedMeetingId },
    select: {
      id: true,
      tenantId: true,
      title: true,
      startAt: true,
      institutionId: true,
      classification: true,
      attendees: {
        select: {
          name: true,
          email: true,
          isInternal: true,
          isDpoh: true,
        },
      },
    },
  });

  const subjects = DEFAULT_SUBJECTS_FOR_DEEP_SKY.map((s) => ({
    subjectId: s,
    source: "level-0",
  }));

  const namedLobbyists = meeting.attendees
    .filter((a) => a.isInternal && a.email)
    .map((a) => ({
      name: a.name || a.email,
      email: a.email,
    }));

  const provenance: DraftMcrInput["provenance"] = {
    subjects: { value: subjects, source: "level-0", confidence: 0.6 },
    institutionId: {
      value: meeting.institutionId,
      source: meeting.institutionId ? "level-1" : "none",
      confidence: meeting.institutionId ? 0.85 : 0,
    },
    namedLobbyists: { value: namedLobbyists, source: "level-1", confidence: 0.9 },
    communicationDate: { value: meeting.startAt.toISOString(), source: "level-2", confidence: 1.0 },
  };

  const draftMcr = await db.draftMcr.upsert({
    where: { meetingId: detectedMeetingId },
    create: {
      meetingId: detectedMeetingId,
      subjects: subjects,
      institutionId: meeting.institutionId,
      namedLobbyists: namedLobbyists,
      description: null,
      descriptionSource: null,
      provenance: provenance as Prisma.InputJsonValue,
    },
    update: {
      subjects: subjects,
      institutionId: meeting.institutionId,
      namedLobbyists: namedLobbyists,
      provenance: provenance as Prisma.InputJsonValue,
    },
  });

  return {
    draftMcrId: draftMcr.id,
    meetingId: detectedMeetingId,
    subjectCount: subjects.length,
    namedLobbyistCount: namedLobbyists.length,
  };
}
