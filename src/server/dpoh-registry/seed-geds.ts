import { db } from "@/lib/db";
import { dpohBasisFromTitle } from "./canonicalize";
import { fetchGeds, type GedsRow } from "./fetch-geds";

export interface SeedGedsResult {
  dmsInserted: number;
  admsInserted: number;
  admError: string | null;
  institutionsAutoCreated: number;
  institutionsAutoCreatedNames: string[];
  totalPublicOfficials: number;
}

export async function seedGeds(): Promise<SeedGedsResult> {
  console.log("[2h] Fetching DMs from GEDS and probing ADM API...");
  const { dms, adms, admError } = await fetchGeds();
  console.log(`[2h] Fetched ${dms.length} DMs, ${adms.length} ADMs`);
  if (admError) {
    console.warn(`[2h] ADM API unavailable — ADMs will be 0 this run:\n  ${admError.split("\n")[0]}`);
  }

  const existingInsts = await db.institutionRegistry.findMany({
    select: { id: true, name: true },
  });
  const instByName = new Map<string, string>();
  for (const inst of existingInsts) {
    instByName.set(inst.name.toLowerCase(), inst.id);
  }

  const allRows = [...dms, ...adms];
  const neededInsts = new Set<string>();
  for (const row of allRows) {
    if (!instByName.has(row.institution.toLowerCase())) {
      neededInsts.add(row.institution);
    }
  }

  const txResult = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        'DELETE FROM "PublicOfficial" WHERE "resolvedFrom" = \'geds\'',
      );

      let institutionsAutoCreated = 0;
      const institutionsAutoCreatedNames: string[] = [];
      for (const instName of neededInsts) {
        const created = await tx.institutionRegistry.create({
          data: {
            name: instName,
            acronym: null,
            jurisdiction: "federal",
            domains: [],
            isDpohSource: true,
          },
        });
        instByName.set(instName.toLowerCase(), created.id);
        institutionsAutoCreated++;
        institutionsAutoCreatedNames.push(instName);
      }

      function buildRows(fetchRows: GedsRow[]) {
        return fetchRows.map((r) => {
          const institutionId = instByName.get(r.institution.toLowerCase());
          if (!institutionId) {
            throw new Error(
              `Institution not resolved: "${r.institution}" for ${r.name}`,
            );
          }
          const { basis, ruleRef } = dpohBasisFromTitle(r.role);
          return {
            name: r.name,
            email: null as string | null,
            role: r.role,
            institutionId,
            isDpoh: true,
            dpohBasis: basis as string,
            ruleRef,
            resolvedFrom: "geds",
            confidence: 0.95,
            effectiveFrom: null as Date | null,
            effectiveUntil: null as Date | null,
          };
        });
      }

      const dmResult = await tx.publicOfficial.createMany({
        data: buildRows(dms),
        skipDuplicates: true,
      });
      const admResult = await tx.publicOfficial.createMany({
        data: buildRows(adms),
        skipDuplicates: true,
      });

      return {
        dmsInserted: dmResult.count,
        admsInserted: admResult.count,
        institutionsAutoCreated,
        institutionsAutoCreatedNames,
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  const totalPublicOfficials = await db.publicOfficial.count();

  return { ...txResult, admError, totalPublicOfficials };
}
