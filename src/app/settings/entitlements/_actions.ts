"use server";

/**
 * Admin server action for the revenue gate (Phase 5 chunk 5d-1).
 *
 * Grants, changes, or revokes a tenant's entitlement to a platform product.
 * This is the manual / invoiced (offline) path — a platform or tenant admin
 * sets it directly. The Stripe-synced path lands in chunk 5d-2 and writes the
 * same rows with `source: "stripe"`; this action restricts `source` to
 * manual | invoice so a human can never spoof a Stripe-managed row.
 *
 * Every change is appended to the audit trail (granted / changed / revoked).
 */

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";
import { auditActorRole, requireAdmin } from "@/server/tenant/roles";
import { appendAuditEvent } from "@/server/audit-log/append";
import {
  statusGrantsAccess,
  type EntitlementSummary,
} from "@/server/entitlements/entitlements";
import {
  setEntitlementSchema,
  type SetEntitlementInput,
} from "@/server/entitlements/admin-schema";

/** Picks the audit action by comparing the prior and next granting state. */
function entitlementAuditAction(
  hadAccessBefore: boolean,
  hasAccessAfter: boolean,
): "entitlement-granted" | "entitlement-changed" | "entitlement-revoked" {
  if (!hadAccessBefore && hasAccessAfter) return "entitlement-granted";
  if (hadAccessBefore && !hasAccessAfter) return "entitlement-revoked";
  return "entitlement-changed";
}

export async function setEntitlementAction(
  rawInput: SetEntitlementInput,
): Promise<EntitlementSummary> {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");
  const ctx = await getTenantContext();
  if (!ctx) throw new Error("No tenant");

  // Billing administration is an admin capability.
  requireAdmin(ctx);

  const input = setEntitlementSchema.parse(rawInput);

  const prior = await db.tenantEntitlement.findUnique({
    where: {
      tenantId_product: { tenantId: ctx.tenantId, product: input.product },
    },
    select: { status: true },
  });
  const hadAccessBefore = prior ? statusGrantsAccess(prior.status) : false;

  const data = {
    status: input.status,
    source: input.source,
    plan: input.plan ?? null,
    seats: input.seats ?? null,
    invoiceRef: input.invoiceRef ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    notes: input.notes ?? null,
  };

  const row = await db.tenantEntitlement.upsert({
    where: {
      tenantId_product: { tenantId: ctx.tenantId, product: input.product },
    },
    create: { tenantId: ctx.tenantId, product: input.product, ...data },
    update: data,
    select: {
      product: true,
      status: true,
      plan: true,
      currentPeriodEnd: true,
    },
  });

  const hasAccessAfter = statusGrantsAccess(row.status);

  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: userId,
    actorRole: auditActorRole(ctx),
    onBehalfOfTenantId: ctx.actorKind === "agency" ? ctx.tenantId : undefined,
    action: entitlementAuditAction(hadAccessBefore, hasAccessAfter),
    subject: input.product,
    payload: {
      product: input.product,
      status: input.status,
      source: input.source,
      plan: input.plan ?? null,
      seats: input.seats ?? null,
      invoiceRef: input.invoiceRef ?? null,
      previousStatus: prior?.status ?? null,
    },
  });

  revalidatePath("/filings");
  revalidatePath("/settings/entitlements");

  return {
    product: row.product,
    status: row.status,
    active: hasAccessAfter,
    plan: row.plan,
    currentPeriodEnd: row.currentPeriodEnd,
  };
}
