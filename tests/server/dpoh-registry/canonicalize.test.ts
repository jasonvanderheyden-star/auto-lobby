import { describe, it, expect } from "vitest";
import {
  canonicalizeName,
  canonicalizeTitle,
  canonicalizeInstitution,
  dpohBasisFromTitle,
} from "@/server/dpoh-registry/canonicalize";

describe("canonicalizeName", () => {
  it("strips Hon. honorific", () => {
    expect(canonicalizeName("Hon. Steven Guilbeault")).toBe("Steven Guilbeault");
  });
  it("strips MP suffix", () => {
    expect(canonicalizeName("Mark Carney, MP")).toBe("Mark Carney");
  });
  it("normalizes whitespace", () => {
    expect(canonicalizeName("  Mark   Carney  ")).toBe("Mark Carney");
  });
  it("preserves accented characters", () => {
    expect(canonicalizeName("François-Philippe Champagne")).toBe("François-Philippe Champagne");
  });
});

describe("canonicalizeTitle", () => {
  it("fixes 'Member of Parliment' typo", () => {
    expect(canonicalizeTitle("Member of Parliment")).toBe("Member of Parliament");
  });
  it("returns null for empty input", () => {
    expect(canonicalizeTitle(null)).toBeNull();
    expect(canonicalizeTitle("")).toBeNull();
    expect(canonicalizeTitle("   ")).toBeNull();
  });
  it("preserves real titles", () => {
    expect(canonicalizeTitle("Deputy Minister")).toBe("Deputy Minister");
  });
});

describe("canonicalizeInstitution", () => {
  it("strips parenthetical acronym", () => {
    const r = canonicalizeInstitution("Innovation, Science and Economic Development Canada (ISED)");
    expect(r.name).toBe("Innovation, Science and Economic Development Canada");
    expect(r.acronym).toBe("ISED");
  });
  it("handles institutions without acronym", () => {
    const r = canonicalizeInstitution("House of Commons");
    expect(r.name).toBe("House of Commons");
    expect(r.acronym).toBeNull();
  });
});

describe("dpohBasisFromTitle", () => {
  it("classifies Minister as role-based", () => {
    expect(dpohBasisFromTitle("Minister of Environment").basis).toBe("role");
  });
  it("classifies MP as role-based", () => {
    expect(dpohBasisFromTitle("Member of Parliament").basis).toBe("role");
  });
  it("classifies Deputy Minister as position-designation", () => {
    expect(dpohBasisFromTitle("Deputy Minister").basis).toBe("position-designation");
  });
  it("classifies Assistant Deputy Minister as position-designation", () => {
    expect(dpohBasisFromTitle("Assistant Deputy Minister").basis).toBe("position-designation");
  });
  it("falls back to position-designation for unknown", () => {
    expect(dpohBasisFromTitle(null).basis).toBe("position-designation");
  });
});
