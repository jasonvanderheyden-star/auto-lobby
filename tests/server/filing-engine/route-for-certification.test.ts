import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockTx } = vi.hoisted(() => {
  const mockTx = {
    draftMcr: { updateMany: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  return {
    mockTx,
    mockDb: {
      draftMcr: { findMany: vi.fn() },
      tenant: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
    },
  };
});

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  hashRoutingToken,
  routeBatchForCertification,
  revokeRouting,
  ROUTING_TOKEN_TTL_DAYS,
} from "@/server/filing-engine/route-for-certification";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.draftMcr.updateMany.mockResolvedValue({ count: 2 });
  mockTx.auditEvent.create.mockResolvedValue({});
});

function routeInput() {
  return {
    tenantId: "t1",
    month: "2026-05",
    routedToEmail: "RO@Client.CA",
    routedByUserId: "user_staff",
    onBehalfOf: { actorRole: "agency-staff" as const },
  };
}

describe("hashRoutingToken", () => {
  it("is the SHA-256 hex digest of the raw token", () => {
    const raw = "some-raw-token";
    expect(hashRoutingToken(raw)).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
    expect(hashRoutingToken(raw)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("routeBatchForCertification", () => {
  it("issues a 32-byte base64url token and returns it exactly once", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);

    const result = await routeBatchForCertification(routeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.count).toBe(2);
    // base64url alphabet only, no padding
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes
    expect(Buffer.from(result.rawToken, "base64url")).toHaveLength(32);
  });

  it("persists only the sha256 hex hash — never the raw token", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);

    const result = await routeBatchForCertification(routeInput());
    if (!result.ok) throw new Error("expected ok");

    expect(mockTx.draftMcr.updateMany).toHaveBeenCalledTimes(1);
    const update = mockTx.draftMcr.updateMany.mock.calls[0]![0] as {
      where: { id: { in: string[] } };
      data: Record<string, unknown>;
    };
    expect(update.where.id.in).toEqual(["d1", "d2"]);
    expect(update.data.routingTokenHash).toBe(hashRoutingToken(result.rawToken));
    expect(update.data.routingTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(update.data.routedToEmail).toBe("ro@client.ca"); // lowercased
    expect(update.data.routedByUserId).toBe("user_staff");

    // The raw token must not appear anywhere in what was persisted —
    // neither the draft update nor the audit event.
    expect(JSON.stringify(update)).not.toContain(result.rawToken);
    const audit = mockTx.auditEvent.create.mock.calls[0]![0];
    expect(JSON.stringify(audit)).not.toContain(result.rawToken);
  });

  it("sets a ~14-day expiry", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([{ id: "d1" }]);
    const before = Date.now();

    const result = await routeBatchForCertification(routeInput());
    if (!result.ok) throw new Error("expected ok");

    const after = Date.now();
    expect(ROUTING_TOKEN_TTL_DAYS).toBe(14);
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 14 * DAY_MS,
    );
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 14 * DAY_MS);

    const update = mockTx.draftMcr.updateMany.mock.calls[0]![0] as {
      data: { routingTokenExpiresAt: Date };
    };
    expect(update.data.routingTokenExpiresAt.getTime()).toBe(
      result.expiresAt.getTime(),
    );
  });

  it("writes an mcr-routed audit event attributed to the agency actor", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([{ id: "d1" }]);

    const result = await routeBatchForCertification(routeInput());
    if (!result.ok) throw new Error("expected ok");

    const audit = mockTx.auditEvent.create.mock.calls[0]![0] as {
      data: {
        action: string;
        actor: string;
        actorRole: string | null;
        onBehalfOfTenantId: string | null;
        payload: { month: string; count: number; routedToEmail: string };
      };
    };
    expect(audit.data.action).toBe("mcr-routed");
    expect(audit.data.actor).toBe("user_staff");
    expect(audit.data.actorRole).toBe("agency-staff");
    expect(audit.data.onBehalfOfTenantId).toBe("t1");
    expect(audit.data.payload.month).toBe("2026-05");
    expect(audit.data.payload.routedToEmail).toBe("ro@client.ca");
  });

  it("returns no-drafts when there is nothing to route", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([]);

    const result = await routeBatchForCertification(routeInput());

    expect(result).toEqual({ ok: false, reason: "no-drafts" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("only targets uncertified lobbying drafts of the tenant/month", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([]);
    await routeBatchForCertification(routeInput());

    const where = (mockDb.draftMcr.findMany.mock.calls[0]![0] as {
      where: {
        certifiedAt: null;
        meeting: {
          tenantId: string;
          classification: string;
          startAt: { gte: Date; lt: Date };
        };
      };
    }).where;
    expect(where.certifiedAt).toBeNull();
    expect(where.meeting.tenantId).toBe("t1");
    expect(where.meeting.classification).toBe("lobbying");
    expect(where.meeting.startAt.gte.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(where.meeting.startAt.lt.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("excludes auto-suggested (unconfirmed) attributions from the routed batch", async () => {
    // Anti-over-reporting (#5): a guessed client attribution must never be
    // routed. The query allow-lists null (no attribution / managed client)
    // and confirmed/manual (human-signed); "auto-suggested" is excluded by
    // omission.
    mockDb.draftMcr.findMany.mockResolvedValue([]);
    await routeBatchForCertification(routeInput());

    const where = mockDb.draftMcr.findMany.mock.calls[0]![0]!.where as {
      meeting: { OR: Array<Record<string, unknown>> };
    };
    const allowed = where.meeting.OR;
    expect(allowed).toEqual(
      expect.arrayContaining([
        { engagementSource: null },
        { engagementSource: { in: ["confirmed", "manual"] } },
      ]),
    );
    // The allow-list must never permit an unconfirmed attribution.
    const json = JSON.stringify(allowed);
    expect(json).not.toContain("auto-suggested");
  });

  it("rejects malformed input (month, email)", async () => {
    await expect(
      routeBatchForCertification({ ...routeInput(), month: "2026-13" }),
    ).rejects.toThrow();
    await expect(
      routeBatchForCertification({ ...routeInput(), routedToEmail: "not-an-email" }),
    ).rejects.toThrow();
  });
});

describe("revokeRouting", () => {
  it("clears every routing field on still-uncertified routed drafts", async () => {
    mockTx.draftMcr.updateMany.mockResolvedValue({ count: 3 });

    const result = await revokeRouting({
      tenantId: "t1",
      month: "2026-05",
      revokedByUserId: "user_admin",
      actorRole: "agency-admin",
    });

    expect(result).toEqual({ count: 3 });
    const update = mockTx.draftMcr.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(update.data).toEqual({
      routedForCertificationAt: null,
      routedToEmail: null,
      routingTokenHash: null,
      routingTokenExpiresAt: null,
      routedByUserId: null,
    });
    expect(update.where).toMatchObject({
      certifiedAt: null,
      routedForCertificationAt: { not: null },
    });

    const audit = mockTx.auditEvent.create.mock.calls[0]![0] as {
      data: { action: string; actorRole: string | null };
    };
    expect(audit.data.action).toBe("mcr-routing-revoked");
    expect(audit.data.actorRole).toBe("agency-admin");
  });
});
