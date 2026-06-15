import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockAuth, mockCurrentUser } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockDb: {
    tenant: { findUnique: vi.fn() },
    tenantMember: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agencyMember: { findFirst: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

import { getTenantContext } from "@/server/tenant/context";

const TENANT = { id: "t1", clerkOrgId: "org_1", agencyId: null };
const TENANT_MANAGED = { id: "t1", clerkOrgId: "org_1", agencyId: "agency_1" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    userId: "user_1",
    orgId: "org_1",
    orgRole: "org:member",
  });
  mockCurrentUser.mockResolvedValue({
    primaryEmailAddress: { emailAddress: "Person@Example.COM" },
    fullName: "Pat Person",
  });
  mockDb.tenant.findUnique.mockResolvedValue(TENANT);
  mockDb.tenantMember.findFirst.mockResolvedValue(null); // byUserId and byEmail
  mockDb.agencyMember.findFirst.mockResolvedValue(null);
  mockDb.auditEvent.create.mockResolvedValue({});
});

describe("getTenantContext — zero-member bootstrap", () => {
  it("grants the full role set (including certifier) to the first member", async () => {
    mockDb.tenantMember.count.mockResolvedValue(0);
    mockDb.tenantMember.create.mockImplementation(
      async (args: { data: { roles: string[] } }) => ({
        id: "tm1",
        ...args.data,
      }),
    );

    const ctx = await getTenantContext();

    expect(ctx.actorKind).toBe("member");
    expect(ctx.roles).toEqual(["admin", "contributor", "reviewer", "certifier"]);
    expect(ctx.email).toBe("person@example.com"); // lowercased

    const created = mockDb.tenantMember.create.mock.calls[0]![0] as {
      data: { tenantId: string; clerkUserId: string; email: string };
    };
    expect(created.data.tenantId).toBe("t1");
    expect(created.data.clerkUserId).toBe("user_1");
    expect(created.data.email).toBe("person@example.com");

    const audit = mockDb.auditEvent.create.mock.calls[0]![0] as {
      data: { action: string; payload: { reason: string } };
    };
    expect(audit.data.action).toBe("member-bootstrapped");
    expect(audit.data.payload.reason).toBe("first-member-backfill");
  });
});

describe("getTenantContext — clerk-org-member auto-provisioning", () => {
  it("never grants certifier, even to a Clerk org admin", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_2",
      orgId: "org_1",
      orgRole: "org:admin",
    });
    mockDb.tenantMember.count.mockResolvedValue(3);
    mockDb.tenantMember.create.mockImplementation(
      async (args: { data: { roles: string[] } }) => ({
        id: "tm2",
        ...args.data,
      }),
    );

    const ctx = await getTenantContext();

    expect(ctx.actorKind).toBe("member");
    expect(ctx.roles).toEqual(["admin", "contributor", "reviewer"]);
    expect(ctx.roles).not.toContain("certifier");
  });

  it("grants contributor+reviewer to a non-admin org member — no certifier", async () => {
    mockDb.tenantMember.count.mockResolvedValue(3);
    mockDb.tenantMember.create.mockImplementation(
      async (args: { data: { roles: string[] } }) => ({
        id: "tm3",
        ...args.data,
      }),
    );

    const ctx = await getTenantContext();

    expect(ctx.roles).toEqual(["contributor", "reviewer"]);
    expect(ctx.roles).not.toContain("certifier");
    const audit = mockDb.auditEvent.create.mock.calls[0]![0] as {
      data: { payload: { reason: string } };
    };
    expect(audit.data.payload.reason).toBe("clerk-org-member-provision");
  });
});

describe("getTenantContext — agency actors", () => {
  it("resolves an agency member as actorKind 'agency' before auto-provisioning", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(TENANT_MANAGED);
    mockDb.tenantMember.count.mockResolvedValue(2);
    mockDb.agencyMember.findFirst.mockResolvedValue({
      id: "am1",
      agencyId: "agency_1",
      clerkUserId: "user_1",
      email: "staff@firm.ca",
      role: "staff",
    });

    const ctx = await getTenantContext();

    expect(ctx.actorKind).toBe("agency");
    expect(ctx.agencyId).toBe("agency_1");
    expect(ctx.agencyRole).toBe("staff");
    expect(ctx.roles).toEqual(["reviewer"]);
    expect(ctx.roles).not.toContain("certifier");
    // Firm staff must never be silently turned into a direct tenant member.
    expect(mockDb.tenantMember.create).not.toHaveBeenCalled();
  });

  it("maps an agency admin to admin+reviewer — still never certifier", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(TENANT_MANAGED);
    mockDb.tenantMember.count.mockResolvedValue(2);
    mockDb.agencyMember.findFirst.mockResolvedValue({
      id: "am2",
      agencyId: "agency_1",
      clerkUserId: "user_1",
      email: "admin@firm.ca",
      role: "admin",
    });

    const ctx = await getTenantContext();

    expect(ctx.actorKind).toBe("agency");
    expect(ctx.roles).toEqual(["admin", "reviewer"]);
    expect(ctx.roles).not.toContain("certifier");
  });
});

describe("getTenantContext — direct membership", () => {
  it("returns the stored roles for an existing member matched by clerkUserId", async () => {
    mockDb.tenantMember.findFirst.mockResolvedValueOnce({
      id: "tm1",
      tenantId: "t1",
      clerkUserId: "user_1",
      email: "person@example.com",
      roles: ["certifier"],
    });

    const ctx = await getTenantContext();

    expect(ctx.actorKind).toBe("member");
    expect(ctx.roles).toEqual(["certifier"]);
    expect(mockDb.tenantMember.create).not.toHaveBeenCalled();
  });

  it("claims an email-invited member row for the signed-in clerkUserId", async () => {
    mockDb.tenantMember.findFirst
      .mockResolvedValueOnce(null) // byUserId
      .mockResolvedValueOnce({
        id: "tm9",
        tenantId: "t1",
        clerkUserId: null,
        email: "person@example.com",
        roles: ["reviewer"],
      }); // byEmail
    mockDb.tenantMember.update.mockResolvedValue({
      id: "tm9",
      roles: ["reviewer"],
    });

    const ctx = await getTenantContext();

    expect(ctx.roles).toEqual(["reviewer"]);
    expect(mockDb.tenantMember.update).toHaveBeenCalledWith({
      where: { id: "tm9" },
      data: { clerkUserId: "user_1" },
    });
  });
});

describe("getTenantContext — failure modes", () => {
  it("throws when not signed in", async () => {
    mockAuth.mockResolvedValue({ userId: null, orgId: null, orgRole: null });
    await expect(getTenantContext()).rejects.toThrow(/not authenticated/);
  });

  it("throws when no active org", async () => {
    mockAuth.mockResolvedValue({
      userId: "user_1",
      orgId: null,
      orgRole: null,
    });
    await expect(getTenantContext()).rejects.toThrow(/no active Clerk organization/);
  });

  it("throws when the org has no Tenant row", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null);
    await expect(getTenantContext()).rejects.toThrow(/no Tenant row/);
  });

  it("throws when no membership path grants access", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(TENANT_MANAGED);
    mockDb.tenantMember.count.mockResolvedValue(2);
    mockDb.agencyMember.findFirst.mockResolvedValue(null);
    mockCurrentUser.mockResolvedValue(null); // no email → no provisioning path

    await expect(getTenantContext()).rejects.toThrow(/no membership/);
  });
});
