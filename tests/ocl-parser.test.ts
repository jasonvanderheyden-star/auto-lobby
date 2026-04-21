/**
 * tests/ocl-parser.test.ts
 *
 * Unit tests for OCL CSV parsing utilities.
 * Tests focus on the tricky cases the OCL data actually contains:
 *   - French accented characters (Windows-1252 decoded to UTF-8)
 *   - "null" sentinel values
 *   - Empty optional fields
 *   - Terminated vs. active status derivation
 *   - Subject-code decoding
 */

import { describe, it, expect } from "vitest";
import {
  parseOclNull,
  parseOclDate,
  deriveStatus,
  buildRegistrantName,
  decodeSubjectCode,
  buildSubjectCodeLookup,
  buildRegistrationRecord,
  buildCommRecord,
} from "../scripts/ocl-utils";

// ─── parseOclNull ─────────────────────────────────────────────────────────

describe("parseOclNull", () => {
  it('converts the "null" sentinel to null', () => {
    expect(parseOclNull("null")).toBeNull();
  });

  it("is case-insensitive for the sentinel", () => {
    expect(parseOclNull("NULL")).toBeNull();
    expect(parseOclNull("Null")).toBeNull();
  });

  it("converts empty string to null", () => {
    expect(parseOclNull("")).toBeNull();
  });

  it("converts whitespace-only to null", () => {
    expect(parseOclNull("   ")).toBeNull();
  });

  it("returns trimmed non-null string", () => {
    expect(parseOclNull("  Énergie  ")).toBe("Énergie");
  });

  it("handles undefined", () => {
    expect(parseOclNull(undefined)).toBeNull();
  });
});

// ─── parseOclDate ─────────────────────────────────────────────────────────

describe("parseOclDate", () => {
  it("parses a standard YYYY-MM-DD date", () => {
    const d = parseOclDate("2024-03-15");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCFullYear()).toBe(2024);
    expect(d?.getUTCMonth()).toBe(2); // 0-indexed
    expect(d?.getUTCDate()).toBe(15);
  });

  it('returns null for the "null" sentinel', () => {
    expect(parseOclDate("null")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseOclDate("")).toBeNull();
  });

  it("returns null for an unparseable string", () => {
    expect(parseOclDate("not-a-date")).toBeNull();
  });
});

// ─── deriveStatus ─────────────────────────────────────────────────────────

describe("deriveStatus", () => {
  it('returns "Active" when END_DATE_FIN is the null sentinel', () => {
    expect(deriveStatus("null")).toBe("Active");
  });

  it('returns "Active" when END_DATE_FIN is empty', () => {
    expect(deriveStatus("")).toBe("Active");
  });

  it('returns "Active" when END_DATE_FIN is undefined', () => {
    expect(deriveStatus(undefined)).toBe("Active");
  });

  it('returns "Terminated" when a real end date is present', () => {
    expect(deriveStatus("2023-12-31")).toBe("Terminated");
  });
});

// ─── buildRegistrantName ──────────────────────────────────────────────────

describe("buildRegistrantName", () => {
  it("combines first and last name in display order", () => {
    expect(buildRegistrantName("Tremblay", "Jean")).toBe("Jean Tremblay");
  });

  it("handles missing first name gracefully", () => {
    expect(buildRegistrantName("Smith", "null")).toBe("Smith");
  });

  it("handles missing last name gracefully", () => {
    expect(buildRegistrantName("null", "Alice")).toBe("Alice");
  });

  it("returns null when both parts are absent", () => {
    expect(buildRegistrantName("null", "null")).toBeNull();
    expect(buildRegistrantName(undefined, undefined)).toBeNull();
  });
});

// ─── subject-code decode ──────────────────────────────────────────────────

describe("buildSubjectCodeLookup / decodeSubjectCode", () => {
  const sampleCodeRows = [
    { SUBJECT_CODE_OBJET: "SMT-11", SMT_EN_DESC: "Energy", SMT_FR_DESC: "Énergie" },
    { SUBJECT_CODE_OBJET: "SMT-13", SMT_EN_DESC: "Environment", SMT_FR_DESC: "Environnement" },
    { SUBJECT_CODE_OBJET: "SMT-41", SMT_EN_DESC: "Climate", SMT_FR_DESC: "Climat" },
  ];

  it("builds a lookup map from code rows", () => {
    const map = buildSubjectCodeLookup(sampleCodeRows);
    expect(map.size).toBe(3);
    expect(map.get("SMT-11")).toBe("Energy");
    expect(map.get("SMT-41")).toBe("Climate");
  });

  it("decodes a known code to its English description", () => {
    const map = buildSubjectCodeLookup(sampleCodeRows);
    expect(decodeSubjectCode("SMT-13", map)).toBe("Environment");
  });

  it("falls back to the raw code for unknown entries", () => {
    const map = buildSubjectCodeLookup(sampleCodeRows);
    expect(decodeSubjectCode("SMT-99", map)).toBe("SMT-99");
  });
});

// ─── buildRegistrationRecord (tricky rows) ────────────────────────────────

describe("buildRegistrationRecord", () => {
  it("handles a French accented company name (Windows-1252 decoded)", () => {
    // Simulates a row where iconv-lite has already decoded Windows-1252 bytes
    // to UTF-8, so accented characters arrive correctly here.
    const row = {
      REG_ID_ENR: "999001",
      REG_NUM_ENR: "112233-4455-1",
      EN_CLIENT_ORG_CORP_NM_AN: "Énergie Atomique du Québec",
      FR_CLIENT_ORG_CORP_NM: "null",
      RGSTRNT_LAST_NM_DCLRNT: "Tremblay",
      RGSTRNT_1ST_NM_PRENOM_DCLRNT: "Jean",
      EFFECTIVE_DATE_VIGUEUR: "2024-01-15",
      END_DATE_FIN: "null",
    };

    const record = buildRegistrationRecord(row, ["Climate", "Energy"], ["ECCC"]);

    expect(record).not.toBeNull();
    expect(record!.companyName).toBe("Énergie Atomique du Québec");
    expect(record!.registrantName).toBe("Jean Tremblay");
    expect(record!.status).toBe("Active");
    expect(record!.subjects).toEqual(["Climate", "Energy"]);
    expect(record!.institutions).toEqual(["ECCC"]);
    expect(record!.effectiveDate).toEqual(new Date("2024-01-15"));
  });

  it("handles a row with empty optional fields and a terminated status", () => {
    const row = {
      REG_ID_ENR: "999002",
      REG_NUM_ENR: "112233-4456-1",
      EN_CLIENT_ORG_CORP_NM_AN: "Some Company Inc.",
      FR_CLIENT_ORG_CORP_NM: "null",
      RGSTRNT_LAST_NM_DCLRNT: "Smith",
      RGSTRNT_1ST_NM_PRENOM_DCLRNT: "null", // first name absent
      EFFECTIVE_DATE_VIGUEUR: "null",         // no effective date
      END_DATE_FIN: "2023-06-30",             // terminated
    };

    const record = buildRegistrationRecord(row, [], []);

    expect(record).not.toBeNull();
    expect(record!.registrantName).toBe("Smith"); // last-name-only fallback
    expect(record!.effectiveDate).toBeNull();
    expect(record!.status).toBe("Terminated");
    expect(record!.subjects).toEqual([]);
    expect(record!.institutions).toEqual([]);
  });

  it("falls back to French name when English name is null", () => {
    const row = {
      REG_ID_ENR: "999003",
      REG_NUM_ENR: "112233-4457-1",
      EN_CLIENT_ORG_CORP_NM_AN: "null",
      FR_CLIENT_ORG_CORP_NM: "Société Québécoise de l'Énergie",
      RGSTRNT_LAST_NM_DCLRNT: "null",
      RGSTRNT_1ST_NM_PRENOM_DCLRNT: "null",
      EFFECTIVE_DATE_VIGUEUR: "2023-03-01",
      END_DATE_FIN: "null",
    };

    const record = buildRegistrationRecord(row, [], []);

    expect(record!.companyName).toBe("Société Québécoise de l'Énergie");
    expect(record!.registrantName).toBeNull();
  });

  it("returns null when mandatory id is missing", () => {
    const row = {
      REG_ID_ENR: "null",
      REG_NUM_ENR: "null",
      EN_CLIENT_ORG_CORP_NM_AN: "No ID Company",
    };
    expect(buildRegistrationRecord(row, [], [])).toBeNull();
  });
});

// ─── buildCommRecord ──────────────────────────────────────────────────────

describe("buildCommRecord", () => {
  it("builds a valid comm record from a standard row", () => {
    const row = {
      COMLOG_ID: "55001",
      CLIENT_ORG_CORP_NUM: "4993",
      EN_CLIENT_ORG_CORP_NM_AN: "Sleeman Breweries Ltd.",
      REGISTRANT_NUM_DECLARANT: "777408",
      COMM_DATE: "2024-03-10",
    };

    const record = buildCommRecord(
      row,
      "Finance Canada",
      "Jane Doe",
      "Assistant Deputy Minister",
      ["Taxation and Finance"],
    );

    expect(record).not.toBeNull();
    expect(record!.id).toBe("55001");
    expect(record!.registrationId).toBe("4993");
    expect(record!.communicationDate).toEqual(new Date("2024-03-10"));
    expect(record!.institution).toBe("Finance Canada");
    expect(record!.dpohName).toBe("Jane Doe");
    expect(record!.dpohTitle).toBe("Assistant Deputy Minister");
    expect(record!.subjects).toEqual(["Taxation and Finance"]);
  });

  it("returns null when COMM_DATE is missing", () => {
    const row = {
      COMLOG_ID: "55002",
      CLIENT_ORG_CORP_NUM: "4993",
      COMM_DATE: "null",
    };
    expect(buildCommRecord(row, "ECCC", "Unknown", null, [])).toBeNull();
  });
});
