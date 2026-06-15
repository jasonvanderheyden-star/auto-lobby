import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    engagement: { findMany: vi.fn() },
    detectedMeeting: {
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    tenant: { findUniqueOrThrow: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));

import {
  suggestEngagement,
  SUGGESTION_MIN_MARGIN,
  SUGGESTION_MIN_SCORE,
} from "@/server/engagements/suggest-engagement";

type EngagementFixture = {
  id: string;
  clientName: string;
  clientDomains: string[];
  subjectKeywords: string[];
  keyInstitutions: string[];
  consultantMember: { email: string } | null;
};

function engagement(overrides: Partial<EngagementFixture> & { id: string }): EngagementFixture {
  return {
    clientName: `Client ${overrides.id}`,
    clientDomains: [],
    subjectKeywords: [],
    keyInstitutions: [],
    consultantMember: null,
    ...overrides,
  };
}

type AttendeeFixture = { email: string; isInternal: boolean };

function meeting(overrides: {
  attendees?: AttendeeFixture[];
  title?: string;
  institutionId?: string | null;
  employeeEmail?: string;
  engagementId?: string | null;
  engagementSource?: string | null;
}) {
  return {
    id: "m1",
    tenantId: "t1",
    title: overrides.title ?? "Untitled sync",
    institutionId: overrides.institutionId ?? null,
    employeeEmail: overrides.employeeEmail ?? "consultant@firm.ca",
    engagementId: overrides.engagementId ?? null,
    engagementSource: overrides.engagementSource ?? null,
    attendees: overrides.attendees ?? [],
    tenant: { agencyId: "agency_1", isAgencyOwnTenant: true },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.detectedMeeting.updateMany.mockResolvedValue({ count: 1 });
  mockDb.auditEvent.create.mockResolvedValue({});
});

describe("suggestEngagement — threshold and margin boundaries", () => {
  it("suggests at exactly the 0.5 threshold (single client-domain signal)", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({ attendees: [{ email: "vp@acme.com", isInternal: false }] }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({ id: "e1", clientDomains: ["acme.com"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(SUGGESTION_MIN_SCORE).toBe(0.5);
    expect(result.outcome).toBe("suggested");
    expect(result.suggestion?.engagementId).toBe("e1");
    expect(result.suggestion?.score).toBe(0.5);
    expect(mockDb.detectedMeeting.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", tenantId: "t1" },
      data: {
        engagementId: "e1",
        engagementSource: "auto-suggested",
        engagementConfidence: 0.5,
      },
    });
  });

  it("leaves the meeting untouched below threshold (keyword + institution = 0.4)", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({ title: "Carbon capture roundtable", institutionId: "inst-eccc" }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({
        id: "e1",
        subjectKeywords: ["carbon capture"],
        keyInstitutions: ["inst-eccc"],
      }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("below-threshold");
    expect(result.suggestion).toBeNull();
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
    expect(mockDb.auditEvent.create).not.toHaveBeenCalled();
  });

  it("suggests at exactly the 0.2 margin boundary (0.7 vs 0.5 — FP-safe)", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        title: "Hydrogen strategy follow-up",
        attendees: [
          { email: "vp@acme.com", isInternal: false },
          { email: "gov@beta.ca", isInternal: false },
        ],
      }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      // 0.5 (domain) + 0.2 (keyword) = 0.7
      engagement({
        id: "e-top",
        clientDomains: ["acme.com"],
        subjectKeywords: ["hydrogen"],
      }),
      // 0.5 (domain) — both attendees' domains can hit different engagements
      engagement({ id: "e-runner", clientDomains: ["beta.ca"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(SUGGESTION_MIN_MARGIN).toBe(0.2);
    expect(result.outcome).toBe("suggested");
    expect(result.suggestion?.engagementId).toBe("e-top");
  });

  it("returns ambiguous when the margin is below 0.2 (0.6 vs 0.5)", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        employeeEmail: "consultant@firm.ca",
        attendees: [
          { email: "vp@acme.com", isInternal: false },
          { email: "vp@beta.ca", isInternal: false },
        ],
      }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      // 0.5 (domain) + 0.1 (consultant calendar) = 0.6
      engagement({
        id: "e-top",
        clientDomains: ["acme.com"],
        consultantMember: { email: "consultant@firm.ca" },
      }),
      // 0.5 (domain)
      engagement({ id: "e-runner", clientDomains: ["beta.ca"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("ambiguous");
    expect(result.suggestion).toBeNull();
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
  });
});

describe("suggestEngagement — attendee filtering", () => {
  it("excludes government-domain attendees from the client-domain signal", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        attendees: [
          { email: "analyst@tc.gc.ca", isInternal: false },
          { email: "mp@parl.gc.ca", isInternal: false },
        ],
      }),
    );
    // Pathological engagement config: a gov domain listed as a client domain
    // must never fire the signal.
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({ id: "e1", clientDomains: ["tc.gc.ca", "parl.gc.ca"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("below-threshold");
    expect(result.scores[0]?.score).toBe(0);
    expect(result.scores[0]?.signals).toHaveLength(0);
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
  });

  it("excludes internal attendees from the client-domain signal", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({ attendees: [{ email: "me@acme.com", isInternal: true }] }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({ id: "e1", clientDomains: ["acme.com"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("below-threshold");
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
  });
});

describe("suggestEngagement — provenance (non-negotiable #4)", () => {
  it("writes a per-signal breakdown in the engagement-suggested audit payload", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        title: "Hydrogen strategy with ECCC",
        institutionId: "inst-eccc",
        employeeEmail: "consultant@firm.ca",
        attendees: [{ email: "vp@acme.com", isInternal: false }],
      }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({
        id: "e1",
        clientDomains: ["acme.com"],
        subjectKeywords: ["hydrogen"],
        keyInstitutions: ["inst-eccc"],
        consultantMember: { email: "Consultant@Firm.ca" },
      }),
    ]);

    const result = await suggestEngagement("m1");
    expect(result.outcome).toBe("suggested");

    expect(mockDb.auditEvent.create).toHaveBeenCalledTimes(1);
    const call = mockDb.auditEvent.create.mock.calls[0]![0] as {
      data: {
        action: string;
        actorRole: string | null;
        subject: string;
        payload: {
          outcome: string;
          engagementId: string;
          score: number;
          signals: Array<{ signal: string; weight: number; detail: string }>;
          runnerUp: unknown;
          minScore: number;
          minMargin: number;
        };
      };
    };

    expect(call.data.action).toBe("engagement-suggested");
    expect(call.data.actorRole).toBe("system");
    expect(call.data.subject).toBe("m1");
    expect(call.data.payload.outcome).toBe("suggested");
    expect(call.data.payload.engagementId).toBe("e1");
    expect(call.data.payload.minScore).toBe(SUGGESTION_MIN_SCORE);
    expect(call.data.payload.minMargin).toBe(SUGGESTION_MIN_MARGIN);

    const signals = call.data.payload.signals;
    expect(signals.map((s) => s.signal).sort()).toEqual([
      "client-domain",
      "consultant-calendar",
      "key-institution",
      "subject-keyword",
    ]);
    for (const s of signals) {
      expect(s.weight).toBeGreaterThan(0);
      expect(s.detail.length).toBeGreaterThan(0);
    }
  });

  it("never overwrites a confirmed/manual attribution", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        engagementId: "e-old",
        engagementSource: "confirmed",
        attendees: [{ email: "vp@acme.com", isInternal: false }],
      }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({ id: "e1", clientDomains: ["acme.com"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("already-attributed");
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
  });

  it("clears a stale auto-suggestion that no longer meets threshold, with audit", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue(
      meeting({
        engagementId: "e1",
        engagementSource: "auto-suggested",
        attendees: [], // signals gone
      }),
    );
    mockDb.engagement.findMany.mockResolvedValue([
      engagement({ id: "e1", clientDomains: ["acme.com"] }),
    ]);

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("cleared");
    expect(mockDb.detectedMeeting.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", tenantId: "t1" },
      data: {
        engagementId: null,
        engagementSource: null,
        engagementConfidence: null,
      },
    });
    const call = mockDb.auditEvent.create.mock.calls[0]![0] as {
      data: { action: string; payload: { outcome: string } };
    };
    expect(call.data.action).toBe("engagement-suggested");
    expect(call.data.payload.outcome).toBe("cleared");
  });
});

describe("suggestEngagement — tenant gating", () => {
  it("no-ops on a non-agency-own tenant", async () => {
    mockDb.detectedMeeting.findUniqueOrThrow.mockResolvedValue({
      ...meeting({}),
      tenant: { agencyId: null, isAgencyOwnTenant: false },
    });

    const result = await suggestEngagement("m1");

    expect(result.outcome).toBe("not-agency-own-tenant");
    expect(mockDb.engagement.findMany).not.toHaveBeenCalled();
    expect(mockDb.detectedMeeting.updateMany).not.toHaveBeenCalled();
  });
});
