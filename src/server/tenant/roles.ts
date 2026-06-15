/**
 * src/server/tenant/roles.ts
 *
 * Role guards for tenant-scoped actions.
 *
 * Role model (additive — a member usually holds several):
 *  - admin       manage settings, members, calendar connections
 *  - contributor calendar is ingested; appears as a named lobbyist
 *  - reviewer    triage drafts: confirm DPOHs, exclude, edit — cannot certify
 *  - certifier   the Responsible Officer — the ONLY role that can certify
 *
 * Agency actors (firm staff acting on a managed client tenant) are mapped to
 * reviewer/admin capabilities but NEVER certifier on a client tenant —
 * non-negotiable #1: the client's senior officer personally attests.
 */

import type { TenantMemberRole } from "@prisma/client";
import type { ActorRole } from "@/server/audit-log/append";
import type { TenantContext } from "./context";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasRole(ctx: TenantContext, role: TenantMemberRole): boolean {
  return ctx.roles.includes(role);
}

export function hasAnyRole(
  ctx: TenantContext,
  roles: TenantMemberRole[],
): boolean {
  return roles.some((r) => ctx.roles.includes(r));
}

/** Throws ForbiddenError unless the actor holds at least one of `roles`. */
export function requireAnyRole(
  ctx: TenantContext,
  roles: TenantMemberRole[],
  what: string,
): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new ForbiddenError(
      `${what} requires one of [${roles.join(", ")}] — actor has [${ctx.roles.join(", ")}]`,
    );
  }
}

/**
 * Certification gate. In-app certification additionally requires the actor to
 * be a direct tenant member — an agency actor can never certify on a managed
 * client tenant, regardless of granted roles (belt on top of role mapping).
 */
export function requireCertifier(ctx: TenantContext): void {
  if (ctx.actorKind !== "member") {
    throw new ForbiddenError(
      "Certification requires the tenant's own Responsible Officer — agency actors must route for certification instead",
    );
  }
  requireAnyRole(ctx, ["certifier"], "Certifying a batch");
}

/** Reviewer-level triage: confirm DPOH, exclude, reset, edit drafts. */
export function requireReviewer(ctx: TenantContext): void {
  requireAnyRole(ctx, ["reviewer", "admin", "certifier"], "Reviewing drafts");
}

/** Tenant administration: members, calendars, settings. */
export function requireAdmin(ctx: TenantContext): void {
  requireAnyRole(ctx, ["admin"], "Tenant administration");
}

/** Maps the acting context to the audit-trail ActorRole vocabulary. */
export function auditActorRole(ctx: TenantContext): ActorRole {
  if (ctx.actorKind === "agency") {
    return ctx.agencyRole === "admin" ? "agency-admin" : "agency-staff";
  }
  if (ctx.roles.includes("certifier")) return "registrant";
  return "lobbyist";
}
