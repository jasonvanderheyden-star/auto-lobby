/**
 * Zod schema for the admin "set entitlement" action (chunk 5d-1).
 *
 * Kept out of the "use server" action module so it can be imported by tests
 * and other server code (a "use server" file may only export async functions).
 */

import { z } from "zod";

export const ENTITLEMENT_PRODUCTS = [
  "lobbying_compliance",
  "gov_intelligence",
  "grants",
  "permitting",
] as const;

export const ENTITLEMENT_STATUSES = [
  "none",
  "trialing",
  "active",
  "past_due",
  "canceled",
] as const;

export const setEntitlementSchema = z.object({
  product: z.enum(ENTITLEMENT_PRODUCTS),
  status: z.enum(ENTITLEMENT_STATUSES),
  // Admins set manual or invoiced (offline) entitlements only. stripe/seed are
  // reserved for the billing sync + grandfather script respectively.
  source: z.enum(["manual", "invoice"]).default("manual"),
  plan: z.string().trim().min(1).max(80).optional(),
  seats: z.number().int().positive().max(100_000).optional(),
  invoiceRef: z.string().trim().min(1).max(120).optional(),
  currentPeriodEnd: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type SetEntitlementInput = z.input<typeof setEntitlementSchema>;
