/**
 * tests/server/funding/disbursement-parse.test.ts
 *
 * Unit tests for the pure parse/map helpers behind the G0b windowed
 * disbursement import (Proactive Disclosure — Grants & Contributions feed,
 * CKAN resource 1d15a62f). No network, no DB — pure transforms over fixture
 * records (mirrors catalog-filters.test.ts / ocl-parser.test.ts).
 *
 * These helpers carry the non-negotiables for this import:
 *   - STORE-NULL, NEVER-GUESS: amount/date/region/purpose are null when the
 *     source value is absent or unparseable — we never synthesize a value the
 *     source did not state.
 *   - WINDOW SEMANTIC: inWindow keeps a real date >= cutoff WITH NO UPPER BOUND
 *     (future-dated agreements are kept), and excludes pre-cutoff dates, the
 *     1899-12-30 junk sentinel, and unparseable dates.
 *   - REQUIRED-FIELD DROP: a record missing recipient_legal_name /
 *     owner_org_title / prog_name_en is dropped (returns null).
 *   - programId is NOT set here — the orphan-tolerant fuzzy join is SQL-side.
 *
 * NOTE: the orphan-tolerant fuzzy join (programId stays null on no match) is
 * implemented in SQL (split_part(funder,'|',1) + pg_trgm) and verified at the
 * import/DB level — it matched 32.3% on the real run. It is not a pure function
 * and is therefore intentionally not unit-tested here.
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  parseAmount,
  parseAgreementDate,
  inWindow,
  cutoffFromNow,
  mapRecordToDisbursement,
  type DisbursementRecord,
} from "../../../src/server/funding/program-registry/disbursement-parse";

// ─── parseAmount ──────────────────────────────────────────────────────────

describe("parseAmount", () => {
  it('parses plain numeric text "95000.0" to a Decimal of 95000', () => {
    const d = parseAmount("95000.0");
    expect(d).toBeInstanceOf(Prisma.Decimal);
    // equals() — Decimal value compare, tolerant of "95000.0" vs "95000".
    expect((d as Prisma.Decimal).equals(new Prisma.Decimal(95000))).toBe(true);
  });

  it('parses "0" to a Decimal zero (a real value, not null)', () => {
    const d = parseAmount("0");
    expect(d).toBeInstanceOf(Prisma.Decimal);
    expect((d as Prisma.Decimal).equals(new Prisma.Decimal(0))).toBe(true);
  });

  it("STORE-NULL: empty / whitespace → null (never guessed)", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
  });

  it("STORE-NULL: null / undefined → null", () => {
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });

  it('STORE-NULL: non-numeric garbage ("abc", "12-34", "$$") → null', () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("12-34")).toBeNull();
    expect(parseAmount("$$")).toBeNull();
    expect(parseAmount("1.2.3")).toBeNull();
  });
});

// ─── parseAgreementDate ───────────────────────────────────────────────────

describe("parseAgreementDate", () => {
  it('parses "2024-06-21" to the matching UTC Date', () => {
    const d = parseAgreementDate("2024-06-21");
    expect(d).toBeInstanceOf(Date);
    expect((d as Date).getUTCFullYear()).toBe(2024);
    expect((d as Date).getUTCMonth()).toBe(5); // June = month index 5
    expect((d as Date).getUTCDate()).toBe(21);
    // The parsed date must round-trip (no roll-over) — the impl asserts this.
    expect((d as Date).toISOString().slice(0, 10)).toBe("2024-06-21");
  });

  it("rejects an impossible date that would roll over (2024-13-40 → null)", () => {
    expect(parseAgreementDate("2024-13-40")).toBeNull();
  });

  it("rejects a day-overflow date (2024-02-30 → null, does not silently become March)", () => {
    expect(parseAgreementDate("2024-02-30")).toBeNull();
  });

  it("returns null on garbage / empty / non-date text", () => {
    expect(parseAgreementDate("not-a-date")).toBeNull();
    expect(parseAgreementDate("")).toBeNull();
    expect(parseAgreementDate("2024/06/21")).toBeNull();
    expect(parseAgreementDate(null)).toBeNull();
    expect(parseAgreementDate(undefined)).toBeNull();
  });
});

// ─── inWindow ─────────────────────────────────────────────────────────────

describe("inWindow", () => {
  // Fixed cutoff for determinism.
  const cutoff = new Date(Date.UTC(2024, 0, 1)); // 2024-01-01

  it("keeps a date exactly ON the cutoff (>= is inclusive)", () => {
    expect(inWindow("2024-01-01", cutoff)).toBe(true);
  });

  it("keeps a date after the cutoff", () => {
    expect(inWindow("2024-06-21", cutoff)).toBe(true);
  });

  it("WINDOW SEMANTIC: keeps a FUTURE-dated agreement (no upper bound)", () => {
    expect(inWindow("2099-12-31", cutoff)).toBe(true);
  });

  it("excludes a pre-cutoff date", () => {
    expect(inWindow("2023-12-31", cutoff)).toBe(false);
  });

  it("excludes the 1899-12-30 junk sentinel date", () => {
    // Parses to a real Date, but it's far below cutoff → excluded by the window,
    // not by the parser. This guards against the sentinel leaking into the table.
    expect(inWindow("1899-12-30", cutoff)).toBe(false);
  });

  it("excludes an unparseable date", () => {
    expect(inWindow("garbage", cutoff)).toBe(false);
    expect(inWindow("", cutoff)).toBe(false);
    expect(inWindow(null, cutoff)).toBe(false);
  });
});

// ─── cutoffFromNow ────────────────────────────────────────────────────────

describe("cutoffFromNow", () => {
  // FIXED now — passed explicitly so the test never depends on real wall-clock.
  const fixedNow = new Date("2026-06-21T13:45:30.000Z");

  it("returns today − 2 years at UTC midnight (default years = 2)", () => {
    const c = cutoffFromNow(2, fixedNow);
    expect(c.toISOString()).toBe("2024-06-21T00:00:00.000Z");
  });

  it("defaults to a 2-year window when years is omitted", () => {
    // Confirms the default arg is 2 (the trimmed window), not the old 3.
    const c = cutoffFromNow(undefined, fixedNow);
    expect(c.toISOString()).toBe("2024-06-21T00:00:00.000Z");
  });

  it("strips the time-of-day to UTC midnight", () => {
    const c = cutoffFromNow(1, fixedNow);
    expect(c.getUTCHours()).toBe(0);
    expect(c.getUTCMinutes()).toBe(0);
    expect(c.getUTCSeconds()).toBe(0);
    expect(c.getUTCMilliseconds()).toBe(0);
    expect(c.toISOString()).toBe("2025-06-21T00:00:00.000Z");
  });
});

// ─── mapRecordToDisbursement ──────────────────────────────────────────────

/** Build a full source record from a partial; unspecified fields stay absent. */
function rec(partial: Partial<DisbursementRecord>): DisbursementRecord {
  return { ...partial };
}

describe("mapRecordToDisbursement", () => {
  it("maps a complete record to the FundingDisbursement shape", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme Research Inc.",
        owner_org_title: "Innovation, Science and Economic Development Canada | ISDE",
        prog_name_en: "Strategic Innovation Fund",
        recipient_province: "ON",
        agreement_value: "95000.0",
        agreement_start_date: "2024-06-21",
        prog_purpose_en: "R&D contribution funding.",
      }),
    );

    expect(m).not.toBeNull();
    expect(m!.recipientName).toBe("Acme Research Inc.");
    // funder keeps the raw "EN | FR" pipe form — the FR side is stripped SQL-side.
    expect(m!.funder).toBe(
      "Innovation, Science and Economic Development Canada | ISDE",
    );
    expect(m!.programNameRaw).toBe("Strategic Innovation Fund");
    expect(m!.recipientRegion).toBe("ON");
    expect(m!.amount).toBeInstanceOf(Prisma.Decimal);
    expect((m!.amount as Prisma.Decimal).equals(new Prisma.Decimal(95000))).toBe(true);
    expect(m!.disbursedOn).toBeInstanceOf(Date);
    expect((m!.disbursedOn as Date).toISOString().slice(0, 10)).toBe("2024-06-21");
    expect(m!.purpose).toBe("R&D contribution funding.");
  });

  it("does NOT set programId — that stays null until the SQL fuzzy join matches", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme Research Inc.",
        owner_org_title: "Some Federal Org",
        prog_name_en: "Some Program",
      }),
    ) as unknown as Record<string, unknown>;
    // The pure map must not invent a programId; the join owns that field.
    expect(m.programId ?? null).toBeNull();
  });

  it("STORE-NULL: amount null when agreement_value is unparseable", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme",
        owner_org_title: "Org",
        prog_name_en: "Prog",
        agreement_value: "n/a",
      }),
    );
    expect(m!.amount).toBeNull();
  });

  it("STORE-NULL: disbursedOn null when agreement_start_date is unparseable", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme",
        owner_org_title: "Org",
        prog_name_en: "Prog",
        agreement_start_date: "2024-13-40",
      }),
    );
    expect(m!.disbursedOn).toBeNull();
  });

  it("STORE-NULL: purpose / recipientRegion null when empty (never guessed)", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme",
        owner_org_title: "Org",
        prog_name_en: "Prog",
        recipient_province: "   ",
        prog_purpose_en: "",
      }),
    );
    expect(m!.recipientRegion).toBeNull();
    expect(m!.purpose).toBeNull();
  });

  it("DROPS a record missing recipient_legal_name (required) → null", () => {
    const m = mapRecordToDisbursement(
      rec({ owner_org_title: "Org", prog_name_en: "Prog" }),
    );
    expect(m).toBeNull();
  });

  it("DROPS a record with empty owner_org_title (required) → null", () => {
    const m = mapRecordToDisbursement(
      rec({
        recipient_legal_name: "Acme",
        owner_org_title: "   ",
        prog_name_en: "Prog",
      }),
    );
    expect(m).toBeNull();
  });

  it("DROPS a record missing prog_name_en (required) → null", () => {
    const m = mapRecordToDisbursement(
      rec({ recipient_legal_name: "Acme", owner_org_title: "Org" }),
    );
    expect(m).toBeNull();
  });
});
