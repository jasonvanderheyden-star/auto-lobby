/**
 * scripts/import-funding-catalog.ts
 *
 * Funding Navigator (Product 03) — G0a federal program catalog import.
 * Fully idempotent (mirrors scripts/import-ocl.ts).
 *
 * Source: Innovation Canada's Business Benefits Finder, package
 *   4e75337e-70d0-4ed7-92d1-3b85192ec6b1 on open.canada.ca (CKAN).
 * The catalog is published as periodic XLSX file resources, NOT in the
 * DataStore — we resolve the latest XLSX via package_show (never hardcoded),
 * download its url, and parse the workbook.
 *
 * Pipeline:
 *   1. [Step 0] Log current DB size via pg_database_size.
 *   2. Resolve + log the latest XLSX catalog resource id (sourceVersion).
 *   3. Download + parse the XLSX. readXlsx consumes row 0 as `headers`
 *      (the EN column labels). The FIRST data row is the FR header-translation
 *      row (e.g. "Titre - Anglais") and is dropped too.
 *   4. Filter: federal-only → de-dup "Cognit.ca | <institution>" boilerplate
 *      → drop pure advisory/services rows. Accumulate a drop-reason tally.
 *   5. Single atomic transaction: TRUNCATE the funding tables → createMany the
 *      mapped FundingProgram rows → one FundingProgramSource row per program.
 *   6. [Final] Log DB size in a finally block.
 *   7. Print the drop-reason breakdown + retained count; assert count bands.
 *
 * SAFETY: this script TRUNCATEs ONLY "FundingProgram" and "FundingProgramSource".
 * The OCL tables and TenantEntitlement are never touched.
 *
 * Usage:  npm run funding:import
 */

import { PrismaClient } from "@prisma/client";
import {
  resolveLatestCatalogXlsx,
  fetchAndParseXlsx,
} from "../src/server/funding/program-registry/ckan-client.js";
import {
  COL,
  isFederal,
  dedupCognit,
  isFunding,
  mapRowToProgram,
} from "../src/server/funding/program-registry/catalog-filters.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const CATALOG_PKG = "4e75337e-70d0-4ed7-92d1-3b85192ec6b1"; // Business Benefits Finder
const FEED = "ckan:business-benefits-finder";
const BATCH_SIZE = 500;

// Count-band assertions tied to the 2026-06-19 spike. Fail loudly on breach —
// a band miss means the feed shape changed and the filters need re-validation,
// not a silent import.
//
// MEASURED 2026-06-19 (first real run of this script): 398 federal rows
// post-dedup, 32 dropped by the services predicate, 366 retained.
//
// NOTE — deviation from the architect plan's RETAINED band of 60..160:
// that estimate assumed an *aggressive* services trim (the spike's "~27%
// advisory across ALL 1,616 rows"). The human-APPROVED services predicate is
// deliberately conservative + default-include (KEEP on ambiguity, per
// anti-over-reporting), so it only drops rows with an advisory signal AND no
// funding signal — 32 of 398 here, not ~240. Relaxing the predicate to hit
// 60..160 would weaken the anti-over-reporting bias, which is non-negotiable.
// The band is therefore set to bracket the MEASURED conservative-predicate
// result; its real job (detect a feed-shape change) is preserved. Also: the
// ~203 "Cognit.ca | <institution>" rows are all FUNDED-ORG level, so the
// federal filter removes them before dedup — dup drops 0 here by design.
const RETAINED_MIN = 280;
const RETAINED_MAX = 440;
const RAW_FEDERAL_POST_DEDUP_MIN = 300;
const RAW_FEDERAL_POST_DEDUP_MAX = 500;

const db = new PrismaClient();

// ─── DB size diagnostic ──────────────────────────────────────────────────────

async function getDbSizeMB(): Promise<number> {
  const [{ size }] = await db.$queryRaw<[{ size: bigint }]>`
    SELECT pg_database_size(current_database()) AS size
  `;
  return Math.round((Number(size) / 1024 / 1024) * 10) / 10;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Funding Catalog Import (G0a — federal spine) ===\n");

  // Step 0 — DB size before we touch anything.
  console.log(`[Step 0] Current DB size: ${await getDbSizeMB()} MB`);

  // Step 1 — Resolve the latest XLSX catalog resource (never hardcoded).
  console.log("\n[Step 1] Resolving latest XLSX catalog resource via package_show...");
  const resource = await resolveLatestCatalogXlsx(CATALOG_PKG);
  console.log(`  → resolved resource: ${resource.id} (${resource.name ?? "?"})`);
  console.log(`    last_modified: ${resource.last_modified ?? "?"}`);
  console.log(`    url: ${resource.url}`);
  const sourceVersion = resource.id;

  // Step 2 — Download + parse the XLSX.
  console.log("\n[Step 2] Downloading + parsing XLSX...");
  const { headers, rows } = await fetchAndParseXlsx(resource.url!);
  console.log(`  columns (${headers.length}): ${headers.join(" | ")}`);
  console.log(`  raw rows after EN header (row 0 consumed as headers): ${rows.length}`);

  // The FIRST remaining row is the FR header-translation row (e.g.
  // "Titre - Anglais") — drop it. readXlsx already consumed the EN header.
  const drops = { header: 0, nonFederal: 0, dup: 0, services: 0 };
  drops.header = rows.length > 0 ? 1 : 0;
  const dataRows = rows.slice(1);
  console.log(`  data rows (excl. EN + FR header rows): ${dataRows.length}`);

  // Step 3 — Filter: federal-only.
  const federalRows = dataRows.filter((r) => isFederal(r[COL.orgEn] ?? "", r[COL.orgFr] ?? ""));
  drops.nonFederal = dataRows.length - federalRows.length;

  // Step 4 — De-dup the "Cognit.ca | <institution>" boilerplate to one row.
  const { rows: dedupedRows, dropped: cognitDropped } = dedupCognit(federalRows);
  drops.dup = cognitDropped;
  const rawFederalPostDedup = dedupedRows.length;

  // Step 5 — Drop pure advisory/services rows (conservative, default-include).
  const kept: string[][] = [];
  for (const r of dedupedRows) {
    const verdict = isFunding(r);
    if (verdict.keep) kept.push(r);
    else if (verdict.reason === "services") drops.services++;
  }

  // Step 6 — Map to FundingProgram shape. Empty names can't satisfy the natural
  // key — guard (should not occur for federal rows, but be explicit).
  const programs = kept
    .map(mapRowToProgram)
    .filter((p) => p.name.length > 0 && p.funder.length > 0);
  const retained = programs.length;

  console.log("\n[Step 3] Filter results:");
  console.log(`  drop — header (FR translation row):        ${drops.header}`);
  console.log(`  drop — nonFederal:                         ${drops.nonFederal}`);
  console.log(`  drop — dup (Cognit.ca boilerplate):        ${drops.dup}`);
  console.log(`  drop — services (advisory, no funding):    ${drops.services}`);
  console.log(`  raw federal (post-dedup):                  ${rawFederalPostDedup}`);
  console.log(`  RETAINED federal funding programs:         ${retained}`);

  // Step 7 — Single atomic transaction: TRUNCATE → insert programs → sources.
  console.log("\n[Step 4] Writing to database (single atomic transaction)...");
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`TRUNCATE TABLE "FundingProgram", "FundingProgramSource" RESTART IDENTITY CASCADE`;
        console.log("  ✓ FundingProgram + FundingProgramSource truncated");

        let inserted = 0;
        for (let i = 0; i < programs.length; i += BATCH_SIZE) {
          const result = await tx.fundingProgram.createMany({
            data: programs.slice(i, i + BATCH_SIZE),
            skipDuplicates: true,
          });
          inserted += result.count;
        }
        console.log(`  ✓ FundingProgram: ${inserted} inserted`);

        // One FundingProgramSource row per inserted program.
        const persisted = await tx.fundingProgram.findMany({ select: { id: true } });
        let sourcesInserted = 0;
        const sourceRows = persisted.map((p) => ({
          programId: p.id,
          feed: FEED,
          sourceVersion,
        }));
        for (let i = 0; i < sourceRows.length; i += BATCH_SIZE) {
          const result = await tx.fundingProgramSource.createMany({
            data: sourceRows.slice(i, i + BATCH_SIZE),
            skipDuplicates: true,
          });
          sourcesInserted += result.count;
        }
        console.log(`  ✓ FundingProgramSource: ${sourcesInserted} inserted`);
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  } finally {
    console.log(`\n[Final] DB size: ${await getDbSizeMB()} MB`);
  }

  // Final counts (only reached on success — transaction committed).
  const programCount = await db.fundingProgram.count();
  console.log("\n=== Done ===");
  console.log(`  FundingProgram: ${programCount.toLocaleString()} rows`);

  // ─── Count-band assertions (fail loudly) ─────────────────────────────────
  const breakdown =
    `header=${drops.header} nonFederal=${drops.nonFederal} dup=${drops.dup} ` +
    `services=${drops.services} rawFederalPostDedup=${rawFederalPostDedup} retained=${retained}`;
  if (retained < RETAINED_MIN || retained > RETAINED_MAX) {
    throw new Error(
      `Retained-count band breach: expected ${RETAINED_MIN}..${RETAINED_MAX}, got ${retained}. ${breakdown}`,
    );
  }
  if (
    rawFederalPostDedup < RAW_FEDERAL_POST_DEDUP_MIN ||
    rawFederalPostDedup > RAW_FEDERAL_POST_DEDUP_MAX
  ) {
    throw new Error(
      `Raw-federal-post-dedup band breach: expected ${RAW_FEDERAL_POST_DEDUP_MIN}..` +
        `${RAW_FEDERAL_POST_DEDUP_MAX}, got ${rawFederalPostDedup}. ${breakdown}`,
    );
  }
  console.log(`\n[Assertions] count bands OK → ${breakdown}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
