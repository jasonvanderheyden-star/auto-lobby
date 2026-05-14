import { db } from "@/lib/db";
import { fetchExemptStaff, type ExemptStaffRow } from "./fetch-exempt-staff";

export interface SeedExemptStaffResult {
  staffInserted: number;
  ministersSkipped: Array<{ ministerName: string; reason: string }>;
  institutionsAutoCreated: number;
  institutionsAutoCreatedNames: string[];
  totalPublicOfficials: number;
}

export async function seedExemptStaff(): Promise<SeedExemptStaffResult> {
  const { staff, skipped } = await fetchExemptStaff();

  const existingInsts = await db.institutionRegistry.findMany({
    select: { id: true, name: true },
  });
  const instByName = new Map<string, string>();
  for (const inst of existingInsts) {
    instByName.set(inst.name.toLowerCase(), inst.id);
  }

  const neededInsts = new Set<string>();
  for (const row of staff) {
    if (!instByName.has(row.institution.toLowerCase())) {
      neededInsts.add(row.institution);
    }
  }

  const txResult = await db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        'DELETE FROM "PublicOfficial" WHERE "resolvedFrom" = \'tbs-exempt\'',
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

      function buildRows(rows: ExemptStaffRow[]) {
        return rows.map((r) => {
          const institutionId = instByName.get(r.institution.toLowerCase());
          if (!institutionId) {
            throw new Error(`Institution not resolved: "${r.institution}" for ${r.name}`);
          }
          return {
            name: r.name,
            email: null as string | null,
            role: r.role,
            institutionId,
            isDpoh: true,
            dpohBasis: "position-designation",
            ruleRef: "Designated Public Office Holder Regulations Item 11 (PSEA s. 127.1)",
            resolvedFrom: "tbs-exempt",
            confidence: 0.9,
            effectiveFrom: null as Date | null,
            effectiveUntil: null as Date | null,
          };
        });
      }

      const result = await tx.publicOfficial.createMany({
        data: buildRows(staff),
        skipDuplicates: true,
      });

      return {
        staffInserted: result.count,
        institutionsAutoCreated,
        institutionsAutoCreatedNames,
      };
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  const totalPublicOfficials = await db.publicOfficial.count();

  return {
    ...txResult,
    ministersSkipped: skipped,
    totalPublicOfficials,
  };
}
