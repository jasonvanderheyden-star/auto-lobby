import { db } from "@/lib/db";
import {
  canonicalizeName,
  canonicalizeTitle,
  canonicalizeInstitution,
  dpohBasisFromTitle,
  type DpohBasis,
} from "./canonicalize";

interface OclTuple {
  dpohName: string;
  dpohTitle: string | null;
  institution: string;
  commCount: bigint;
  firstSeen: Date;
  lastSeen: Date;
}

interface DpohSeedRow {
  name: string;
  email: string | null;
  role: string;
  institutionId: string;
  isDpoh: boolean;
  dpohBasis: DpohBasis;
  ruleRef: string;
  resolvedFrom: string;
  confidence: number;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
}

export interface ExtractionResult {
  dpohsCreated: number;
  institutionsAutoCreated: number;
  institutionsAutoCreatedNames: string[];
  totalInstitutions: number;
  totalPublicOfficials: number;
}

/**
 * Extract DPOHs from OclPublicCommReport, canonicalize, dedupe, and bulk-insert
 * into PublicOfficial. Auto-grows InstitutionRegistry for unmatched institutions.
 * Idempotent: DELETEs rows where resolvedFrom = 'ocl-comm-reports' before inserting.
 * Other resolvedFrom namespaces (manual-ministers, parliament, geds, tbs-exempt) are untouched.
 */
export async function extractDpohsFromOcl(): Promise<ExtractionResult> {
  console.log("[Phase 2] Extracting DPOHs from OclPublicCommReport...");

  const tuples = await db.$queryRaw<OclTuple[]>`
    SELECT
      "dpohName",
      "dpohTitle",
      "institution",
      COUNT(*)::bigint as "commCount",
      MIN("communicationDate") as "firstSeen",
      MAX("communicationDate") as "lastSeen"
    FROM "OclPublicCommReport"
    GROUP BY "dpohName", "dpohTitle", "institution"
  `;
  console.log(`[Phase 2] ${tuples.length} unique tuples in OCL data`);

  const existingInsts = await db.institutionRegistry.findMany({
    select: { id: true, name: true, acronym: true },
  });
  const instByName = new Map<string, string>();
  const instByAcronym = new Map<string, string>();
  for (const inst of existingInsts) {
    instByName.set(inst.name.toLowerCase(), inst.id);
    if (inst.acronym) instByAcronym.set(inst.acronym.toLowerCase(), inst.id);
  }

  type ProcessedTuple = {
    canonName: string;
    canonTitle: string | null;
    canonInstName: string;
    canonAcronym: string | null;
    firstSeen: Date;
  };
  const processed: ProcessedTuple[] = [];
  const missingInsts = new Map<string, { name: string; acronym: string | null }>();

  for (const t of tuples) {
    const canonName = canonicalizeName(t.dpohName);
    if (!canonName) continue;
    const canonTitle = canonicalizeTitle(t.dpohTitle);
    const { name: canonInstName, acronym: canonAcronym } = canonicalizeInstitution(t.institution);
    if (!canonInstName) continue;

    processed.push({ canonName, canonTitle, canonInstName, canonAcronym, firstSeen: t.firstSeen });

    const lookupKey = canonInstName.toLowerCase();
    const acronymKey = canonAcronym?.toLowerCase();
    if (!instByName.has(lookupKey) && !(acronymKey && instByAcronym.has(acronymKey))) {
      if (!missingInsts.has(lookupKey)) {
        missingInsts.set(lookupKey, { name: canonInstName, acronym: canonAcronym });
      }
    }
  }

  const txResult = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('DELETE FROM "PublicOfficial" WHERE "resolvedFrom" = \'ocl-comm-reports\'');

      let institutionsAutoCreated = 0;
      const autoCreatedNames: string[] = [];
      for (const inst of missingInsts.values()) {
        const created = await tx.institutionRegistry.create({
          data: {
            name: inst.name,
            acronym: inst.acronym,
            jurisdiction: "federal",
            domains: [],
            isDpohSource: true,
          },
        });
        instByName.set(inst.name.toLowerCase(), created.id);
        if (inst.acronym) instByAcronym.set(inst.acronym.toLowerCase(), created.id);
        institutionsAutoCreated++;
        autoCreatedNames.push(inst.name);
      }

      const seen = new Set<string>();
      const rows: DpohSeedRow[] = [];
      for (const p of processed) {
        const lookupKey = p.canonInstName.toLowerCase();
        const acronymKey = p.canonAcronym?.toLowerCase();
        const instId =
          instByName.get(lookupKey) ?? (acronymKey ? instByAcronym.get(acronymKey) : undefined);
        if (!instId) continue;
        const role = p.canonTitle ?? "Unknown";
        const dedupKey = `${p.canonName.toLowerCase()}|${role.toLowerCase()}|${instId}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const { basis, ruleRef } = dpohBasisFromTitle(p.canonTitle);
        rows.push({
          name: p.canonName,
          email: null,
          role,
          institutionId: instId,
          isDpoh: true,
          dpohBasis: basis,
          ruleRef,
          resolvedFrom: "ocl-comm-reports",
          confidence: 0.7,
          effectiveFrom: p.firstSeen,
          effectiveUntil: null,
        });
      }

      console.log(`[Phase 2] Inserting ${rows.length} DPOH rows in batches of 1000...`);
      const BATCH = 1000;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const created = await tx.publicOfficial.createMany({
          data: batch,
          skipDuplicates: true,
        });
        inserted += created.count;
      }

      return { dpohsCreated: inserted, institutionsAutoCreated, autoCreatedNames };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  const totalInsts = await db.institutionRegistry.count();
  const totalOfficials = await db.publicOfficial.count();

  console.log(
    `[Phase 2] Done. ${txResult.dpohsCreated} DPOHs created, ${txResult.institutionsAutoCreated} institutions auto-grown.`,
  );

  return {
    dpohsCreated: txResult.dpohsCreated,
    institutionsAutoCreated: txResult.institutionsAutoCreated,
    institutionsAutoCreatedNames: txResult.autoCreatedNames.slice(0, 20),
    totalInstitutions: totalInsts,
    totalPublicOfficials: totalOfficials,
  };
}
