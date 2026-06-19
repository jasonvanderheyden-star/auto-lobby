/**
 * tests/server/funding/catalog-filters.test.ts
 *
 * Unit tests for the pure predicates that gate the G0a federal funding-catalog
 * import (Business Benefits Finder XLSX → FundingProgram).
 *
 * These predicates carry the non-negotiables for this import:
 *   - FEDERAL-ONLY: never ingest a provincial program as if it were federal.
 *   - DEDUP: collapse Cognit.ca research-partner boilerplate so the
 *     @@unique([funder, name]) constraint can't be violated on import.
 *   - CONSERVATIVE / DEFAULT-INCLUDE services veto: drop only a CLEAR advisory
 *     row with NO funding signal; a funding signal vetoes the drop; ambiguity
 *     KEEPS. (anti-over-reporting: don't silently lose real funding programs.)
 *   - STORE-NULL, NEVER-GUESS: the feed has no structured eligibility data, so
 *     every structured dimension is absent from the mapped row — downstream
 *     must say "unknown", never fabricate a threshold.
 *
 * Fixtures are hand-built XLSX-shaped rows. Column layout (10 free-text columns,
 * EN/FR interleaved):
 *   [0]Title-EN [1]Title-FR [2]ShortDesc-EN [3]ShortDesc-FR
 *   [4]LongDesc-EN [5]LongDesc-FR [6]Org-EN [7]Org-FR [8]URL-EN [9]URL-FR
 */

import { describe, it, expect } from "vitest";
import {
  isFederal,
  dedupCognit,
  isCognitBoilerplate,
  isFunding,
  mapRowToProgram,
} from "../../../src/server/funding/program-registry/catalog-filters";

/**
 * Build a full 10-column row from a partial map, defaulting unspecified
 * columns to "". Keeps fixtures readable while still exercising the real
 * positional column indices the predicates rely on.
 */
function row(
  partial: Partial<{
    titleEn: string;
    titleFr: string;
    shortDescEn: string;
    shortDescFr: string;
    longDescEn: string;
    longDescFr: string;
    orgEn: string;
    orgFr: string;
    urlEn: string;
    urlFr: string;
  }>,
): string[] {
  return [
    partial.titleEn ?? "",
    partial.titleFr ?? "",
    partial.shortDescEn ?? "",
    partial.shortDescFr ?? "",
    partial.longDescEn ?? "",
    partial.longDescFr ?? "",
    partial.orgEn ?? "",
    partial.orgFr ?? "",
    partial.urlEn ?? "",
    partial.urlFr ?? "",
  ];
}

// ─── isFederal ──────────────────────────────────────────────────────────────

describe("isFederal", () => {
  it('accepts an Organization-EN starting "Government of Canada"', () => {
    expect(isFederal("Government of Canada - ISED")).toBe(true);
  });

  it("accepts a longer federal org label with a trailing institution", () => {
    expect(
      isFederal("Government of Canada - Innovation, Science and Economic Development"),
    ).toBe(true);
  });

  it('accepts via the FR safety net when only Org-FR starts "Gouvernement du Canada"', () => {
    // Real defensive case: EN org blank/garbled but FR carries the federal signal.
    expect(isFederal("", "Gouvernement du Canada - ISDE")).toBe(true);
  });

  it('rejects "Government of Ontario" (provincial)', () => {
    expect(isFederal("Government of Ontario")).toBe(false);
  });

  it('rejects "Government of British Columbia" (provincial)', () => {
    expect(isFederal("Government of British Columbia - JEDI")).toBe(false);
  });

  it("rejects a Cognit.ca funded-org boilerplate row", () => {
    expect(isFederal("Cognit.ca | University of Waterloo")).toBe(false);
  });

  it("does not match 'Government of Canada' appearing mid-string (startsWith only)", () => {
    expect(isFederal("Affiliated with the Government of Canada")).toBe(false);
  });
});

// ─── dedupCognit ──────────────────────────────────────────────────────────────

describe("dedupCognit / canonicalization", () => {
  it("recognizes Cognit.ca boilerplate on the Org-EN column", () => {
    expect(isCognitBoilerplate("Cognit.ca | McGill University")).toBe(true);
    expect(isCognitBoilerplate("Government of Canada - ISED")).toBe(false);
  });

  // NOTE: On the REAL federal import this dedup is a no-op — Cognit.ca rows are
  // funded-org boilerplate and are already removed by the federal filter
  // (isFederal === false) before dedup runs. This unit test is the ONLY place
  // the collapse-to-one behaviour is proven, guarding @@unique([funder, name]).
  it("collapses two Cognit.ca boilerplate rows to ONE canonical program", () => {
    const input = [
      row({ titleEn: "Research Partner", orgEn: "Cognit.ca | University of Waterloo" }),
      row({ titleEn: "Federal Grant", orgEn: "Government of Canada - ISED" }),
      row({ titleEn: "Research Partner", orgEn: "Cognit.ca | McGill University" }),
    ];

    const { rows, dropped } = dedupCognit(input);

    // Exactly one Cognit row survives; the non-Cognit row is untouched.
    expect(dropped).toBe(1);
    const cognitRows = rows.filter((r) => isCognitBoilerplate(r[6] ?? ""));
    expect(cognitRows).toHaveLength(1);
    // The FIRST-encountered Cognit row is the canonical one.
    expect(cognitRows[0]?.[6]).toBe("Cognit.ca | University of Waterloo");
    // Total: 1 canonical Cognit + 1 federal row = 2.
    expect(rows).toHaveLength(2);
  });

  it("preserves non-Cognit rows in order and drops nothing when there are no Cognit rows", () => {
    const input = [
      row({ titleEn: "A", orgEn: "Government of Canada - ISED" }),
      row({ titleEn: "B", orgEn: "Government of Ontario" }),
    ];
    const { rows, dropped } = dedupCognit(input);
    expect(dropped).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.[0]).toBe("A");
    expect(rows[1]?.[0]).toBe("B");
  });
});

// ─── isFunding (conservative, default-include services veto) ──────────────────

describe("isFunding — conservative services predicate", () => {
  it('DROPS a clear advisory/services row with NO funding signal (reason "services")', () => {
    const r = row({
      titleEn: "Business Advisory Services",
      longDescEn:
        "Connect with a mentor for guidance and advice on growing your business. " +
        "Networking and consulting support to help you succeed.",
      orgEn: "Government of Canada - ISED",
    });
    const result = isFunding(r);
    expect(result.keep).toBe(false);
    expect(result.reason).toBe("services");
  });

  it("KEEPS an advisory-worded row that ALSO carries a funding signal (funding veto)", () => {
    // Advisory keyword present, but a "grant" / "$" funding signal vetoes the drop.
    const r = row({
      titleEn: "Advisory and Grant Program",
      longDescEn:
        "Receive advice and mentorship alongside a grant of up to $50,000 to " +
        "scale your operations.",
      orgEn: "Government of Canada - ISED",
    });
    const result = isFunding(r);
    expect(result.keep).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("KEEPS an advisory-worded row vetoed by a percentage money token", () => {
    const r = row({
      titleEn: "Mentorship and Wage Subsidy",
      longDescEn: "Advisory support plus a wage subsidy covering 50% of eligible salaries.",
      orgEn: "Government of Canada - ISED",
    });
    expect(isFunding(r).keep).toBe(true);
  });

  it("KEEPS on ambiguity — neither advisory nor funding signal (default-include)", () => {
    // The non-negotiable: do NOT over-exclude. When the row carries no clear
    // services signal AND no funding signal, default to KEEP.
    const r = row({
      titleEn: "Innovation Superclusters Initiative",
      longDescEn:
        "A program supporting collaboration across the Canadian innovation ecosystem.",
      orgEn: "Government of Canada - ISED",
    });
    const result = isFunding(r);
    expect(result.keep).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("KEEPS a plainly fundable row (grant keyword, no advisory wording)", () => {
    const r = row({
      titleEn: "Strategic Innovation Fund",
      longDescEn: "Contribution funding for large-scale R&D projects.",
      orgEn: "Government of Canada - ISED",
    });
    expect(isFunding(r).keep).toBe(true);
  });
});

// ─── mapRowToProgram (store-null, never-guess) ────────────────────────────────

describe("mapRowToProgram", () => {
  it("maps the 10 columns to bilingual fields and sets governmentLevel federal", () => {
    const r = row({
      titleEn: "Strategic Innovation Fund",
      titleFr: "Fonds stratégique pour l'innovation",
      shortDescEn: "R&D contribution funding.",
      shortDescFr: "Financement de la R-D.",
      longDescEn: "Large-scale contribution funding for R&D projects.",
      longDescFr: "Financement de contribution pour projets de R-D.",
      orgEn: "Government of Canada - ISED",
      orgFr: "Gouvernement du Canada - ISDE",
      urlEn: "https://example.gc.ca/sif",
      urlFr: "https://exemple.gc.ca/fsi",
    });

    const p = mapRowToProgram(r);

    expect(p.funder).toBe("Government of Canada - ISED");
    expect(p.name).toBe("Strategic Innovation Fund");
    expect(p.governmentLevel).toBe("federal");
    expect(p.funderFr).toBe("Gouvernement du Canada - ISDE");
    expect(p.nameFr).toBe("Fonds stratégique pour l'innovation");
    expect(p.shortDescriptionEn).toBe("R&D contribution funding.");
    expect(p.shortDescriptionFr).toBe("Financement de la R-D.");
    expect(p.longDescriptionEn).toBe("Large-scale contribution funding for R&D projects.");
    expect(p.longDescriptionFr).toBe("Financement de contribution pour projets de R-D.");
    expect(p.sourceUrl).toBe("https://example.gc.ca/sif");
    expect(p.sourceUrlFr).toBe("https://exemple.gc.ca/fsi");
  });

  it("STORE-NULL invariant: no structured dimension is ever populated by the map", () => {
    // The Business Benefits Finder feed has no structured eligibility data.
    // Every structured dimension must be absent (null/undefined) — never guessed
    // from the free-text blurb.
    const r = row({
      titleEn: "Some Fund",
      longDescEn: "Grant of up to $1,000,000 for projects under 24 months.",
      orgEn: "Government of Canada - ISED",
    });

    const p = mapRowToProgram(r) as unknown as Record<string, unknown>;

    // Even though the blurb mentions "$1,000,000" and "24 months", none of these
    // structured fields may be derived — they must be absent from the mapped row.
    for (const field of [
      "instrumentType",
      "valueMin",
      "valueMax",
      "intakeCadence",
      "intakeUrl",
      "intakeFormType",
      "narrativeCriteria",
    ]) {
      expect(p[field] ?? null).toBeNull();
    }
  });

  it("collapses empty / whitespace-only source strings to null (never stores '')", () => {
    const r = row({
      titleEn: "  Minimal Program  ",
      titleFr: "",
      shortDescEn: "   ",
      longDescEn: "",
      orgEn: "Government of Canada - ISED",
      orgFr: "",
      urlEn: "",
      urlFr: "   ",
    });

    const p = mapRowToProgram(r);

    // Required fields are trimmed but present.
    expect(p.name).toBe("Minimal Program");
    expect(p.funder).toBe("Government of Canada - ISED");
    // Empty / whitespace-only optionals collapse to null.
    expect(p.nameFr).toBeNull();
    expect(p.funderFr).toBeNull();
    expect(p.shortDescriptionEn).toBeNull();
    expect(p.shortDescriptionFr).toBeNull();
    expect(p.longDescriptionEn).toBeNull();
    expect(p.longDescriptionFr).toBeNull();
    expect(p.sourceUrl).toBeNull();
    expect(p.sourceUrlFr).toBeNull();
  });
});
