"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";

export async function updateMcrSubjectsAction(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  const draftMcrId = formData.get("draftMcrId");
  const raw = formData.get("oclCodes");
  if (typeof draftMcrId !== "string" || typeof raw !== "string") {
    throw new Error("Missing required fields");
  }

  let selectedOclCodes: number[];
  try {
    selectedOclCodes = JSON.parse(raw) as number[];
  } catch {
    throw new Error("Invalid oclCodes payload");
  }

  const draft = await db.draftMcr.findFirst({
    where: { id: draftMcrId, meeting: { tenantId: ctx.tenantId } },
    select: {
      id: true,
      provenance: true,
      meeting: {
        select: {
          id: true,
          attendees: {
            select: { resolvedOfficialId: true, name: true, isDpoh: true },
          },
        },
      },
    },
  });
  if (!draft) throw new Error("Draft not found");

  const subjects = selectedOclCodes.map((code) => ({ oclCode: code, source: "manual" }));
  const prevProvenance = (draft.provenance ?? {}) as Record<string, unknown>;
  const newProvenance = {
    ...prevProvenance,
    subjects: { value: subjects, source: "manual", confidence: 1.0 },
  };

  await db.draftMcr.update({
    where: { id: draftMcrId },
    data: { subjects, provenance: newProvenance },
  });

  // Upsert a DpohSubjectPreference for each confirmed DPOH on this meeting
  const dpohAttendees = draft.meeting.attendees.filter(
    (a) => a.isDpoh === true && a.resolvedOfficialId,
  );

  for (const attendee of dpohAttendees) {
    await db.dpohSubjectPreference.upsert({
      where: {
        tenantId_publicOfficialId: {
          tenantId: ctx.tenantId,
          publicOfficialId: attendee.resolvedOfficialId!,
        },
      },
      create: {
        tenantId: ctx.tenantId,
        publicOfficialId: attendee.resolvedOfficialId!,
        oclCodes: selectedOclCodes.map(String),
        confirmedBy: userId,
      },
      update: {
        oclCodes: selectedOclCodes.map(String),
        confirmedBy: userId,
      },
    });
  }

  await db.auditEvent.create({
    data: {
      tenantId: ctx.tenantId,
      actor: userId,
      action: "subjects-updated",
      subject: draftMcrId,
      payload: {
        oclCodes: selectedOclCodes,
        count: selectedOclCodes.length,
        dpohPreferencesUpdated: dpohAttendees.length,
      },
    },
  });

  redirect("/filings");
}
