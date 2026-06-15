import { describe, it, expect } from "vitest";
import {
  auditActorRole,
  ForbiddenError,
  hasAnyRole,
  requireAdmin,
  requireCertifier,
  requireReviewer,
} from "@/server/tenant/roles";
import type { TenantContext } from "@/server/tenant/context";
import type { TenantMemberRole } from "@prisma/client";

function memberCtx(roles: TenantMemberRole[]): TenantContext {
  return {
    tenantId: "t1",
    userId: "user_member",
    clerkOrgId: "org_1",
    actorKind: "member",
    roles,
    email: "ro@client.ca",
  };
}

function agencyCtx(
  agencyRole: "admin" | "staff" | "consultant",
  roles: TenantMemberRole[],
): TenantContext {
  return {
    tenantId: "t1",
    userId: "user_agency",
    clerkOrgId: "org_1",
    actorKind: "agency",
    roles,
    agencyId: "agency_1",
    agencyRole,
    email: "staff@firm.ca",
  };
}

describe("requireCertifier", () => {
  it("allows a direct member holding the certifier role", () => {
    expect(() => requireCertifier(memberCtx(["certifier"]))).not.toThrow();
  });

  it("rejects a direct member without the certifier role", () => {
    expect(() => requireCertifier(memberCtx(["admin", "reviewer"]))).toThrow(
      ForbiddenError,
    );
  });

  it("rejects an agency actor even when roles include certifier (non-negotiable #1)", () => {
    const ctx = agencyCtx("admin", ["admin", "reviewer", "certifier"]);
    expect(() => requireCertifier(ctx)).toThrow(ForbiddenError);
    expect(() => requireCertifier(ctx)).toThrow(/route for certification/i);
  });

  it("rejects an agency consultant even with certifier role", () => {
    expect(() => requireCertifier(agencyCtx("consultant", ["certifier"]))).toThrow(
      ForbiddenError,
    );
  });
});

describe("requireReviewer", () => {
  it.each<TenantMemberRole>(["reviewer", "admin", "certifier"])(
    "accepts a member holding %s",
    (role) => {
      expect(() => requireReviewer(memberCtx([role]))).not.toThrow();
    },
  );

  it("rejects a contributor-only member", () => {
    expect(() => requireReviewer(memberCtx(["contributor"]))).toThrow(
      ForbiddenError,
    );
  });

  it("rejects an empty-role member", () => {
    expect(() => requireReviewer(memberCtx([]))).toThrow(ForbiddenError);
  });
});

describe("requireAdmin", () => {
  it("accepts admin and rejects reviewer+certifier without admin", () => {
    expect(() => requireAdmin(memberCtx(["admin"]))).not.toThrow();
    expect(() => requireAdmin(memberCtx(["reviewer", "certifier"]))).toThrow(
      ForbiddenError,
    );
  });
});

describe("auditActorRole", () => {
  it("maps agency admin → agency-admin", () => {
    expect(auditActorRole(agencyCtx("admin", ["admin", "reviewer"]))).toBe(
      "agency-admin",
    );
  });

  it("maps agency staff → agency-staff", () => {
    expect(auditActorRole(agencyCtx("staff", ["reviewer"]))).toBe("agency-staff");
  });

  it("maps agency consultant → agency-staff (only admin maps to agency-admin)", () => {
    expect(auditActorRole(agencyCtx("consultant", ["reviewer"]))).toBe(
      "agency-staff",
    );
  });

  it("maps a member holding certifier → registrant", () => {
    expect(auditActorRole(memberCtx(["admin", "certifier"]))).toBe("registrant");
  });

  it("maps a member without certifier → lobbyist", () => {
    expect(auditActorRole(memberCtx(["admin", "contributor", "reviewer"]))).toBe(
      "lobbyist",
    );
  });
});

describe("hasAnyRole", () => {
  it("is true when any role overlaps, false otherwise", () => {
    expect(hasAnyRole(memberCtx(["reviewer"]), ["admin", "reviewer"])).toBe(true);
    expect(hasAnyRole(memberCtx(["contributor"]), ["admin", "reviewer"])).toBe(
      false,
    );
  });
});
