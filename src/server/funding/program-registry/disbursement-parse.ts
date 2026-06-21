/**
 * src/server/funding/program-registry/disbursement-parse.ts
 *
 * Pure parse/map helpers for the Proactive Disclosure — Grants & Contributions
 * disbursement feed (CKAN resource 1d15a62f). No I/O, no Prisma client — every
 * function is a pure transform so it can be unit-tested against fixture records
 * (mirrors the catalog-filters.ts / ocl-utils.ts split).
 *
 * Source field names (confirmed live 2026-06-19 + 2026-06-21):
 *   prog_name_en          → programNameRaw   (required, text)
 *   owner_org_title       → funder           (required, "EN | FR" pipe form)
 *   agreement_value       → amount           (text, plain numeric e.g. "95000.0")
 *   agreement_start_date  → disbursedOn      (ISO "YYYY-MM-DD" text)
 *   recipient_legal_name  → recipientName    (required)
 *   recipient_province    → recipientRegion  (nullable)
 *   prog_purpose_en       → purpose          (nullable)
 *
 * STORE-NULL DISCIPLINE (CLAUDE.md anti-over-reporting analog): a field is null
 * when the source value is absent or unparseable. We NEVER guess or synthesize a
 * value the source did not state. A row is DROPPED only when a REQUIRED non-null
 * field (recipientName / funder / programNameRaw) is empty.
 */

import { Prisma } from "@prisma/client";

// ─── Source record shape (projection we request) ────────────────────────────

export interface DisbursementRecord {
  prog_name_en?: unknown;
  owner_org_title?: unknown;
  agreement_value?: unknown;
  agreement_start_date?: unknown;
  recipient_legal_name?: unknown;
  recipient_province?: unknown;
  prog_purpose_en?: unknown;
}

// ─── Mapped shape (maps onto FundingDisbursement createMany input) ───────────

export interface MappedDisbursement {
  recipientName: string;
  recipientRegion: string | null;
  funder: string;
  programNameRaw: string;
  amount: Prisma.Decimal | null;
  disbursedOn: Date | null;
  purpose: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Coerce an unknown cell to a trimmed string ("" for null/undefined). */
function cell(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** Empty / whitespace-only → null; otherwise trimmed. */
function emptyToNull(v: unknown): string | null {
  const t = cell(v);
  return t === "" ? null : t;
}

/**
 * Parse an agreement value to a Decimal. Values are plain numeric text like
 * "95000.0"; we also tolerate stray currency symbols / thousands separators.
 * Returns null on anything that doesn't parse to a finite number (store-null
 * discipline — never guess a value).
 */
export function parseAmount(text: unknown): Prisma.Decimal | null {
  const raw = cell(text);
  if (raw === "") return null;
  // Strip currency symbols, commas, and spaces; keep digits, sign, decimal point.
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  try {
    return new Prisma.Decimal(cleaned);
  } catch {
    return null;
  }
}

/**
 * Parse an ISO "YYYY-MM-DD" agreement-start date to a Date (UTC midnight).
 * Returns null on absent/malformed/non-real dates (e.g. "2026-13-40"). Junk
 * sentinel dates like "1899-12-30" parse to a real Date here — they're excluded
 * later by the cutoff window, not by this parser.
 */
export function parseAgreementDate(text: unknown): Date | null {
  const raw = cell(text);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const dt = new Date(Date.UTC(year, month - 1, day));
  // Reject roll-over (e.g. month 13 / day 40 → a different real date).
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Window predicate: true iff `dateStr` parses to a real date >= cutoff.
 * Future-dated agreements (real future starts) are KEPT (>= cutoff, no upper
 * bound). Unparseable or pre-cutoff dates (incl. 1899 sentinels) → false.
 */
export function inWindow(dateStr: unknown, cutoff: Date): boolean {
  const d = parseAgreementDate(dateStr);
  return d != null && d.getTime() >= cutoff.getTime();
}

/**
 * Map a feed record to the FundingDisbursement shape, or null if a REQUIRED
 * field (recipientName / funder / programNameRaw) is empty.
 *
 * STORE-NULL DISCIPLINE (restated at the write site): recipientRegion, amount,
 * disbursedOn, and purpose are null when the source value is absent or
 * unparseable — never guessed. `funder` keeps the raw "EN | FR" pipe form; the
 * fuzzy join strips the FR side via split_part(funder,'|',1) at match time.
 */
export function mapRecordToDisbursement(
  record: DisbursementRecord,
): MappedDisbursement | null {
  const recipientName = cell(record.recipient_legal_name);
  const funder = cell(record.owner_org_title);
  const programNameRaw = cell(record.prog_name_en);

  // Drop only on an empty REQUIRED field.
  if (recipientName === "" || funder === "" || programNameRaw === "") return null;

  return {
    recipientName,
    funder,
    programNameRaw,
    recipientRegion: emptyToNull(record.recipient_province),
    amount: parseAmount(record.agreement_value),
    disbursedOn: parseAgreementDate(record.agreement_start_date),
    purpose: emptyToNull(record.prog_purpose_en),
  };
}

/**
 * Runtime cutoff = today − `years` (default 2 — windowed to fit Neon 0.5 GB
 * with re-runnable imports; see import script), at UTC midnight. Computed at
 * import time so the window slides; not a hardcoded date.
 */
export function cutoffFromNow(years = 2, now: Date = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()),
  );
}

/** Format a Date as "YYYY-MM-DD" (UTC) — for logging + sort-cutoff comparison. */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
