import { describe, it, expect } from "vitest";
import { classifyMeeting } from "@/server/classifier/classify-meeting";
import type { AttendeeResolution } from "@/server/dpoh-registry/resolve-attendee";

const meeting = (title: string | null = "Quarterly check-in") => ({
  title,
  startsAt: new Date("2026-05-04T14:00:00Z"),
  endsAt: new Date("2026-05-04T14:30:00Z"),
});

const att = (overrides: Partial<AttendeeResolution>): AttendeeResolution => ({
  email: null, displayName: null, isInternal: false,
  institutionId: null, institutionName: null, institutionAcronym: null,
  resolvedOfficialId: null, resolvedOfficialName: null, resolvedOfficialRole: null,
  isDpoh: null, dpohBasis: null, dpohRuleRef: null, dpohMatchedBy: null,
  confidence: 0.9, signal: "external-non-gov",
  ...overrides,
});

describe("classifyMeeting", () => {
  it("not-lobbying when no internal attendees", () => {
    const r = classifyMeeting(meeting(), [att({ signal: "gov-with-named-dpoh", isDpoh: true })]);
    expect(r.verdict).toBe("not-lobbying");
  });

  it("not-lobbying when only internal + non-gov externals", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({ signal: "external-non-gov" }),
    ]);
    expect(r.verdict).toBe("not-lobbying");
  });

  it("lobbying when internal + named DPOH (email match)", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({
        signal: "gov-with-named-dpoh", isDpoh: true,
        resolvedOfficialName: "Steven Guilbeault", resolvedOfficialRole: "Minister of Environment",
        institutionAcronym: "ECCC", dpohMatchedBy: "email-exact",
        dpohRuleRef: "Lobbying Act s. 2(1) DPOH (a)",
      }),
    ]);
    expect(r.verdict).toBe("lobbying");
    expect(r.confidence).toBe(0.85);
    expect(r.hadDpoh).toBe(true);
  });

  it("lobbying with lower confidence when DPOH matched by name", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({
        signal: "gov-with-named-dpoh", isDpoh: true,
        resolvedOfficialName: "John Moffet", resolvedOfficialRole: "ADM",
        institutionAcronym: "ECCC", dpohMatchedBy: "name-exact-at-institution",
      }),
    ]);
    expect(r.verdict).toBe("lobbying");
    expect(r.confidence).toBe(0.75);
  });

  it("needs-info when only gov-attendee-unknown-role attendees", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({ signal: "gov-attendee-unknown-role", institutionAcronym: "NRCAN" }),
    ]);
    expect(r.verdict).toBe("needs-info");
  });

  it("needs-info when only canada.ca (gov-unresolved)", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({ signal: "gov-unresolved" }),
    ]);
    expect(r.verdict).toBe("needs-info");
  });

  it("not-lobbying for non-DPOH-source institutions (e.g., SDTC)", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({ signal: "gov-not-dpoh-source", institutionAcronym: "SDTC" }),
    ]);
    expect(r.verdict).toBe("not-lobbying");
  });

  it("not-lobbying when title contains 'consultation' even with named DPOH", () => {
    const r = classifyMeeting(meeting("Carbon pricing consultation"), [
      att({ signal: "internal", isInternal: true }),
      att({
        signal: "gov-with-named-dpoh", isDpoh: true,
        resolvedOfficialName: "Steven Guilbeault", resolvedOfficialRole: "Minister",
        institutionAcronym: "ECCC", dpohMatchedBy: "email-exact",
      }),
    ]);
    expect(r.verdict).toBe("not-lobbying");
  });

  it("excludes town hall meetings", () => {
    const r = classifyMeeting(meeting("Climate town hall with public"), [
      att({ signal: "internal", isInternal: true }),
      att({ signal: "gov-with-named-dpoh", isDpoh: true, dpohMatchedBy: "email-exact" }),
    ]);
    expect(r.verdict).toBe("not-lobbying");
  });

  it("writes provenance reasons for every signal", () => {
    const r = classifyMeeting(meeting(), [
      att({ signal: "internal", isInternal: true }),
      att({
        signal: "gov-with-named-dpoh", isDpoh: true,
        resolvedOfficialName: "X", resolvedOfficialRole: "Y", institutionAcronym: "Z",
        dpohMatchedBy: "email-exact",
      }),
    ]);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    expect(r.reasons.some(rx => rx.text.includes("DPOH"))).toBe(true);
  });
});
