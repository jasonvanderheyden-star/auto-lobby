/**
 * src/server/entitlements/entitlements.ts
 *
 * The revenue gate (Phase 5 chunk 5d).
 *
 * A tenant may use a platform product only if it holds a TenantEntitlement
 * row for that product whose status grants access (active | trialing).
 * Default-deny: absence of a row, or any other status (none | past_due |
 * canceled), denies access.
 *
 * Two layers:
 *  - Pure guards over a resolved TenantContext (no I/O): `isEntitled`,
 *    `requireEntitlement`. Use these in Server Components / Actions where the
 *    context already carries `entitlements`.
 *  - DB-backed lookups for code paths without a TenantContext (background
 *    jobs, scripts, the LRS submission harness): `hasEntitlement`,
 *    `loadEntitlementSummaries`.
 */

import type { Product, EntitlementStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/** Statuses that grant access to a product. Everything else denies. */
export const ACCESS_GRANTING_STATUSES: readonly EntitlementStatus[] = [
  "active",
  "trialing",
] as const;

/** Thrown when a tenant attempts to use a product it is not entitled to. */
export class EntitlementError extends Error {
  constructor(
    public readonly product: Product,
    public readonly tenantId: string,
  ) {
    super(
      `Tenant ${tenantId} is not entitled to product "${product}". ` +
        `An active or trialing subscription is required.`,
    );
    this.name = "EntitlementError";
  }
}

/** A flattened view of one product entitlement for a tenant. */
export interface EntitlementSummary {
  product: Product;
  status: EntitlementStatus;
  /** True iff `status` grants access. */
  active: boolean;
  plan: string | null;
  currentPeriodEnd: Date | null;
}

/** True iff this status grants product access. */
export function statusGrantsAccess(status: EntitlementStatus): boolean {
  return ACCESS_GRANTING_STATUSES.includes(status);
}

/**
 * Minimal structural shape so callers may pass either the default client or a
 * Prisma transaction client.
 */
type EntitlementReadClient = {
  tenantEntitlement: {
    findMany: (args: Prisma.TenantEntitlementFindManyArgs) => Promise<
      Array<{
        product: Product;
        status: EntitlementStatus;
        plan: string | null;
        currentPeriodEnd: Date | null;
      }>
    >;
  };
};

/**
 * Load all product entitlement summaries for a tenant. One entry per existing
 * row; products without a row are simply absent (callers treat absence as
 * "no access").
 */
export async function loadEntitlementSummaries(
  tenantId: string,
  client: EntitlementReadClient = db as unknown as EntitlementReadClient,
): Promise<EntitlementSummary[]> {
  const rows = await client.tenantEntitlement.findMany({
    where: { tenantId },
    select: {
      product: true,
      status: true,
      plan: true,
      currentPeriodEnd: true,
    },
  });
  return rows.map((r) => ({
    product: r.product,
    status: r.status,
    active: statusGrantsAccess(r.status),
    plan: r.plan,
    currentPeriodEnd: r.currentPeriodEnd,
  }));
}

/**
 * DB-backed entitlement check for code paths without a TenantContext
 * (scripts, background jobs, the LRS submission harness).
 */
export async function hasEntitlement(
  tenantId: string,
  product: Product,
  client: EntitlementReadClient = db as unknown as EntitlementReadClient,
): Promise<boolean> {
  const rows = await client.tenantEntitlement.findMany({
    where: { tenantId, product },
    select: {
      product: true,
      status: true,
      plan: true,
      currentPeriodEnd: true,
    },
  });
  const row = rows[0];
  return row !== undefined && statusGrantsAccess(row.status);
}

/**
 * DB-backed assertion. Throws `EntitlementError` unless the tenant is entitled.
 * Prefer `requireEntitlement` when a TenantContext is already in hand.
 */
export async function assertEntitled(
  tenantId: string,
  product: Product,
  client: EntitlementReadClient = db as unknown as EntitlementReadClient,
): Promise<void> {
  if (!(await hasEntitlement(tenantId, product, client))) {
    throw new EntitlementError(product, tenantId);
  }
}

// ─── Pure guards over a resolved TenantContext ──────────────────────────────
// Typed structurally to avoid an import cycle with tenant/context.ts (which
// imports this module to resolve `entitlements`).

interface EntitledContext {
  tenantId: string;
  entitlements: EntitlementSummary[];
}

/** True iff the context's tenant is entitled to `product`. No I/O. */
export function isEntitled(ctx: EntitledContext, product: Product): boolean {
  return ctx.entitlements.some((e) => e.product === product && e.active);
}

/** Throws `EntitlementError` unless the context's tenant is entitled. No I/O. */
export function requireEntitlement(
  ctx: EntitledContext,
  product: Product,
): void {
  if (!isEntitled(ctx, product)) {
    throw new EntitlementError(product, ctx.tenantId);
  }
}
