import { describe, expect, it } from "vitest";
import { commsHaveBlankSubjects } from "@/app/registry-search/[registrationNum]/comm-utils";

// commsHaveBlankSubjects gates the contextual note that explains OCL's
// ~18-month subject-matter lag.  Two requirements from spec:
//   (a) note renders  → function returns true  when ANY comm has subjects: []
//   (b) note hidden   → function returns false when ALL comms have subjects

describe("commsHaveBlankSubjects", () => {
  // ── (a) note renders ──────────────────────────────────────────────────────

  it("returns true when exactly one comm has empty subjects", () => {
    const comms = [{ subjects: ["Energy", "Environment"] }, { subjects: [] }];
    expect(commsHaveBlankSubjects(comms)).toBe(true);
  });

  it("returns true when all comms have empty subjects", () => {
    const comms = [{ subjects: [] }, { subjects: [] }];
    expect(commsHaveBlankSubjects(comms)).toBe(true);
  });

  it("returns true when only the first comm is blank", () => {
    const comms = [{ subjects: [] }, { subjects: ["Agriculture"] }];
    expect(commsHaveBlankSubjects(comms)).toBe(true);
  });

  // ── (b) note hidden ───────────────────────────────────────────────────────

  it("returns false when every comm has at least one subject", () => {
    const comms = [{ subjects: ["Energy"] }, { subjects: ["Agriculture", "Health"] }];
    expect(commsHaveBlankSubjects(comms)).toBe(false);
  });

  it("returns false when a single comm has subjects", () => {
    const comms = [{ subjects: ["Environment"] }];
    expect(commsHaveBlankSubjects(comms)).toBe(false);
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it("returns false for an empty comms list (no rows → no note)", () => {
    expect(commsHaveBlankSubjects([])).toBe(false);
  });
});
