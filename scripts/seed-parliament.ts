/**
 * scripts/seed-parliament.ts
 *
 * Seeds PublicOfficial with current MPs (ourcommons.ca XML) and Senators
 * (sencanada.ca AJAX endpoint). Requires network access.
 * Idempotent: DELETEs rows where resolvedFrom = 'parliament' before inserting.
 * Does not touch rows from other sources ('ocl-comm-reports', 'manual-ministers', etc.).
 *
 * Run via:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-parliament.ts
 */

import { db } from "../src/lib/db";
import { seedParliament } from "../src/server/dpoh-registry/seed-parliament";

async function main() {
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  let result;
  try {
    result = await seedParliament();
  } finally {
    const sizeAfter = await db.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`[Final] DB size after:  ${sizeAfter[0]!.size}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`  MPs inserted:                    ${result.membersInserted}`);
  console.log(`  Senators inserted:               ${result.senatorsInserted}`);
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
