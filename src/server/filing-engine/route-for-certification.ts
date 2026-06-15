/**
 * src/server/filing-engine/route-for-certification.ts
 *
 * Routed certification (agency motion, use case 2b):
 * agency staff prepare a month's draft MCRs for a client tenant, then route
 * the batch to the client's Responsible Officer (RO) via a single-use
 * tokenized link. Non-negotiable #1 is preserved — the RO personally
 * reviews, types their name, and clicks Certify on /certify/<token>.
 *
 * Token design:
 *  - ONE token covers the whole batch (every uncertified "lobbying" draft
 *    of the tenant/month at routing time).
 *  - 32 random bytes → base64url. Only the SHA-256 hex hash is persisted
 *    (DraftMcr.routingTokenHash); the raw token exists exactly once, in the
 *    return value of routeBatchForCertification.
 *  - 14-day expiry. The hash is cleared on certification (single use) and
 *    on revocation. Re-routing a month overwrites the hash, which silently
 *    invalidates any previously issued link for that month.
 *
 * TODO(transactional-email): no email-sending infra exists yet. The caller
 * surfaces the /certify/<token> URL exactly once and the agency staffer
 * pastes it into their own email to the RO. Replace with a transactional
 * email provider (Canadian-resident) in a later chunk.
 */

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { appendAuditEvent, type ActorRole } from "@/server/audit-log/append";

export const ROUTING_TOKEN_TTL_DAYS = 14;

/** Audit roles an agency routing actor may carry — checked against ActorRole. */
const AGENCY_ACTOR_ROLES = ["agency-staff", "agency-admin"] as const satisfies readonly ActorRole[];

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM");

const routeInputSchema = z.object({
  tenantId: z.string().min(1),
  month: monthSchema,
  routedToEmail: z.string().email().transform((v) => v.toLowerCase()),
  routedByUserId: z.string().min(1),
  onBehalfOf: z.object({
    actorRole: z.enum(AGENCY_ACTOR_ROLES),
  }),
});

export type RouteBatchInput = z.input<typeof routeInputSchema>;

export type RouteBatchResult =
  | { ok: true; rawToken: string; count: number; expiresAt: Date }
  | { ok: false; reason: "no-drafts" };

/** SHA-256 hex digest of a raw routing token. The raw token is never stored. */
export function hashRoutingToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/** [start, end) UTC range for a "YYYY-MM" month key. */
function monthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 1)),
  };
}

/**
 * Routes every uncertified "lobbying" draft MCR of `tenantId`/`month` to the
 * client's RO. Returns the raw token exactly once — the caller shows it once
 * and must never persist or console.log it.
 */
export async function routeBatchForCertification(
  input: RouteBatchInput,
): Promise<RouteBatchResult> {
  const parsed = routeInputSchema.parse(input);
  const { tenantId, month, routedToEmail, routedByUserId, onBehalfOf } = parsed;
  const { start, end } = monthRange(month);

  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId,
        classification: "lobbying",
        startAt: { gte: start, lt: end },
      },
      certifiedAt: null,
    },
    select: { id: true },
  });

  if (drafts.length === 0) return { ok: false, reason: "no-drafts" };

  const rawToken = randomBytes(32).toString("base64url");
  const routingTokenHash = hashRoutingToken(rawToken);
  const expiresAt = new Date(
    Date.now() + ROUTING_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const routedForCertificationAt = new Date();

  await db.$transaction(async (tx) => {
    await tx.draftMcr.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: {
        routedForCertificationAt,
        routedToEmail,
        routingTokenHash,
        routingTokenExpiresAt: expiresAt,
        routedByUserId,
      },
    });

    await appendAuditEvent({
      tenantId,
      actor: routedByUserId,
      actorRole: onBehalfOf.actorRole,
      onBehalfOfTenantId: tenantId,
      action: "mcr-routed",
      subject: tenantId,
      payload: {
        month,
        count: drafts.length,
        // Full email is acceptable in the DB audit payload (PII stays in
        // Postgres, never in logs) — do NOT console.log this payload.
        routedToEmail,
        draftMcrIds: drafts.map((d) => d.id),
        expiresAt: expiresAt.toISOString(),
      },
      tx,
    });
  });

  return { ok: true, rawToken, count: drafts.length, expiresAt };
}

const revokeInputSchema = z.object({
  tenantId: z.string().min(1),
  month: monthSchema,
  revokedByUserId: z.string().min(1),
  actorRole: z.enum(AGENCY_ACTOR_ROLES),
});

export type RevokeRoutingInput = z.input<typeof revokeInputSchema>;

/**
 * Clears routing fields on every still-uncertified routed draft of the
 * tenant/month, invalidating any outstanding certification link.
 */
export async function revokeRouting(
  input: RevokeRoutingInput,
): Promise<{ count: number }> {
  const { tenantId, month, revokedByUserId, actorRole } =
    revokeInputSchema.parse(input);
  const { start, end } = monthRange(month);

  let count = 0;
  await db.$transaction(async (tx) => {
    const result = await tx.draftMcr.updateMany({
      where: {
        meeting: { tenantId, startAt: { gte: start, lt: end } },
        certifiedAt: null,
        routedForCertificationAt: { not: null },
      },
      data: {
        routedForCertificationAt: null,
        routedToEmail: null,
        routingTokenHash: null,
        routingTokenExpiresAt: null,
        routedByUserId: null,
      },
    });
    count = result.count;

    await appendAuditEvent({
      tenantId,
      actor: revokedByUserId,
      actorRole,
      onBehalfOfTenantId: tenantId,
      action: "mcr-routing-revoked",
      subject: tenantId,
      payload: { month, count },
      tx,
    });
  });

  return { count };
}

// ─── Token lookup (used by /certify/[token]) ───────────────────────────────

export interface RoutedBatch {
  tenant: {
    id: string;
    name: string;
    productName: string | null;
    logoUrl: string | null;
    brandColor: string | null;
    supportEmail: string | null;
    agency: {
      name: string;
      productName: string | null;
      logoUrl: string | null;
      brandColor: string | null;
      supportEmail: string | null;
    } | null;
  };
  /** "YYYY-MM" derived from the routed drafts' meeting dates. */
  month: string;
  routedToEmail: string;
  expiresAt: Date;
  drafts: Array<{
    id: string;
    subjects: unknown;
    provenance: unknown;
    meeting: {
      id: string;
      title: string;
      startAt: Date;
      institution: { name: string; acronym: string | null } | null;
      attendees: Array<{
        id: string;
        name: string;
        email: string;
        isInternal: boolean;
        isDpoh: boolean | null;
      }>;
    };
  }>;
}

/**
 * Resolves a raw routing token to its batch of un-expired, un-certified
 * drafts. This lookup is intentionally NOT tenant-scoped — the token itself
 * is the authorization (it identifies exactly one tenant's batch via the
 * stored hash; 256 bits of entropy, single use, 14-day TTL).
 *
 * Returns null for unknown, expired, or fully-certified tokens.
 */
export async function findRoutedBatchByToken(
  rawToken: string,
): Promise<RoutedBatch | null> {
  if (!/^[A-Za-z0-9_-]{20,}$/.test(rawToken)) return null;
  const routingTokenHash = hashRoutingToken(rawToken);

  const drafts = await db.draftMcr.findMany({
    where: {
      routingTokenHash,
      routingTokenExpiresAt: { gt: new Date() },
      certifiedAt: null,
    },
    select: {
      id: true,
      subjects: true,
      provenance: true,
      routedToEmail: true,
      routingTokenExpiresAt: true,
      meeting: {
        select: {
          id: true,
          tenantId: true,
          title: true,
          startAt: true,
          institution: { select: { name: true, acronym: true } },
          attendees: {
            select: {
              id: true,
              name: true,
              email: true,
              isInternal: true,
              isDpoh: true,
            },
          },
        },
      },
    },
    orderBy: { meeting: { startAt: "asc" } },
  });

  const firstDraft = drafts[0];
  if (!firstDraft) return null;

  // All drafts behind one token belong to one tenant by construction — verify.
  const tenantId = firstDraft.meeting.tenantId;
  if (drafts.some((d) => d.meeting.tenantId !== tenantId)) return null;

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      productName: true,
      logoUrl: true,
      brandColor: true,
      supportEmail: true,
      agency: {
        select: {
          name: true,
          productName: true,
          logoUrl: true,
          brandColor: true,
          supportEmail: true,
        },
      },
    },
  });
  if (!tenant) return null;

  const firstStart = firstDraft.meeting.startAt;
  const month = `${firstStart.getUTCFullYear()}-${String(firstStart.getUTCMonth() + 1).padStart(2, "0")}`;

  return {
    tenant,
    month,
    routedToEmail: firstDraft.routedToEmail ?? "",
    expiresAt: firstDraft.routingTokenExpiresAt ?? new Date(),
    drafts: drafts.map((d) => ({
      id: d.id,
      subjects: d.subjects,
      provenance: d.provenance,
      meeting: {
        id: d.meeting.id,
        title: d.meeting.title,
        startAt: d.meeting.startAt,
        institution: d.meeting.institution,
        attendees: d.meeting.attendees,
      },
    })),
  };
}
