/**
 * scripts/seed-geds.ts
 *
 * Seeds PublicOfficial with Deputy Ministers from GEDS (geds-sage.gc.ca).
 * ADMs from the GEDS open data API are included when the API is available
 * (currently returning 403 — see fetch-geds.ts for the follow-up plan).
 * Idempotent: DELETEs rows where resolvedFrom = 'geds' before inserting.
 * Does not touch rows from other sources ('ocl-comm-reports', 'manual-ministers',
 * 'parliament', 'tbs-exempt').
 *
 * Run via:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/seed-geds.ts
 */

import { db } from "../src/lib/db";
import { seedGeds } from "../src/server/dpoh-registry/seed-geds";

async function main() {
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) as size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  let result;
  try {
    result = await seedGeds();
  } finally {
    const sizeAfter = await db.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log(`[Final] DB size after:  ${sizeAfter[0]!.size}`);
  }

  console.log("\n──────────────────────────────────────────────────────────────────");
  console.log(`  DMs inserted:                    ${result.dmsInserted}`);
  console.log(`  ADMs inserted:                   ${result.admsInserted}${result.admError ? " (API unavailable)" : ""}`);
  console.log(`  Institutions auto-created:       ${result.institutionsAutoCreated}`);
  if (result.institutionsAutoCreatedNames.length > 0) {
    for (const name of result.institutionsAutoCreatedNames) {
      console.log(`    - ${name}`);
    }
  }
  console.log(`  Total PublicOfficial (all srcs): ${result.totalPublicOfficials}`);
  console.log("──────────────────────────────────────────────────────────────────\n");

  if (result.admError) {
    console.log("ADM API error (ADMs deferred to follow-up chunk):");
    console.log(`  ${result.admError.split("\n")[0]}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
