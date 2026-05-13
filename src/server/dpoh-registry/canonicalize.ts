/**
 * Canonicalize OCL comm-report DPOH fields for dedup and matching.
 */

const TITLE_TYPOS: Record<string, string> = {
  "member of parliment": "Member of Parliament",
};

const TITLE_ABBREV_EXPAND: Record<string, string> = {
  "dm": "Deputy Minister",
  "adm": "Assistant Deputy Minister",
  "asst dm": "Assistant Deputy Minister",
};

export function canonicalizeName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(the honourable|honourable|the hon\.|hon\.|mr\.|mrs\.|ms\.|dr\.)\s+/i, "");
  s = s.replace(/,?\s+(p\.c\.|pc|m\.p\.|mp|q\.c\.|qc|c\.m\.|cm|c\.c\.|cc|o\.c\.|oc)$/i, "");
  return s.replace(/\s+/g, " ").trim();
}

export function canonicalizeTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (TITLE_TYPOS[lower]) return TITLE_TYPOS[lower];
  if (TITLE_ABBREV_EXPAND[lower]) return TITLE_ABBREV_EXPAND[lower];
  return trimmed.replace(/\s+/g, " ");
}

export function canonicalizeInstitution(raw: string): { name: string; acronym: string | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+?)\s*\(([A-Za-z\-]{2,12})\)\s*$/);
  if (match) return { name: match[1]!.trim(), acronym: match[2]!.trim().toUpperCase() };
  return { name: trimmed, acronym: null };
}

export type DpohBasis = "role" | "position-designation" | "office-designation";

export function dpohBasisFromTitle(title: string | null): { basis: DpohBasis; ruleRef: string } {
  if (!title) return { basis: "position-designation", ruleRef: "Lobbying Act s. 2(1) DPOH" };
  const t = title.toLowerCase();
  if (t.includes("member of parliament") || t.includes("senator")) {
    return { basis: "role", ruleRef: "Lobbying Act s. 2(1) 'designated public office holder' (b)" };
  }
  if (t.includes("deputy minister") || t.includes("associate deputy minister") || t.includes("assistant deputy minister")) {
    return { basis: "position-designation", ruleRef: "Designated Public Office Holder Regulations s. 2(1)" };
  }
  if (t.includes("minister") || t.includes("parliamentary secretary")) {
    return { basis: "role", ruleRef: "Lobbying Act s. 2(1) 'designated public office holder' (a)" };
  }
  return { basis: "position-designation", ruleRef: "Lobbying Act s. 2(1) DPOH" };
}
