/**
 * scripts/ocl-utils.ts
 *
 * Pure parsing utilities for OCL open-data CSV rows.
 * No I/O, no database calls — exported for unit testing.
 *
 * Data quirks this module handles
 * ────────────────────────────────
 * - "null" sentinel: OCL CSVs use the literal string "null" for absent values.
 * - Encoding: source files are Windows-1252; callers must transcode before
 *   reaching these functions (iconv-lite in import-ocl.ts).
 * - Mixed date formats: most are YYYY-MM-DD but some rows have empty/null.
 * - Bilingual fields: EN_ and FR_ variants; prefer English, fall back to French.
 * - Subject codes: stored as SMT-N codes; callers supply a decoded lookup map.
 * - registrationId link: OclPublicCommReport.registrationId stores
 *   CLIENT_ORG_CORP_NUM, which is the middle segment of REG_NUM_ENR
 *   (e.g. "777408-4993-4" → clientOrgNum = "4993"). The detail page
 *   uses this to join comms back to registrations.
 */

import type { Prisma } from "@prisma/client";

// ─── Row types (keyed by CSV column headers) ──────────────────────────────

export type RegistrationRow = Record<string, string>;
export type CommRow = Record<string, string>;
export type DpohRow = Record<string, string>;
export type SubjectCodeRow = Record<string, string>;

// ─── Output types (match Prisma schema fields) ────────────────────────────

export interface OclRegistrationRecord {
  id: string;
  registrationNum: string;
  companyName: string;
  registrantName: string | null;
  subjects: string[];
  institutions: string[];
  status: string;
  effectiveDate: Date | null;
  rawPayload: Prisma.InputJsonValue;
}

export interface OclCommRecord {
  id: string;
  registrationId: string;
  communicationDate: Date;
  institution: string;
  dpohName: string;
  dpohTitle: string | null;
  subjects: string[];
  rawPayload: Prisma.InputJsonValue;
}

// ─── Primitive parsers ────────────────────────────────────────────────────

/**
 * Convert the OCL "null" sentinel (and whitespace-only strings) to null.
 * Everything else is returned trimmed.
 */
export function parseOclNull(val: string | undefined): string | null {
  if (val === undefined || val === null) return null;
  const t = val.trim();
  if (t === "" || t.toLowerCase() === "null") return null;
  return t;
}

/**
 * Parse an OCL date string (YYYY-MM-DD) to a Date, or null if absent/invalid.
 */
export function parseOclDate(val: string | undefined): Date | null {
  const s = parseOclNull(val);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Derive registration status from the END_DATE_FIN field.
 * - "null" / empty → "Active" (registration is open)
 * - Any real date   → "Terminated"
 */
export function deriveStatus(endDateVal: string | undefined): string {
  return parseOclNull(endDateVal) !== null ? "Terminated" : "Active";
}

/**
 * Build a display name "FirstName LastName" from separate columns.
 * Returns null when both parts are absent.
 */
export function buildRegistrantName(
  lastNameVal: string | undefined,
  firstNameVal: string | undefined,
): string | null {
  const last = parseOclNull(lastNameVal);
  const first = parseOclNull(firstNameVal);
  if (!last && !first) return null;
  return [first, last].filter(Boolean).join(" ");
}

/**
 * Decode a subject code ("SMT-11") to its English description ("Energy")
 * using the lookup map built from Codes_SubjectMatterTypesExport.csv.
 * Falls back to the raw code if not found.
 */
export function decodeSubjectCode(
  code: string,
  lookup: ReadonlyMap<string, string>,
): string {
  return lookup.get(code) ?? code;
}

/**
 * Build a subject-code lookup map from parsed Codes_SubjectMatterTypesExport rows.
 * Input rows have keys: SUBJECT_CODE_OBJET, SMT_EN_DESC
 */
export function buildSubjectCodeLookup(
  rows: SubjectCodeRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const code = parseOclNull(row["SUBJECT_CODE_OBJET"]);
    const desc = parseOclNull(row["SMT_EN_DESC"]);
    if (code && desc) map.set(code, desc);
  }
  return map;
}

// ─── Record builders ──────────────────────────────────────────────────────

/**
 * Build an OclRegistrationRecord from a Registration_PrimaryExport row
 * plus pre-resolved subject names and institution names.
 *
 * Returns null if the row is missing mandatory id or registrationNum.
 */
export function buildRegistrationRecord(
  row: RegistrationRow,
  subjects: string[],
  institutions: string[],
): OclRegistrationRecord | null {
  const id = parseOclNull(row["REG_ID_ENR"]);
  const registrationNum = parseOclNull(row["REG_NUM_ENR"]);
  if (!id || !registrationNum) return null;

  // Prefer English company name; fall back to French (still useful for search)
  const companyName =
    parseOclNull(row["EN_CLIENT_ORG_CORP_NM_AN"]) ??
    parseOclNull(row["FR_CLIENT_ORG_CORP_NM"]) ??
    "(unnamed)";

  return {
    id,
    registrationNum,
    companyName,
    registrantName: buildRegistrantName(
      row["RGSTRNT_LAST_NM_DCLRNT"],
      row["RGSTRNT_1ST_NM_PRENOM_DCLRNT"],
    ),
    subjects,
    institutions,
    status: deriveStatus(row["END_DATE_FIN"]),
    effectiveDate: parseOclDate(row["EFFECTIVE_DATE_VIGUEUR"]),
    rawPayload: row as unknown as Prisma.InputJsonValue,
  };
}

/**
 * Build an OclCommRecord from a Communication_PrimaryExport row
 * plus pre-resolved institution, DPOH info, and subject names.
 *
 * Returns null if the row is missing mandatory id or communicationDate.
 */
export function buildCommRecord(
  row: CommRow,
  institution: string,
  dpohName: string,
  dpohTitle: string | null,
  subjects: string[],
): OclCommRecord | null {
  const id = parseOclNull(row["COMLOG_ID"]);
  const registrationId = parseOclNull(row["CLIENT_ORG_CORP_NUM"]);
  const communicationDate = parseOclDate(row["COMM_DATE"]);

  if (!id || !registrationId || !communicationDate) return null;

  return {
    id,
    registrationId,
    communicationDate,
    institution,
    dpohName,
    dpohTitle,
    subjects,
    rawPayload: row as unknown as Prisma.InputJsonValue,
  };
}
