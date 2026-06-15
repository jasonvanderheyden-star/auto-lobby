/**
 * src/server/tenant/context.ts
 *
 * Tenant-scoped access primitives for Server Components and Server Actions.
 *
 * Three exports:
 *
 * 1. getTenantContext()
 *    Reads the active Clerk org from auth(), resolves to a Tenant row.
 *    Throws if the user has no active org or the org has no matching Tenant.
 *    Use this in Server Components that need tenant data.
 *
 * 2. withTenant(fn)
 *    Thin wrapper for Server Actions — ensures every action runs inside a
 *    resolved tenant scope without repeating the auth boilerplate.
 *
 * 3. tenantScopedPrisma(tenantId)
 *    Returns a Prisma Client extended with a query middleware that injects
 *    `tenantId` into every where clause for tenant-owned models (belt).
 *    RLS at the Postgres level is the suspenders.
 *    Tenant-owned models: OrgProfile, Employee, CalendarConnection,
 *    DetectedMeeting, HoursLedgerEntry, AuditEvent.
 */

import { auth, currentUser } from "@clerk/nextjs/server";
import type { AgencyMemberRole, TenantMemberRole } from "@prisma/client";
import { db } from "@/lib/db";

// ─── Models that carry a tenantId column ─────────────────────────────────

// NOTE: Prisma's $allOperations passes PascalCase model names ("OrgProfile",
// not "orgProfile"). Keep these PascalCase or the injection silently no-ops.
const TENANT_SCOPED_MODELS = new Set([
  "OrgProfile",
  "Employee",
  "TenantMember",
  "CalendarConnection",
  "DetectedMeeting",
  "HoursLedgerEntry",
  "AuditEvent",
]);

// ─── getTenantContext ─────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;
  userId: string;
  clerkOrgId: string;
  /** Direct tenant member, or an agency actor on a managed client tenant. */
  actorKind: "member" | "agency";
  /** Effective roles inside this tenant. Agency actors get mapped roles, never certifier. */
  roles: TenantMemberRole[];
  /** Set when actorKind === "agency". */
  agencyId?: string;
  agencyRole?: AgencyMemberRole;
  /** Email of the acting user, when known. */
  email?: string;
}

const FULL_ROLES: TenantMemberRole[] = [
  "admin",
  "contributor",
  "reviewer",
  "certifier",
];

/**
 * Resolves the active Clerk organization to a Tenant row + the acting user's
 * roles within it.
 *
 * Membership resolution, in order:
 *  1. TenantMember matched by clerkUserId (then by email, claiming the row).
 *  2. Bootstrap: if the tenant has NO members yet (pre-roles tenants), the
 *     current user becomes [admin, contributor, reviewer, certifier]. This
 *     backfills existing single-user tenants without a migration script.
 *  3. Agency fallback: an AgencyMember of the agency that manages this tenant
 *     gets reviewer (staff/consultant) or admin+reviewer (admin) — never
 *     certifier (non-negotiable #1).
 *
 * Throws if the user is not signed in, has no active org, the org has no
 * Tenant row, or none of the three paths grant access.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const { userId, orgId, orgRole } = await auth();

  if (!userId) {
    throw new Error("getTenantContext: user is not authenticated");
  }
  if (!orgId) {
    throw new Error(
      "getTenantContext: no active Clerk organization — user must select or create an org",
    );
  }

  const tenant = await db.tenant.findUnique({ where: { clerkOrgId: orgId } });

  if (!tenant) {
    throw new Error(
      `getTenantContext: no Tenant row for Clerk org ${orgId} — ` +
        "ensure the organization.created webhook has been delivered",
    );
  }

  const base = { tenantId: tenant.id, userId, clerkOrgId: orgId };

  // 1) Direct membership by clerkUserId
  const byUserId = await db.tenantMember.findFirst({
    where: { tenantId: tenant.id, clerkUserId: userId },
  });
  if (byUserId) {
    return {
      ...base,
      actorKind: "member",
      roles: byUserId.roles,
      email: byUserId.email,
    };
  }

  // 1b) Direct membership by email — claim the row for this clerkUserId
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (email) {
    const byEmail = await db.tenantMember.findFirst({
      where: { tenantId: tenant.id, email, clerkUserId: null },
    });
    if (byEmail) {
      const claimed = await db.tenantMember.update({
        where: { id: byEmail.id },
        data: { clerkUserId: userId },
      });
      return { ...base, actorKind: "member", roles: claimed.roles, email };
    }
  }

  // 2) Agency actor takes precedence over ANY auto-provisioning below: firm
  // staff acting on a managed client tenant must never become a direct member
  // — and in particular must never be bootstrapped with certifier (non-neg #1).
  if (tenant.agencyId) {
    const agencyMember = await db.agencyMember.findFirst({
      where: { agencyId: tenant.agencyId, clerkUserId: userId },
    });
    if (agencyMember) {
      const roles: TenantMemberRole[] =
        agencyMember.role === "admin" ? ["admin", "reviewer"] : ["reviewer"];
      return {
        ...base,
        actorKind: "agency",
        roles,
        agencyId: tenant.agencyId,
        agencyRole: agencyMember.role,
        email: agencyMember.email,
      };
    }
  }

  // 2a) Bootstrap empty-membership tenants (backfill for pre-roles tenants)
  const memberCount = await db.tenantMember.count({
    where: { tenantId: tenant.id },
  });
  if (memberCount === 0 && email) {
    const created = await db.tenantMember.create({
      data: {
        tenantId: tenant.id,
        clerkUserId: userId,
        email,
        name: user?.fullName ?? null,
        roles: FULL_ROLES,
      },
    });
    await db.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actor: userId,
        actorRole: "system",
        action: "member-bootstrapped",
        subject: created.id,
        payload: { email, roles: FULL_ROLES, reason: "first-member-backfill" },
      },
    });
    return { ...base, actorKind: "member", roles: created.roles, email };
  }

  // 2b) Invited teammate: a Clerk org member with no TenantMember row yet.
  // Provision from the Clerk org role. Certifier is NEVER auto-granted here —
  // only the first-member bootstrap above or an explicit admin assignment.
  if (memberCount > 0 && email) {
    const roles: TenantMemberRole[] =
      orgRole === "org:admin"
        ? ["admin", "contributor", "reviewer"]
        : ["contributor", "reviewer"];
    const created = await db.tenantMember.create({
      data: {
        tenantId: tenant.id,
        clerkUserId: userId,
        email,
        name: user?.fullName ?? null,
        roles,
      },
    });
    await db.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actor: userId,
        actorRole: "system",
        action: "member-bootstrapped",
        subject: created.id,
        payload: { email, roles, reason: "clerk-org-member-provision" },
      },
    });
    return { ...base, actorKind: "member", roles, email };
  }

  throw new Error(
    `getTenantContext: user ${userId} has no membership in tenant ${tenant.id}`,
  );
}

// ─── withTenant ───────────────────────────────────────────────────────────

/**
 * Wraps a Server Action so it always runs inside a resolved tenant scope.
 *
 * Usage:
 *   export const myAction = async (input: Input) =>
 *     withTenant(({ tenantId }) => db.something.create({ data: { tenantId, ...input } }));
 */
export async function withTenant<T>(
  fn: (ctx: TenantContext) => Promise<T>,
): Promise<T> {
  const ctx = await getTenantContext();
  return fn(ctx);
}

// ─── tenantScopedPrisma ───────────────────────────────────────────────────

/**
 * Returns a Prisma Client extended with query middleware that auto-injects
 * `tenantId` into where clauses for all tenant-owned models.
 *
 * Covers: findMany, findFirst, findUnique, count, aggregate, groupBy,
 *         update, updateMany, delete, deleteMany.
 * Does NOT auto-inject on create / createMany — callers must be explicit
 * (this surfaces forgotten tenantId on writes at compile time).
 *
 * Example:
 *   const tdb = tenantScopedPrisma(tenantId);
 *   await tdb.employee.findMany(); // implicitly WHERE "tenantId" = tenantId
 */
export function tenantScopedPrisma(tenantId: string) {
  const READ_WRITE_OPS = new Set([
    "findMany",
    "findFirst",
    "findFirstOrThrow",
    "findUnique",
    "findUniqueOrThrow",
    "count",
    "aggregate",
    "groupBy",
    "update",
    "updateMany",
    "delete",
    "deleteMany",
  ]);

  return db.$extends({
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (TENANT_SCOPED_MODELS.has(model) && READ_WRITE_OPS.has(operation)) {
            // Cast to access where — Prisma's generic inference is imprecise here.
            const a = args as { where?: Record<string, unknown> };
            a.where = { ...a.where, tenantId };
          }
          return query(args);
        },
      },
    },
  });
}
