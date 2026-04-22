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

import { auth } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

// ─── Models that carry a tenantId column ─────────────────────────────────

const TENANT_SCOPED_MODELS = new Set([
  "orgProfile",
  "employee",
  "calendarConnection",
  "detectedMeeting",
  "hoursLedgerEntry",
  "auditEvent",
]);

// ─── getTenantContext ─────────────────────────────────────────────────────

export interface TenantContext {
  tenantId: string;
  userId: string;
  clerkOrgId: string;
}

/**
 * Resolves the active Clerk organization to a Tenant row.
 * Throws if:
 *  - The user is not signed in
 *  - The user has no active organization
 *  - No Tenant row exists for the org (webhook hasn't fired yet)
 */
export async function getTenantContext(): Promise<TenantContext> {
  const { userId, orgId } = await auth();

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

  return { tenantId: tenant.id, userId, clerkOrgId: orgId };
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
