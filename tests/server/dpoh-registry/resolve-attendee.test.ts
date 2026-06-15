import { describe, it, expect } from "vitest";
import { resolveAttendee, type ResolverContext } from "@/server/dpoh-registry/resolve-attendee";

function makeCtx(overrides: Partial<ResolverContext> = {}): ResolverContext {
  const eccc = { id: "inst-eccc", name: "Environment and Climate Change Canada", acronym: "ECCC", domains: ["ec.gc.ca"], isDpohSource: true };
  const sdtc = { id: "inst-sdtc", name: "Sustainable Development Technology Canada", acronym: "SDTC", domains: ["sdtc.ca"], isDpohSource: false };
  const goc = { id: "inst-goc", name: "Government of Canada (unresolved)", acronym: "GOC", domains: ["canada.ca"], isDpohSource: false };

  return {
    internalDomains: new Set(["deepskyclimate.com"]),
    institutionsByDomain: new Map([
      ["ec.gc.ca", eccc],
      ["sdtc.ca", sdtc],
      ["canada.ca", goc],
    ]),
    lookupOfficialByEmail: async () => null,
    lookupOfficialByNameAtInstitution: async () => null,
    ...overrides,
  };
}

describe("resolveAttendee", () => {
  it("flags internal email", async () => {
    const r = await resolveAttendee({ email: "jason@deepskyclimate.com", displayName: "Jason" }, makeCtx());
    expect(r.signal).toBe("internal");
    expect(r.isInternal).toBe(true);
  });

  it("flags external non-gov", async () => {
    const r = await resolveAttendee({ email: "alice@example.com", displayName: "Alice" }, makeCtx());
    expect(r.signal).toBe("external-non-gov");
    expect(r.institutionId).toBeNull();
  });

  it("matches DPOH-source institution by domain but leaves isDpoh unknown", async () => {
    const r = await resolveAttendee({ email: "someone@ec.gc.ca", displayName: "Some One" }, makeCtx());
    expect(r.signal).toBe("gov-attendee-unknown-role");
    expect(r.institutionAcronym).toBe("ECCC");
    expect(r.isDpoh).toBeNull();
    expect(r.dpohMatchedBy).toBe("institution-domain-fallback");
    expect(r.confidence).toBe(0.3);
  });

  it("flags non-DPOH-source institution", async () => {
    const r = await resolveAttendee({ email: "someone@sdtc.ca", displayName: "Some One" }, makeCtx());
    expect(r.signal).toBe("gov-not-dpoh-source");
    expect(r.institutionAcronym).toBe("SDTC");
    expect(r.isDpoh).toBe(false);
  });

  it("returns gov-unresolved for shared canada.ca domain", async () => {
    const r = await resolveAttendee({ email: "someone@canada.ca", displayName: "Some One" }, makeCtx());
    expect(r.signal).toBe("gov-unresolved");
    expect(r.isDpoh).toBeNull();
  });

  it("uses email-exact match when official is in registry", async () => {
    const ctx = makeCtx({
      lookupOfficialByEmail: async (email) =>
        email === "minister@ec.gc.ca"
          ? { id: "off-1", name: "Steven Guilbeault", role: "Minister of Environment", isDpoh: true, dpohBasis: "role", ruleRef: "Lobbying Act s. 2(1) DPOH (a)", confidence: 0.85 }
          : null,
    });
    const r = await resolveAttendee({ email: "minister@ec.gc.ca", displayName: "Steven Guilbeault" }, ctx);
    expect(r.signal).toBe("gov-with-named-dpoh");
    expect(r.dpohMatchedBy).toBe("email-exact");
    expect(r.resolvedOfficialName).toBe("Steven Guilbeault");
  });

  it("falls back to name-at-institution match when email lookup misses", async () => {
    const ctx = makeCtx({
      lookupOfficialByEmail: async () => null,
      lookupOfficialByNameAtInstitution: async (name, instId) =>
        name === "John Moffet" && instId === "inst-eccc"
          ? { official: { id: "off-2", name: "John Moffet", role: "Assistant Deputy Minister", isDpoh: true, dpohBasis: "position-designation", ruleRef: "DPOH Regulations s. 2(1)", confidence: 0.7 }, fuzzy: false }
          : null,
    });
    const r = await resolveAttendee({ email: "j.moffet@ec.gc.ca", displayName: "John Moffet" }, ctx);
    expect(r.signal).toBe("gov-with-named-dpoh");
    expect(r.dpohMatchedBy).toBe("name-exact-at-institution");
  });

  it("uses name-fuzzy-at-institution match for display name variants", async () => {
    const ctx = makeCtx({
      lookupOfficialByEmail: async () => null,
      lookupOfficialByNameAtInstitution: async (_name, instId) =>
        instId === "inst-eccc"
          ? { official: { id: "off-3", name: "Jonathan Wilkinson", role: "Minister of Energy", isDpoh: true, dpohBasis: "role", ruleRef: "Lobbying Act s. 2(1) DPOH (a)", confidence: 0.85 }, fuzzy: true }
          : null,
    });
    const r = await resolveAttendee({ email: "j.wilkinson@ec.gc.ca", displayName: "The Hon. Jonathan Wilkinson" }, ctx);
    expect(r.signal).toBe("gov-with-named-dpoh");
    expect(r.dpohMatchedBy).toBe("name-fuzzy-at-institution");
    expect(r.resolvedOfficialName).toBe("Jonathan Wilkinson");
  });

  it("does NOT presume DPOH on institution-domain match alone (Kay Powe scenario)", async () => {
    // Junior or non-designated staff at a DPOH-source institution must not be
    // auto-flagged as DPOH. Anti-over-reporting per CLAUDE.md non-negotiable #5.
    const r = await resolveAttendee(
      { email: "kay.powe@ec.gc.ca", displayName: "Kay Powe" },
      makeCtx(),
    );
    expect(r.signal).toBe("gov-attendee-unknown-role");
    expect(r.institutionAcronym).toBe("ECCC");
    expect(r.isDpoh).toBeNull();
    expect(r.dpohMatchedBy).toBe("institution-domain-fallback");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("handles null email gracefully", async () => {
    const r = await resolveAttendee({ email: null, displayName: "Anonymous" }, makeCtx());
    expect(r.signal).toBe("external-non-gov");
  });
});
