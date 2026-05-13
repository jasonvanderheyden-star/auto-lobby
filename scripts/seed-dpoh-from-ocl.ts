/**
 * scripts/seed-dpoh-from-ocl.ts
 *
 * Bootstraps PublicOfficial from OclPublicCommReport data.
 * Idempotent: DELETEs rows where resolvedFrom = 'ocl-comm-reports' before inserting.
 * Other resolvedFrom namespaces (manual-ministers, parliament, geds, tbs-exempt) are untouched.
 *
 * Run via:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-dpoh-from-ocl.ts
 */

import { db } from "@/lib/db";
import { extractDpohsFromOcl } from "@/server/dpoh-registry/extract-from-ocl";

async function main() {
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  const result = await extractDpohsFromOcl();

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`  DPOHs created:              ${result.dpohsCreated}`);
  console.log(`  Institutions auto-grown:    ${result.institutionsAutoCreated}`);
  if (result.institutionsAutoCreatedNames.length > 0) {
    console.log(`  Auto-grown names (first 20):`);
    for (const name of result.institutionsAutoCreatedNames) {
      console.log(`    - ${name}`);
    }
  }
  console.log(`  Total institutions:         ${result.totalInstitutions}`);
  console.log(`  Total public officials:     ${result.totalPublicOfficials}`);
  console.log("──────────────────────────────────────────────────────────────────\n");

  const sizeAfter = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Final] DB size after: ${sizeAfter[0]!.size}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
