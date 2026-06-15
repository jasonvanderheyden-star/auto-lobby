"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";
import { appendAuditEvent } from "@/server/audit-log/append";
import { auth } from "@clerk/nextjs/server";

const UpdateRegistrationSchema = z.object({
  registrationId: z.string().max(50).optional().nullable(),
  registrationExpiresAt: z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      if (!v || v.trim() === "") return null;
      const d = new Date(v);
      if (isNaN(d.getTime())) throw new Error("Invalid date");
      return d;
    }),
});

export async function updateRegistrationAction(formData: FormData): Promise<void> {
  const ctx = await getTenantContext();
  const { userId } = await auth();

  const rawId = formData.get("registrationId") as string | null;
  const raw = {
    registrationId: rawId === "" ? null : rawId,
    registrationExpiresAt: formData.get("registrationExpiresAt") as string | null,
  };

  const parsed = UpdateRegistrationSchema.parse(raw);

  await db.tenant.update({
    where: { id: ctx.tenantId },
    data: {
      registrationId: parsed.registrationId ?? null,
      registrationExpiresAt: parsed.registrationExpiresAt,
    },
  });

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId ?? "system",
    actorRole: "registrant",
    action: "tenant-updated",
    subject: ctx.tenantId,
    payload: { fields: ["registrationId", "registrationExpiresAt"] },
  });

  revalidatePath("/settings/registration");
  revalidatePath("/filings");
}
