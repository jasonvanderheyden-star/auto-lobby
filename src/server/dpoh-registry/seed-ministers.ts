import { db } from "@/lib/db";
import { dpohBasisFromTitle } from "./canonicalize";
import { fetchMinisters, type MinisterFetchRow } from "./fetch-ministers";

export interface SeedMinistersResult {
  ministersInserted: number;
  parlSecsInserted: number;
  institutionsAutoCreated: number;
  institutionsAutoCreatedNames: string[];
  totalPublicOfficials: number;
}

export async function seedMinisters(): Promise<SeedMinistersResult> {
  console.log("[2f] Fetching current cabinet from canada.ca...");
  const { cabinetMinisters, parliamentarySecretaries } = await fetchMinisters();
  console.log(
    `[2f] Fetched ${cabinetMinisters.length} cabinet ministers, ` +
      `${parliamentarySecretaries.length} parliamentary secretaries`,
  );

  const existingInsts = await db.institutionRegistry.findMany({
    select: { id: true, name: true },
  });
  const instByName = new Map<string, string>();
  for (const inst of existingInsts) {
    instByName.set(inst.name.toLowerCase(), inst.id);
  }

  const allRows = [...cabinetMinisters, ...parliamentarySecretaries];
  const neededInsts = new Set<string>();
  for (const row of allRows) {
    if (!instByName.has(row.institution.toLowerCase())) {
      neededInsts.add(row.institution);
    }
  }

  const txResult = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        'DELETE FROM "PublicOfficial" WHERE "resolvedFrom" = \'manual-ministers\'',
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

      function buildRows(fetchRows: MinisterFetchRow[]) {
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
            resolvedFrom: "manual-ministers",
            confidence: 1.0,
            effectiveFrom: new Date(r.effectiveFrom),
            effectiveUntil: null as Date | null,
          };
        });
      }

      const mResult = await tx.publicOfficial.createMany({
        data: buildRows(cabinetMinisters),
        skipDuplicates: true,
      });
      const psResult = await tx.publicOfficial.createMany({
        data: buildRows(parliamentarySecretaries),
        skipDuplicates: true,
      });

      return {
        ministersInserted: mResult.count,
        parlSecsInserted: psResult.count,
        institutionsAutoCreated,
        institutionsAutoCreatedNames,
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  const totalPublicOfficials = await db.publicOfficial.count();

  return { ...txResult, totalPublicOfficials };
}
