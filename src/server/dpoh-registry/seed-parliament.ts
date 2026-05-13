import { db } from "@/lib/db";
import { dpohBasisFromTitle } from "./canonicalize";
import { fetchParliament, type ParliamentFetchRow } from "./fetch-parliament";

export interface SeedParliamentResult {
  membersInserted: number;
  senatorsInserted: number;
  institutionsAutoCreated: number;
  institutionsAutoCreatedNames: string[];
  totalPublicOfficials: number;
}

export async function seedParliament(): Promise<SeedParliamentResult> {
  console.log("[2g] Fetching current parliament from ourcommons.ca + sencanada.ca...");
  const { members, senators } = await fetchParliament();
  console.log(
    `[2g] Fetched ${members.length} MPs, ${senators.length} senators`,
  );

  const existingInsts = await db.institutionRegistry.findMany({
    select: { id: true, name: true },
  });
  const instByName = new Map<string, string>();
  for (const inst of existingInsts) {
    instByName.set(inst.name.toLowerCase(), inst.id);
  }

  const allRows = [...members, ...senators];
  const neededInsts = new Set<string>();
  for (const row of allRows) {
    if (!instByName.has(row.institution.toLowerCase())) {
      neededInsts.add(row.institution);
    }
  }

  const txResult = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        'DELETE FROM "PublicOfficial" WHERE "resolvedFrom" = \'parliament\'',
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

      function buildRows(fetchRows: ParliamentFetchRow[]) {
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
            resolvedFrom: "parliament",
            confidence: 0.95,
            effectiveFrom: null as Date | null,
            effectiveUntil: null as Date | null,
          };
        });
      }

      const mResult = await tx.publicOfficial.createMany({
        data: buildRows(members),
        skipDuplicates: true,
      });
      const sResult = await tx.publicOfficial.createMany({
        data: buildRows(senators),
        skipDuplicates: true,
      });

      return {
        membersInserted: mResult.count,
        senatorsInserted: sResult.count,
        institutionsAutoCreated,
        institutionsAutoCreatedNames,
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  const totalPublicOfficials = await db.publicOfficial.count();

  return { ...txResult, totalPublicOfficials };
}
