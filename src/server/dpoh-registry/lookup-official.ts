import { db } from "@/lib/db";
import { canonicalizeName } from "./canonicalize";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PublicOfficialLite {
  id: string;
  name: string;
  role: string;
  isDpoh: boolean;
  dpohBasis: string | null;
  ruleRef: string | null;
  confidence: number;
}

// Shape returned by $queryRaw — Postgres returns booleans and numbers as-is
// but the column names are camelCase (quoted in the schema).
interface RawOfficialRow {
  id: string;
  name: string;
  role: string;
  isDpoh: boolean;
  dpohBasis: string | null;
  ruleRef: string | null;
  confidence: number;
}

// ── Email lookup ─────────────────────────────────────────────────────────────

export async function lookupOfficialByEmail(
  email: string,
): Promise<PublicOfficialLite | null> {
  return db.publicOfficial.findFirst({
    where: { email },
    orderBy: { confidence: "desc" },
    select: {
      id: true,
      name: true,
      role: true,
      isDpoh: true,
      dpohBasis: true,
      ruleRef: true,
      confidence: true,
    },
  });
}

// ── Name lookup with trigram fallback ────────────────────────────────────────

/**
 * Resolves a display name to a PublicOfficial at a given institution.
 *
 * Strategy:
 * 1. Canonicalize the input name (strip honorifics, post-nominals).
 * 2. Try exact case-insensitive match.
 * 3. If no exact match, try pg_trgm trigram similarity ≥ 0.45 as fallback.
 *    Returns the highest-similarity result. Confidence is reduced slightly
 *    (multiplied by 0.85) to reflect lower certainty on fuzzy matches.
 *
 * Anti-over-reporting: if the input has fewer than 2 words after
 * canonicalization, skip fuzzy matching entirely — too ambiguous.
 */
export async function lookupOfficialByNameAtInstitution(
  rawName: string,
  institutionId: string,
): Promise<{ official: PublicOfficialLite; fuzzy: boolean } | null> {
  const name = canonicalizeName(rawName);

  // Safety: skip fuzzy for single-word names (too many false positives)
  const wordCount = name.trim().split(/\s+/).length;

  // 1. Exact case-insensitive match
  const exact = await db.publicOfficial.findFirst({
    where: { institutionId, name: { equals: name, mode: "insensitive" } },
    orderBy: { confidence: "desc" },
    select: {
      id: true,
      name: true,
      role: true,
      isDpoh: true,
      dpohBasis: true,
      ruleRef: true,
      confidence: true,
    },
  });
  if (exact) return { official: exact, fuzzy: false };

  // 2. Trigram similarity fallback (requires pg_trgm extension + GIN index)
  if (wordCount < 2) return null;

  const rows = await db.$queryRaw<RawOfficialRow[]>`
    SELECT id, name, role, "isDpoh", "dpohBasis", "ruleRef", confidence
    FROM "PublicOfficial"
    WHERE "institutionId" = ${institutionId}
      AND similarity(name, ${name}) >= 0.45
    ORDER BY similarity(name, ${name}) DESC
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const fuzzyMatch = rows[0]!;
  return {
    official: {
      ...fuzzyMatch,
      // Reduce confidence slightly to reflect lower certainty on fuzzy match
      confidence: Math.round(fuzzyMatch.confidence * 85) / 100,
    },
    fuzzy: true,
  };
}
