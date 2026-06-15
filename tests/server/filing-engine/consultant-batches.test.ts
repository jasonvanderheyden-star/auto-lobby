import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    tenant: { findUniqueOrThrow: vi.fn() },
    draftMcr: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  CONFIRMED_ENGAGEMENT_SOURCES,
  getConsultantBatches,
} from "@/server/filing-engine/consultant-batches";

type EngagementRow = {
  id: string;
  clientName: string;
  registrationNum: string | null;
  consultantMemberId: string | null;
  consultantMember: {
    name: string | null;
    email: string;
    clerkUserId: string;
  } | null;
};

function draftRow(opts: {
  id: string;
  engagement: EngagementRow;
  certifiedAt?: Date | null;
  submittedAt?: Date | null;
  startAt?: string;
}) {
  return {
    id: opts.id,
    certifiedAt: opts.certifiedAt ?? null,
    submittedAt: opts.submittedAt ?? null,
    meeting: {
      id: `meeting-${opts.id}`,
      title: `Meeting ${opts.id}`,
      startAt: new Date(opts.startAt ?? "2026-05-10T14:00:00.000Z"),
      engagement: opts.engagement,
    },
  };
}

const consultantAlice = {
  name: "Alice Consultant",
  email: "alice@firm.ca",
  clerkUserId: "user_alice",
};
const consultantBob = {
  name: "Bob Consultant",
  email: "bob@firm.ca",
  clerkUserId: "user_bob",
};

const engAcme: EngagementRow = {
  id: "e-acme",
  clientName: "Acme Corp",
  registrationNum: "987654",
  consultantMemberId: "am-alice",
  consultantMember: consultantAlice,
};
const engBeta: EngagementRow = {
  id: "e-beta",
  clientName: "Beta Inc",
  registrationNum: null,
  consultantMemberId: "am-bob",
  consultantMember: consultantBob,
};
const engAcmeBob: EngagementRow = {
  id: "e-acme2",
  clientName: "Acme Corp (file 2)",
  registrationNum: null,
  consultantMemberId: "am-bob",
  consultantMember: consultantBob,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
    agencyId: "agency_1",
    isAgencyOwnTenant: true,
  });
  mockDb.draftMcr.findMany.mockResolvedValue([]);
});

describe("getConsultantBatches — anti-over-reporting filter", () => {
  it("only ever queries human-confirmed attributions (auto-suggested never batched)", async () => {
    await getConsultantBatches("t1", "2026-05");

    expect(CONFIRMED_ENGAGEMENT_SOURCES).toEqual(["confirmed", "manual"]);
    expect(CONFIRMED_ENGAGEMENT_SOURCES).not.toContain("auto-suggested");

    const where = (mockDb.draftMcr.findMany.mock.calls[0]![0] as {
      where: {
        meeting: {
          tenantId: string;
          classification: string;
          engagementId: { not: null };
          engagementSource: { in: string[] };
          startAt: { gte: Date; lt: Date };
        };
      };
    }).where;
    expect(where.meeting.tenantId).toBe("t1");
    expect(where.meeting.classification).toBe("lobbying");
    expect(where.meeting.engagementId).toEqual({ not: null });
    expect(where.meeting.engagementSource).toEqual({
      in: ["confirmed", "manual"],
    });
    expect(where.meeting.startAt.gte.toISOString()).toBe(
      "2026-05-01T00:00:00.000Z",
    );
    expect(where.meeting.startAt.lt.toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });
});

describe("getConsultantBatches — grouping", () => {
  it("groups by (consultantMemberId, engagementId)", async () => {
    mockDb.draftMcr.findMany.mockResolvedValue([
      draftRow({ id: "d1", engagement: engAcme }),
      draftRow({ id: "d2", engagement: engAcme, certifiedAt: new Date() }),
      draftRow({ id: "d3", engagement: engBeta }),
      draftRow({
        id: "d4",
        engagement: engAcme,
        certifiedAt: new Date(),
        submittedAt: new Date(),
      }),
      draftRow({ id: "d5", engagement: engAcmeBob }),
    ]);

    const batches = await getConsultantBatches("t1", "2026-05");

    expect(batches).toHaveLength(3);
    // Sorted by clientName
    expect(batches.map((b) => b.key)).toEqual([
      "am-alice:e-acme",
      "am-bob:e-acme2",
      "am-bob:e-beta",
    ]);

    const acme = batches[0]!;
    expect(acme.engagementId).toBe("e-acme");
    expect(acme.consultantMemberId).toBe("am-alice");
    expect(acme.consultantName).toBe("Alice Consultant");
    expect(acme.consultantClerkUserId).toBe("user_alice");
    expect(acme.registrationNum).toBe("987654");
    expect(acme.drafts.map((d) => d.draftMcrId)).toEqual(["d1", "d2", "d4"]);
    expect(acme.uncertifiedCount).toBe(1);
    expect(acme.certifiedCount).toBe(1);
    expect(acme.submittedCount).toBe(1);

    const beta = batches[2]!;
    expect(beta.consultantMemberId).toBe("am-bob");
    expect(beta.uncertifiedCount).toBe(1);
  });

  it("keys unassigned consultants separately", async () => {
    const engUnassigned: EngagementRow = {
      id: "e-nobody",
      clientName: "Orphan Client",
      registrationNum: null,
      consultantMemberId: null,
      consultantMember: null,
    };
    mockDb.draftMcr.findMany.mockResolvedValue([
      draftRow({ id: "d1", engagement: engUnassigned }),
    ]);

    const batches = await getConsultantBatches("t1", "2026-05");

    expect(batches).toHaveLength(1);
    expect(batches[0]!.key).toBe("unassigned:e-nobody");
    expect(batches[0]!.consultantMemberId).toBeNull();
    expect(batches[0]!.consultantName).toBeNull();
  });
});

describe("getConsultantBatches — gating", () => {
  it("returns [] for an in-house (non-agency-own) tenant without querying drafts", async () => {
    mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
      agencyId: null,
      isAgencyOwnTenant: false,
    });

    const batches = await getConsultantBatches("t1", "2026-05");

    expect(batches).toEqual([]);
    expect(mockDb.draftMcr.findMany).not.toHaveBeenCalled();
  });

  it("returns [] for a managed client tenant that is not the agency's own", async () => {
    mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
      agencyId: "agency_1",
      isAgencyOwnTenant: false,
    });

    expect(await getConsultantBatches("t1", "2026-05")).toEqual([]);
  });

  it("rejects an invalid month key", async () => {
    await expect(getConsultantBatches("t1", "May 2026")).rejects.toThrow(
      /expected YYYY-MM/,
    );
  });
});
