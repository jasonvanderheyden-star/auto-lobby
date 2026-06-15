import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

// All actions that can appear in the audit trail.
// Extend here — never use raw strings elsewhere.
export type AuditAction =
  | "dpoh-confirmed"
  | "dpoh-reset"
  | "non-dpoh-confirmed"
  | "meeting-excluded"
  | "meeting-included"
  | "batch-certified"
  | "subjects-updated"
  | "calendar-connected"
  | "calendar-disconnected"
  | "tenant-created"
  | "tenant-updated"
  | "registry-refreshed"
  | "member-bootstrapped"
  | "member-roles-updated"
  | "mcr-routed"            // draft routed to client RO for certification
  | "mcr-routing-revoked"
  | "engagement-suggested"  // auto-suggest proposed a client attribution
  | "engagement-confirmed"  // consultant confirmed the attribution
  | "engagement-reassigned";

export type ActorRole =
  | "registrant"   // in-house GR team member
  | "lobbyist"     // named lobbyist on the registration
  | "agency-admin" // GR firm admin acting on behalf of client
  | "agency-staff" // GR firm staff preparing drafts for a client
  | "consultant"   // registered consultant lobbyist (certifies own MCRs)
  | "system";      // background job

// Optional fields accept explicit `undefined` so call sites can pass
// conditional expressions under exactOptionalPropertyTypes.
export interface AppendAuditEventInput {
  tenantId: string;
  actor: string;                   // userId or "system"
  actorRole?: ActorRole | undefined;
  onBehalfOfTenantId?: string | undefined; // for agency motion — client tenant id
  action: AuditAction;
  subject: string;                 // entity id being acted on
  payload?: Record<string, unknown> | undefined;
  tx?: Prisma.TransactionClient | undefined; // pass when inside a transaction
}

export async function appendAuditEvent(input: AppendAuditEventInput): Promise<void> {
  const client = input.tx ?? db;
  await client.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actor: input.actor,
      actorRole: input.actorRole ?? null,
      onBehalfOfTenantId: input.onBehalfOfTenantId ?? null,
      action: input.action,
      subject: input.subject,
      ...(input.payload !== undefined
        ? { payload: input.payload as Prisma.InputJsonValue }
        : {}),
    },
  });
}
