import { describe, expect, it, vi } from "vitest";
import type { EntitlementStatus, Product } from "@prisma/client";
import {
  ACCESS_GRANTING_STATUSES,
  EntitlementError,
  assertEntitled,
  hasEntitlement,
  isEntitled,
  loadEntitlementSummaries,
  requireEntitlement,
  statusGrantsAccess,
  type EntitlementSummary,
} from "@/server/entitlements/entitlements";
import { setEntitlementSchema } from "@/server/entitlements/admin-schema";

const LOBBYING: Product = "lobbying_compliance";
const GRANTS: Product = "grants";

function ctxWith(
  entitlements: EntitlementSummary[],
  tenantId = "t1",
): { tenantId: string; entitlements: EntitlementSummary[] } {
  return { tenantId, entitlements };
}

function summary(
  product: Product,
  status: EntitlementStatus,
): EntitlementSummary {
  return {
    product,
    status,
    active: statusGrantsAccess(status),
    plan: null,
    currentPeriodEnd: null,
  };
}

/** A fake Prisma-shaped client returning a fixed row set. */
function fakeClient(
  rows: Array<{ product: Product; status: EntitlementStatus }>,
) {
  return {
    tenantEntitlement: {
      findMany: vi.fn(
        async (args: { where: { tenantId: string; product?: Product } }) => {
          const filtered = args.where.product
            ? rows.filter((r) => r.product === args.where.product)
            : rows;
          return filtered.map((r) => ({
            product: r.product,
            status: r.status,
            plan: null,
            currentPeriodEnd: null,
          }));
        },
      ),
    },
  };
}

describe("statusGrantsAccess", () => {
  it("grants for active and trialing only", () => {
    expect(ACCESS_GRANTING_STATUSES).toEqual(["active", "trialing"]);
    expect(statusGrantsAccess("active")).toBe(true);
    expect(statusGrantsAccess("trialing")).toBe(true);
    expect(statusGrantsAccess("none")).toBe(false);
    expect(statusGrantsAccess("past_due")).toBe(false);
    expect(statusGrantsAccess("canceled")).toBe(false);
  });
});

describe("isEntitled / requireEntitlement (pure guards)", () => {
  it("allows when an active row exists for the product", () => {
    const ctx = ctxWith([summary(LOBBYING, "active")]);
    expect(isEntitled(ctx, LOBBYING)).toBe(true);
    expect(() => requireEntitlement(ctx, LOBBYING)).not.toThrow();
  });

  it("allows when trialing", () => {
    const ctx = ctxWith([summary(LOBBYING, "trialing")]);
    expect(isEntitled(ctx, LOBBYING)).toBe(true);
  });

  it("denies when no row exists for the product (default-deny)", () => {
    const ctx = ctxWith([]);
    expect(isEntitled(ctx, LOBBYING)).toBe(false);
    expect(() => requireEntitlement(ctx, LOBBYING)).toThrow(EntitlementError);
  });

  it.each(["none", "past_due", "canceled"] as EntitlementStatus[])(
    "denies when status is %s",
    (status) => {
      const ctx = ctxWith([summary(LOBBYING, status)]);
      expect(isEntitled(ctx, LOBBYING)).toBe(false);
      expect(() => requireEntitlement(ctx, LOBBYING)).toThrow(EntitlementError);
    },
  );

  it("scopes entitlement to the specific product", () => {
    const ctx = ctxWith([summary(LOBBYING, "active")]);
    expect(isEntitled(ctx, GRANTS)).toBe(false);
    expect(() => requireEntitlement(ctx, GRANTS)).toThrow(EntitlementError);
  });

  it("EntitlementError carries product + tenantId", () => {
    const ctx = ctxWith([], "tenant-xyz");
    try {
      requireEntitlement(ctx, GRANTS);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EntitlementError);
      expect((err as EntitlementError).product).toBe(GRANTS);
      expect((err as EntitlementError).tenantId).toBe("tenant-xyz");
    }
  });
});

describe("hasEntitlement / assertEntitled / loadEntitlementSummaries (DB-backed)", () => {
  it("hasEntitlement is true for an active row", async () => {
    const client = fakeClient([{ product: LOBBYING, status: "active" }]);
    expect(await hasEntitlement("t1", LOBBYING, client)).toBe(true);
  });

  it("hasEntitlement is false when the only row is canceled", async () => {
    const client = fakeClient([{ product: LOBBYING, status: "canceled" }]);
    expect(await hasEntitlement("t1", LOBBYING, client)).toBe(false);
  });

  it("hasEntitlement is false when no row exists", async () => {
    const client = fakeClient([]);
    expect(await hasEntitlement("t1", LOBBYING, client)).toBe(false);
  });

  it("assertEntitled throws for an unentitled tenant", async () => {
    const client = fakeClient([]);
    await expect(assertEntitled("t1", LOBBYING, client)).rejects.toBeInstanceOf(
      EntitlementError,
    );
  });

  it("assertEntitled resolves for an entitled tenant", async () => {
    const client = fakeClient([{ product: LOBBYING, status: "trialing" }]);
    await expect(
      assertEntitled("t1", LOBBYING, client),
    ).resolves.toBeUndefined();
  });

  it("loadEntitlementSummaries flattens rows with computed active flag", async () => {
    const client = fakeClient([
      { product: LOBBYING, status: "active" },
      { product: GRANTS, status: "past_due" },
    ]);
    const summaries = await loadEntitlementSummaries("t1", client);
    expect(summaries).toEqual([
      {
        product: LOBBYING,
        status: "active",
        active: true,
        plan: null,
        currentPeriodEnd: null,
      },
      {
        product: GRANTS,
        status: "past_due",
        active: false,
        plan: null,
        currentPeriodEnd: null,
      },
    ]);
  });
});

describe("setEntitlementSchema (Zod input validation)", () => {
  it("accepts a minimal valid grant and defaults source to manual", () => {
    const parsed = setEntitlementSchema.parse({
      product: "lobbying_compliance",
      status: "active",
    });
    expect(parsed.source).toBe("manual");
  });

  it("accepts an invoiced grant with bookkeeping fields", () => {
    const parsed = setEntitlementSchema.parse({
      product: "lobbying_compliance",
      status: "active",
      source: "invoice",
      plan: "agency",
      seats: 5,
      invoiceRef: "PO-2026-0142",
    });
    expect(parsed.source).toBe("invoice");
    expect(parsed.seats).toBe(5);
  });

  it("rejects an unknown product", () => {
    expect(() =>
      setEntitlementSchema.parse({ product: "crm", status: "active" }),
    ).toThrow();
  });

  it("rejects a stripe source (system-managed, not admin-settable)", () => {
    expect(() =>
      setEntitlementSchema.parse({
        product: "lobbying_compliance",
        status: "active",
        source: "stripe",
      }),
    ).toThrow();
  });

  it("rejects non-positive seats", () => {
    expect(() =>
      setEntitlementSchema.parse({
        product: "lobbying_compliance",
        status: "active",
        seats: 0,
      }),
    ).toThrow();
  });
});
