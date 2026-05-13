/**
 * scripts/seed-ministers.ts
 *
 * Seeds PublicOfficial with current cabinet ministers + parliamentary secretaries.
 * Fetches live from canada.ca — requires network access.
 * Idempotent: DELETEs rows where resolvedFrom = 'manual-ministers' before inserting.
 *
 * Run via:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-ministers.ts
 */

import { db } from "../src/lib/db";
import { seedMinisters } from "../src/server/dpoh-registry/seed-ministers";

async function main() {
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  let result;
  try {
    result = await seedMinisters();
  } finally {
    const sizeAfter = await db.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`[Final] DB size after:  ${sizeAfter[0]!.size}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`  Cabinet ministers inserted:      ${result.ministersInserted}`);
  console.log(`  Parliamentary secretaries:       ${result.parlSecsInserted}`);
  console.log(`  Institutions auto-created:       ${result.institutionsAutoCreated}`);
  if (result.institutionsAutoCreatedNames.length > 0) {
    for (const name of result.institutionsAutoCreatedNames) {
      console.log(`    - ${name}`);
    }
  }
  console.log(`  Total PublicOfficial (all srcs): ${result.totalPublicOfficials}`);
  console.log("──────────────────────────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
