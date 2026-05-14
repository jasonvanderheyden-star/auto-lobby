/**
 * scripts/seed-exempt-staff.ts
 *
 * Seeds PublicOfficial with ministerial exempt staff from GEDS org-tree traversal.
 * For each cabinet minister, searches GEDS by name, navigates to their ministerial office
 * org unit, and collects direct reports + one level of sub-orgs.
 * Idempotent: DELETEs rows where resolvedFrom = 'tbs-exempt' before inserting.
 * Does not touch rows from other sources.
 *
 * Run via:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-exempt-staff.ts
 */

import { db } from "../src/lib/db";
import { seedExemptStaff } from "../src/server/dpoh-registry/seed-exempt-staff";

async function main() {
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  let result;
  try {
    result = await seedExemptStaff();
  } finally {
    const sizeAfter = await db.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`[Final] DB size after:  ${sizeAfter[0]!.size}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`  Staff inserted:                  ${result.staffInserted}`);
  console.log(`  Ministers skipped:               ${result.ministersSkipped.length}`);
  console.log(`  Institutions auto-created:       ${result.institutionsAutoCreated}`);
  if (result.institutionsAutoCreatedNames.length > 0) {
    for (const name of result.institutionsAutoCreatedNames) {
      console.log(`    - ${name}`);
    }
  }
  console.log(`  Total PublicOfficial (all srcs): ${result.totalPublicOfficials}`);
  console.log("──────────────────────────────────────────────────────────────────\n");

  if (result.ministersSkipped.length > 0) {
    console.log("Skipped ministers:");
    for (const { ministerName, reason } of result.ministersSkipped) {
      console.log(`  ${ministerName}: ${reason}`);
    }
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
