/**
 * src/server/funding/program-registry/catalog-filters.ts
 *
 * Pure filters / predicates for the Business Benefits Finder catalog XLSX.
 * No I/O, no Prisma — every function here is a pure transform of row data so it
 * can be unit-tested against a fixture (mirrors the scripts/ocl-utils.ts split).
 *
 * XLSX column layout (10 free-text columns, EN/FR interleaved):
 *   [0] Title - English
 *   [1] Title - French
 *   [2] Short Description - English
 *   [3] Short Description - French
 *   [4] Long Description - English
 *   [5] Long Description - French
 *   [6] Organization - English
 *   [7] Organization - French
 *   [8] Organization URL - English
 *   [9] Organization URL - French
 */

// ─── Column index constants ─────────────────────────────────────────────────

export const COL = {
  titleEn: 0,
  titleFr: 1,
  shortDescEn: 2,
  shortDescFr: 3,
  longDescEn: 4,
  longDescFr: 5,
  orgEn: 6,
  orgFr: 7,
  urlEn: 8,
  urlFr: 9,
} as const;

// ─── Normalized program shape (maps onto FundingProgram fields) ──────────────

export interface MappedProgram {
  funder: string;
  name: string;
  governmentLevel: "federal";
  funderFr: string | null;
  nameFr: string | null;
  shortDescriptionEn: string | null;
  shortDescriptionFr: string | null;
  longDescriptionEn: string | null;
  longDescriptionFr: string | null;
  sourceUrl: string | null;
  sourceUrlFr: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Empty / whitespace-only strings → null; otherwise trimmed. */
function emptyToNull(val: string | undefined): string | null {
  if (val == null) return null;
  const t = val.trim();
  return t === "" ? null : t;
}

// ─── Federal predicate ──────────────────────────────────────────────────────

/**
 * Federal iff the English org starts "Government of Canada" (the primary
 * signal) OR — as an FR safety net — the French org starts
 * "Gouvernement du Canada".
 */
export function isFederal(orgEn: string, orgFr?: string): boolean {
  return (
    (orgEn ?? "").trimStart().startsWith("Government of Canada") ||
    (orgFr ?? "").trimStart().startsWith("Gouvernement du Canada")
  );
}

// ─── Cognit.ca de-dup ───────────────────────────────────────────────────────

const COGNIT_RE = /^Cognit\.ca\s*\|/i;

/**
 * The feed carries ~203 near-identical "Cognit.ca | <institution>" research-
 * partner boilerplate rows. They differ only by trailing institution and would
 * all collide under @@unique([funder, name]) if their funders ever matched.
 * We collapse them to ONE canonical program.
 */
export function isCognitBoilerplate(orgEn: string): boolean {
  return COGNIT_RE.test(orgEn ?? "");
}

/**
 * Collapse all "Cognit.ca | <institution>" rows to a single canonical row
 * (the first encountered), preserving every non-Cognit row untouched and in
 * order. Detection is on the Organization-English column.
 */
export function dedupCognit(rows: string[][]): { rows: string[][]; dropped: number } {
  const out: string[][] = [];
  let seenCognit = false;
  let dropped = 0;
  for (const row of rows) {
    if (isCognitBoilerplate(row[COL.orgEn] ?? "")) {
      if (seenCognit) {
        dropped++;
        continue;
      }
      seenCognit = true;
    }
    out.push(row);
  }
  return { rows: out, dropped };
}

// ─── Is-this-actually-funding predicate ─────────────────────────────────────
//
// Conservative + default-include (anti-over-reporting analog: when unsure,
// KEEP — never silently drop a real funding program). A row is dropped ONLY
// when it shows an advisory/services signal AND shows NO funding signal.

const SERVICES_RE =
  /\b(advisory|advice|mentorship|consulting|networking|information service|guidance|connect with|find a|toolkit|webinar)\b/i;

// A funding signal is either a money token ($ or %) OR a funding-instrument keyword.
const FUNDING_KEYWORD_RE =
  /\b(grant|loan|contribution|tax credit|wage subsidy|funding|financing|rebate|voucher|equity|guarantee)\b/i;
const MONEY_TOKEN_RE = /[$%]/;

function hasFundingSignal(text: string): boolean {
  return MONEY_TOKEN_RE.test(text) || FUNDING_KEYWORD_RE.test(text);
}

/**
 * Keep on ambiguity. Drop (reason "services") only when the Title-EN /
 * LongDesc-EN carry an advisory/services signal AND no funding signal.
 */
export function isFunding(row: string[]): { keep: boolean; reason?: "services" } {
  const text = `${row[COL.titleEn] ?? ""}\n${row[COL.longDescEn] ?? ""}`;
  const servicesSignal = SERVICES_RE.test(text);
  if (servicesSignal && !hasFundingSignal(text)) {
    return { keep: false, reason: "services" };
  }
  return { keep: true };
}

// ─── Row → FundingProgram mapper ────────────────────────────────────────────

/**
 * Map the 10 feed columns onto the bilingual FundingProgram fields.
 *
 * ANTI-OVER-REPORTING (CLAUDE.md): every STRUCTURED dimension —
 * instrumentType, valueMin, valueMax, intakeCadence, intakeUrl, intakeFormType,
 * narrativeCriteria — is ABSENT from the Business Benefits Finder feed. Those
 * fields are written NULL here and must NEVER be derived or guessed from the
 * blurb. The feed states benefits, not eligibility; downstream must be able to
 * say "unknown" rather than fabricate a threshold the source never stated.
 * Eligibility extraction is a per-program-page scrape job (G0c), not this map.
 *
 * Empty strings collapse to null so the DB never carries "" where it means
 * "absent".
 */
export function mapRowToProgram(row: string[]): MappedProgram {
  return {
    funder: (row[COL.orgEn] ?? "").trim(),
    name: (row[COL.titleEn] ?? "").trim(),
    governmentLevel: "federal",
    funderFr: emptyToNull(row[COL.orgFr]),
    nameFr: emptyToNull(row[COL.titleFr]),
    shortDescriptionEn: emptyToNull(row[COL.shortDescEn]),
    shortDescriptionFr: emptyToNull(row[COL.shortDescFr]),
    longDescriptionEn: emptyToNull(row[COL.longDescEn]),
    longDescriptionFr: emptyToNull(row[COL.longDescFr]),
    sourceUrl: emptyToNull(row[COL.urlEn]),
    sourceUrlFr: emptyToNull(row[COL.urlFr]),
  };
}
