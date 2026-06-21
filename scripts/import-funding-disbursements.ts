/**
 * scripts/import-funding-disbursements.ts
 *
 * Funding Navigator (Product 03) — G0b windowed disbursement import.
 * Fully idempotent (mirrors scripts/import-funding-catalog.ts + import-ocl.ts).
 *
 * Source: Proactive Disclosure — Grants & Contributions, package
 *   432527ab-7aac-45b5-81d6-7597107a7013 on open.canada.ca (CKAN).
 * The real data is resource 1d15a62f… (CSV, DataStore-active, ~2.26 GB).
 * We select THIS resource BY IDENTITY — NOT the first datastore_active resource,
 * which is the 4e4db232… "Nothing to Report" nil file (spike-learned trap).
 *
 * Window strategy (spike-corrected, human-approved):
 *   Source-side range filtering is impossible (q→409, datastore_search_sql→400,
 *   filters=equality-only), but `sort=agreement_start_date desc` works and dates
 *   are ISO "YYYY-MM-DD" text. So we page newest-first and STOP once a page's
 *   last (oldest-in-page) row falls below cutoff = today − 2 years. Future-dated
 *   rows (real future agreement starts) are KEPT. Junk sentinel dates (e.g.
 *   1899-12-30) sort to the bottom → excluded for free; any in-window row whose
 *   date doesn't parse to a real date >= cutoff is also dropped.
 *
 * Fuzzy join (after insert, in-transaction, set-based SQL):
 *   programId ← FundingProgram where similarity(program-name) >= 0.45 (primary)
 *   AND a LOOSE funder gate similarity(funder, split_part(funder,'|',1)) >= 0.3.
 *   Orphan-tolerant: programId stays null on no match. Deterministic tie-break
 *   (similarity desc, id asc) for idempotency. matched-% is a METRIC, never a gate.
 *
 * SAFETY: this script TRUNCATEs ONLY "FundingDisbursement". OCL tables,
 * FundingProgram/Source, and TenantEntitlement are never touched.
 *
 * Usage:  npm run funding:import:disbursements
 */

import path from "node:path";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { datastoreSearchAll } from "../src/server/funding/program-registry/ckan-client.js";
import {
  cutoffFromNow,
  inWindow,
  mapRecordToDisbursement,
  toIsoDate,
  type DisbursementRecord,
  type MappedDisbursement,
} from "../src/server/funding/program-registry/disbursement-parse.js";

// ─── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const DISBURSE_PKG = "432527ab-7aac-45b5-81d6-7597107a7013"; // Grants & Contributions
const DISBURSE_RESOURCE = "1d15a62f-5656-49ad-8c88-f40ce689d831"; // real CSV (NOT 4e4db232 nil)
const FEED = "ckan:proactive-disclosure-grants-contributions";
const WINDOW_YEARS = 2;
const PAGE_SIZE = 10_000;
const BATCH_SIZE = 1_000;
const CACHE_FILE = path.join(DATA_DIR, "disbursements-window.json");

const FIELDS = [
  "prog_name_en",
  "owner_org_title",
  "agreement_value",
  "agreement_start_date",
  "recipient_legal_name",
  "recipient_province",
  "prog_purpose_en",
] as const;

// Wide count-band tripwire (feed-shape change detection — fail loudly outside).
// Window trimmed to 2 years to keep re-imports clear of Neon's 512 MB hard cap
// (the 3-year window's ~189 MB table doubled transiently during TRUNCATE+reinsert
// and breached the ceiling). ~180k retained expected at 2y; lumpy. Band is wide
// on purpose: its job is to catch a feed-shape break, not to police the exact count.
// Deeper history, if needed for win-probability, comes as pre-computed aggregates
// (per spec), not raw rows.
const RETAINED_MIN = 120_000;
const RETAINED_MAX = 260_000;

const db = new PrismaClient();

// ─── DB size diagnostic ──────────────────────────────────────────────────────

async function getDbSizeMB(): Promise<number> {
  const [{ size }] = await db.$queryRaw<[{ size: bigint }]>`
    SELECT pg_database_size(current_database()) AS size
  `;
  return Math.round((Number(size) / 1024 / 1024) * 10) / 10;
}

// ─── Fetch the in-window slice (sorted-desc, stop-at-cutoff) ─────────────────

async function fetchWindowedRecords(cutoffIso: string): Promise<DisbursementRecord[]> {
  // Dev cache (like import-ocl.ts): skip the multi-page pull if present.
  if (fs.existsSync(CACHE_FILE)) {
    const mb = (fs.statSync(CACHE_FILE).size / 1e6).toFixed(1);
    console.log(`  ↩ Using cached ${path.basename(CACHE_FILE)} (${mb} MB) — delete to re-fetch`);
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as DisbursementRecord[];
  }

  console.log(`  ↓ Paging newest-first (sort=agreement_start_date desc), cutoff=${cutoffIso}...`);
  const records = (await datastoreSearchAll(DISBURSE_RESOURCE, {
    sort: "agreement_start_date desc",
    fields: [...FIELDS],
    pageSize: PAGE_SIZE,
    // STOP once the oldest row in a page is below cutoff. ISO YYYY-MM-DD dates
    // sort lexically, so the page's last record carries the smallest date; once
    // it precedes the cutoff string, no later page can be in-window.
    stopWhen: (last) => {
      const d = String(last.agreement_start_date ?? "");
      return d < cutoffIso;
    },
    onPage: (recs, offset, total) => {
      const last = recs[recs.length - 1]?.agreement_start_date ?? "?";
      process.stdout.write(
        `  fetched ${(offset + recs.length).toLocaleString()} / ${total.toLocaleString()} (last date ${last})…\r`,
      );
    },
  })) as DisbursementRecord[];
  process.stdout.write("\n");

  // Cache for idempotent dev re-runs (gitignored /data, re-fetchable).
  fs.writeFileSync(CACHE_FILE, JSON.stringify(records));
  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== Funding Disbursement Import (G0b — windowed moat) ===\n");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 0 — DB size before we touch anything.
  console.log(`[Step 0] Current DB size: ${await getDbSizeMB()} MB`);

  // Step 1 — Re-resolve the resource BY IDENTITY (never find(datastore_active)).
  const cutoff = cutoffFromNow(WINDOW_YEARS);
  const cutoffIso = toIsoDate(cutoff);
  console.log("\n[Step 1] Target resource (pinned by identity):");
  console.log(`  → package:  ${DISBURSE_PKG}`);
  console.log(`  → resource: ${DISBURSE_RESOURCE} (Proactive Disclosure - Grants & Contributions CSV)`);
  console.log(`  → window: agreement_start_date >= ${cutoffIso} (today − ${WINDOW_YEARS}y; future-dated rows kept)`);
  const sourceVersion = DISBURSE_RESOURCE;

  // Step 2 — Fetch the in-window slice (sorted-desc, stop-at-cutoff).
  console.log("\n[Step 2] Fetching windowed records...");
  const rawRecords = await fetchWindowedRecords(cutoffIso);
  console.log(`  fetched (sorted-desc, stop-at-cutoff): ${rawRecords.length.toLocaleString()} records`);

  // Step 3 — Map + filter, accumulating a tally.
  console.log("\n[Step 3] Mapping + filtering...");
  const tally = { fetched: rawRecords.length, outOfWindow: 0, droppedMissingRequired: 0, retained: 0 };
  const mapped: MappedDisbursement[] = [];
  for (const rec of rawRecords) {
    // Stop-at-cutoff overshoots within the boundary page — re-check the window
    // per row (also drops junk/unparseable + pre-cutoff dates for free).
    if (!inWindow(rec.agreement_start_date, cutoff)) {
      tally.outOfWindow++;
      continue;
    }
    const row = mapRecordToDisbursement(rec);
    if (row === null) {
      tally.droppedMissingRequired++;
      continue;
    }
    mapped.push(row);
  }
  tally.retained = mapped.length;

  console.log(`  fetched:                    ${tally.fetched.toLocaleString()}`);
  console.log(`  drop — out-of-window:       ${tally.outOfWindow.toLocaleString()}`);
  console.log(`  drop — missing required:    ${tally.droppedMissingRequired.toLocaleString()}`);
  console.log(`  RETAINED disbursements:     ${tally.retained.toLocaleString()}`);

  // Step 4 — Single atomic transaction: TRUNCATE → insert → fuzzy join.
  console.log("\n[Step 4] Writing to database (single atomic transaction)...");
  let matchedCount = 0;
  let totalCount = 0;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`TRUNCATE TABLE "FundingDisbursement" RESTART IDENTITY CASCADE`;
        console.log("  ✓ FundingDisbursement truncated");

        let inserted = 0;
        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
          const result = await tx.fundingDisbursement.createMany({
            data: mapped.slice(i, i + BATCH_SIZE),
          });
          inserted += result.count;
          if (i % 50_000 === 0 && i > 0) {
            process.stdout.write(
              `  inserting: ${i.toLocaleString()} / ${mapped.length.toLocaleString()}…\r`,
            );
          }
        }
        process.stdout.write("\n");
        console.log(`  ✓ FundingDisbursement: ${inserted.toLocaleString()} inserted`);

        // Set-based fuzzy join to FundingProgram. Primary gate is program-name
        // similarity >= 0.45; loose funder gate (>= 0.3) on the EN side of the
        // "EN | FR" funder string via split_part. Orphan-tolerant (programId
        // stays null on no match). Deterministic tie-break (similarity desc,
        // id asc) for idempotency.
        //
        // Two corrections to the spec's literal SQL, both semantics-preserving:
        //   (1) Postgres forbids a LATERAL in UPDATE...FROM from referencing the
        //       update target (error 42P10), so this uses the equivalent
        //       correlated scalar subquery in SET, gated by WHERE EXISTS so only
        //       rows with a candidate are touched (rest stay null — orphan-
        //       tolerant). Same best-match-per-row result, valid syntax.
        //   (2) The name gate uses the `%` operator with set_limit(0.45) instead
        //       of `similarity(name, raw) >= 0.45`. These are EQUIVALENT (the `%`
        //       operator is true iff similarity >= pg_trgm.similarity_threshold),
        //       but `%` engages the trgm GIN index on FundingProgram(name) — a
        //       bitmap index probe per row instead of a 366-row seq scan, so the
        //       join fits inside the 300s transaction budget. The funder gate and
        //       the ORDER BY still use similarity() directly (no index needed —
        //       evaluated only over the few name-matched candidates).
        console.log("  ⋯ Fuzzy-joining to FundingProgram (similarity >= 0.45 name, >= 0.3 funder)...");
        await tx.$executeRaw`SELECT set_limit(0.45)`; // pg_trgm threshold for `%`
        const joined = await tx.$executeRaw`
          UPDATE "FundingDisbursement" d
          SET "programId" = (
            SELECT p.id
            FROM "FundingProgram" p
            WHERE p."governmentLevel" = 'federal'
              AND p.name % d."programNameRaw"
              AND similarity(p.funder, split_part(d.funder, '|', 1)) >= 0.3
            ORDER BY similarity(p.name, d."programNameRaw") DESC, p.id ASC
            LIMIT 1
          )
          WHERE EXISTS (
            SELECT 1
            FROM "FundingProgram" p
            WHERE p."governmentLevel" = 'federal'
              AND p.name % d."programNameRaw"
              AND similarity(p.funder, split_part(d.funder, '|', 1)) >= 0.3
          )
        `;
        console.log(`  ✓ Fuzzy join: ${joined.toLocaleString()} disbursements matched to a program`);

        // Compute matched-% metric inside the txn (consistent snapshot).
        const [{ matched, total }] = await tx.$queryRaw<[{ matched: bigint; total: bigint }]>`
          SELECT
            COUNT(*) FILTER (WHERE "programId" IS NOT NULL) AS matched,
            COUNT(*) AS total
          FROM "FundingDisbursement"
        `;
        matchedCount = Number(matched);
        totalCount = Number(total);
      },
      // House pattern is { timeout: 300_000 }, sized for OCL's insert-only run.
      // This import does the same ~259k-row insert PLUS an in-transaction fuzzy
      // join, so the budget is raised to 600s. The join itself is fast (trgm GIN
      // index probe per row); the headroom covers the insert + join together
      // over the pooled Neon connection. Still one atomic txn (TRUNCATE+insert+
      // join) so re-runs are idempotent.
      { timeout: 600_000, maxWait: 10_000 },
    );
  } finally {
    console.log(`\n[Final] DB size: ${await getDbSizeMB()} MB`);
  }

  // Step 5 — Report (only reached on success — transaction committed).
  const pct = totalCount > 0 ? Math.round((matchedCount / totalCount) * 1000) / 10 : 0;
  console.log("\n=== Done ===");
  console.log(`  FundingDisbursement: ${totalCount.toLocaleString()} rows`);
  console.log(`  feed: ${FEED}  sourceVersion: ${sourceVersion}`);
  console.log(
    `  [METRIC] matched-%: ${pct}% (${matchedCount.toLocaleString()} / ${totalCount.toLocaleString()}) — ` +
      `informational, NOT a pass/fail gate (orphan-tolerant corpus)`,
  );

  // ─── Wide count-band assertion (feed-shape tripwire) ─────────────────────
  const tallyStr =
    `fetched=${tally.fetched} outOfWindow=${tally.outOfWindow} ` +
    `droppedMissingRequired=${tally.droppedMissingRequired} retained=${tally.retained}`;
  if (totalCount < RETAINED_MIN || totalCount > RETAINED_MAX) {
    throw new Error(
      `Retained-count band breach: expected ${RETAINED_MIN.toLocaleString()}..` +
        `${RETAINED_MAX.toLocaleString()}, got ${totalCount.toLocaleString()}. ${tallyStr}`,
    );
  }
  console.log(`\n[Assertions] count band OK → ${tallyStr}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
