/**
 * scripts/import-ocl.ts
 *
 * Monthly OCL open-data import — fully idempotent.
 *
 * Every run:
 *   1. Logs current DB size (bytes / 1024 / 1024).
 *   2. Parses all CSVs into memory (no DB writes yet).
 *   3. Opens a single Prisma interactive transaction:
 *        TRUNCATE both OCL tables → insert all registrations → insert all comms.
 *      If anything fails, the transaction rolls back automatically — no partial
 *      data is ever committed.
 *   4. Logs final DB size in a try/finally (runs even on error, then re-throws).
 *
 * Usage:
 *   npm run ocl:import
 *
 * Downloads
 * ─────────
 * URLs are resolved at runtime via the open.canada.ca CKAN API using
 * stable dataset package IDs — no hardcoded filenames.  ZIPs are cached
 * in /data; delete them to force a fresh download.
 *
 * Memory note
 * ───────────
 * Lookup maps (subjects, institutions, DPOHs) are built in memory before
 * streaming the primary exports.  Peak usage is ~300-400 MB for the full
 * dataset.  Increase --max-old-space-size if Node.js OOMs on smaller hosts.
 */

import path from "node:path";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import Papa from "papaparse";
import iconv from "iconv-lite";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  buildRegistrationRecord,
  buildCommRecord,
  buildSubjectCodeLookup,
  decodeSubjectCode,
  parseOclNull,
  type RegistrationRow,
  type CommRow,
  type DpohRow,
  type SubjectCodeRow,
  type OclRegistrationRecord,
  type OclCommRecord,
} from "./ocl-utils.js";

// ─── Config ───────────────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const CKAN_API = "https://open.canada.ca/data/en/api/3/action/package_show";
const PACKAGE_IDS = {
  registrations: "70ef2117-1095-4d77-80eb-b87f2bada2a4",
  communications: "a34eb330-7136-4f5e-9f5f-3ba41df58b06",
} as const;
const BATCH_SIZE = 500;

// Only communications on or after this date are imported.
// Covers all compliance-relevant windows (6-month threshold clock, 5-year
// audit lookback) while keeping the dataset within Neon free-tier storage.
const COMMS_CUTOFF = new Date("2019-01-01");

const db = new PrismaClient();

// ─── DB size diagnostic ───────────────────────────────────────────────────

/**
 * Returns current database size in MB (rounded to 1 decimal place).
 * Used to bracket the import so WAL growth is visible in logs.
 */
async function getDbSizeMB(): Promise<number> {
  const [{ size }] = await db.$queryRaw<[{ size: bigint }]>`
    SELECT pg_database_size(current_database()) AS size
  `;
  return Math.round((Number(size) / 1024 / 1024) * 10) / 10;
}

// ─── CKAN URL discovery ───────────────────────────────────────────────────

async function getCsvUrl(packageId: string): Promise<string> {
  const res = await fetch(`${CKAN_API}?id=${packageId}`);
  if (!res.ok) throw new Error(`CKAN API returned ${res.status}`);
  const json = (await res.json()) as {
    result: { resources: Array<{ format: string; url: string; name: string }> };
  };
  const csv = json.result.resources.find((r) => r.format === "CSV");
  if (!csv) throw new Error(`No CSV resource in package ${packageId}`);
  console.log(`  → ${csv.name}`);
  console.log(`    ${csv.url}`);
  return csv.url;
}

// ─── Download ─────────────────────────────────────────────────────────────

async function downloadZip(url: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    const mb = (fs.statSync(dest).size / 1e6).toFixed(1);
    console.log(`  ↩ Using cached ${path.basename(dest)} (${mb} MB) — delete to re-fetch`);
    return;
  }
  console.log(`  ↓ Downloading ${path.basename(dest)}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const tmp = `${dest}.tmp`;
  const out = fs.createWriteStream(tmp);
  await pipeline(res.body as unknown as NodeJS.ReadableStream, out);
  fs.renameSync(tmp, dest);
  const mb = (fs.statSync(dest).size / 1e6).toFixed(1);
  console.log(`  ✓ Saved ${path.basename(dest)} (${mb} MB)`);
}

// ─── Streaming CSV from ZIP ───────────────────────────────────────────────

/**
 * Stream a named CSV entry from a ZIP file, transcoding Windows-1252 → UTF-8.
 * Calls onRow for each parsed data row (header row is excluded).
 */
async function streamCsvEntry<T>(
  zipPath: string,
  entryName: string,
  onRow: (row: T) => void,
): Promise<void> {
  const zip = await unzipper.Open.file(zipPath);
  const entry = zip.files.find((f) => f.path === entryName);
  if (!entry) throw new Error(`Entry "${entryName}" not found in ${zipPath}`);

  const decoded = entry.stream().pipe(iconv.decodeStream("windows-1252"));

  return new Promise((resolve, reject) => {
    Papa.parse(decoded as unknown as NodeJS.ReadableStream, {
      header: true,
      skipEmptyLines: true,
      step: ({ data }) => onRow(data as T),
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });
}

// ─── Lookup-map builders ──────────────────────────────────────────────────

async function loadSubjectCodes(zipPath: string): Promise<Map<string, string>> {
  const rows: SubjectCodeRow[] = [];
  await streamCsvEntry<SubjectCodeRow>(
    zipPath,
    "Codes_SubjectMatterTypesExport.csv",
    (r) => rows.push(r),
  );
  return buildSubjectCodeLookup(rows);
}

/** Map<REG_ID_ENR, string[]> — decoded English subject names per registration */
async function buildRegistrationSubjectsMap(
  zipPath: string,
  subjectCodes: Map<string, string>,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let count = 0;
  await streamCsvEntry<{ REG_ID_ENR: string; SUBJECT_CODE_OBJET: string }>(
    zipPath,
    "Registration_SubjectMattersExport.csv",
    (row) => {
      const id = parseOclNull(row.REG_ID_ENR);
      const code = parseOclNull(row.SUBJECT_CODE_OBJET);
      if (!id || !code) return;
      const decoded = decodeSubjectCode(code, subjectCodes);
      const arr = map.get(id) ?? [];
      if (!arr.includes(decoded)) arr.push(decoded);
      map.set(id, arr);
      if (++count % 200_000 === 0) process.stdout.write(`  subjects: ${count.toLocaleString()} rows…\r`);
    },
  );
  console.log(`  subjects map built: ${map.size.toLocaleString()} registrations`);
  return map;
}

/** Map<REG_ID_ENR, string[]> — institution names per registration */
async function buildRegistrationInstitutionsMap(
  zipPath: string,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let count = 0;
  await streamCsvEntry<{ REG_ID_ENR: string; INSTITUTION: string }>(
    zipPath,
    "Registration_GovernmentInstExport.csv",
    (row) => {
      const id = parseOclNull(row.REG_ID_ENR);
      const inst = parseOclNull(row.INSTITUTION);
      if (!id || !inst) return;
      const arr = map.get(id) ?? [];
      if (!arr.includes(inst)) arr.push(inst);
      map.set(id, arr);
      if (++count % 400_000 === 0) process.stdout.write(`  institutions: ${count.toLocaleString()} rows…\r`);
    },
  );
  console.log(`  institutions map built: ${map.size.toLocaleString()} registrations`);
  return map;
}

type DpohSummary = { institution: string; dpohName: string; dpohTitle: string | null };

/** Map<COMLOG_ID, DpohSummary> — first DPOH per communication log */
async function buildDpohMap(zipPath: string): Promise<Map<string, DpohSummary>> {
  const map = new Map<string, DpohSummary>();
  let count = 0;
  await streamCsvEntry<DpohRow>(
    zipPath,
    "Communication_DpohExport.csv",
    (row) => {
      const id = parseOclNull(row["COMLOG_ID"]);
      if (!id || map.has(id)) return; // keep only the first DPOH per comm
      const last = parseOclNull(row["DPOH_LAST_NM_TCPD"]);
      const first = parseOclNull(row["DPOH_FIRST_NM_PRENOM_TCPD"]);
      const dpohName = [first, last].filter(Boolean).join(" ") || "Unknown";
      map.set(id, {
        institution: parseOclNull(row["INSTITUTION"]) ?? "Unknown",
        dpohName,
        dpohTitle: parseOclNull(row["DPOH_TITLE_TITRE_TCPD"]),
      });
      if (++count % 100_000 === 0) process.stdout.write(`  dpoh: ${count.toLocaleString()} rows…\r`);
    },
  );
  console.log(`  dpoh map built: ${map.size.toLocaleString()} comm logs`);
  return map;
}

/** Map<COMLOG_ID, string[]> — decoded English subject names per comm log */
async function buildCommSubjectsMap(
  zipPath: string,
  subjectCodes: Map<string, string>,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let count = 0;
  await streamCsvEntry<{ COMLOG_ID: string; SUBJECT_CODE_OBJET: string }>(
    zipPath,
    "Communication_SubjectMattersExport.csv",
    (row) => {
      const id = parseOclNull(row.COMLOG_ID);
      const code = parseOclNull(row.SUBJECT_CODE_OBJET);
      if (!id || !code) return;
      const decoded = decodeSubjectCode(code, subjectCodes);
      const arr = map.get(id) ?? [];
      if (!arr.includes(decoded)) arr.push(decoded);
      map.set(id, arr);
      if (++count % 100_000 === 0) process.stdout.write(`  comm subjects: ${count.toLocaleString()} rows…\r`);
    },
  );
  console.log(`  comm subjects map built: ${map.size.toLocaleString()} comm logs`);
  return map;
}

// ─── rawPayload ───────────────────────────────────────────────────────────
//
// We store an empty object rather than any CSV fields.  The Neon free tier
// is 512 MB and includes WAL history — even slim payloads push us over when
// the full dataset (169 K registrations + 363 K comms) is considered.
// The complete source data is preserved in /data/*.zip (gitignored,
// re-downloadable from open.canada.ca at any time).
//
// If rawPayload ever needs to carry audit fields, upgrade the Neon project
// to a paid plan (10 GB) before expanding it.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function emptyPayload(_row: RegistrationRow | CommRow): Prisma.InputJsonValue {
  return {};
}

// ─── CSV → in-memory record collectors (no DB I/O) ───────────────────────

async function collectRegistrationRecords(zipPath: string): Promise<OclRegistrationRecord[]> {
  console.log("[Registrations] Building lookup maps...");
  const subjectCodes = await loadSubjectCodes(zipPath);
  const subjectsMap = await buildRegistrationSubjectsMap(zipPath, subjectCodes);
  const institutionsMap = await buildRegistrationInstitutionsMap(zipPath);

  console.log("\n[Registrations] Collecting primary export...");
  const records: OclRegistrationRecord[] = [];

  await streamCsvEntry<RegistrationRow>(zipPath, "Registration_PrimaryExport.csv", (row) => {
    const record = buildRegistrationRecord(
      row,
      subjectsMap.get(row["REG_ID_ENR"] ?? "") ?? [],
      institutionsMap.get(row["REG_ID_ENR"] ?? "") ?? [],
    );
    if (record) records.push({ ...record, rawPayload: emptyPayload(row) });
  });

  console.log(`  collected ${records.length.toLocaleString()} registration records`);
  return records;
}

async function collectCommunicationRecords(zipPath: string): Promise<OclCommRecord[]> {
  console.log(`\n[Communications] Building lookup maps (cutoff: ${COMMS_CUTOFF.toISOString().slice(0, 10)})...`);
  const subjectCodes = await loadSubjectCodes(zipPath);
  const dpohMap = await buildDpohMap(zipPath);
  const subjectsMap = await buildCommSubjectsMap(zipPath, subjectCodes);

  console.log("\n[Communications] Collecting primary export...");
  const records: OclCommRecord[] = [];
  let skipped = 0;

  await streamCsvEntry<CommRow>(zipPath, "Communication_PrimaryExport.csv", (row) => {
    const comlogId = parseOclNull(row["COMLOG_ID"]) ?? "";
    const dpoh = dpohMap.get(comlogId);

    const record = buildCommRecord(
      row,
      dpoh?.institution ?? "Unknown",
      dpoh?.dpohName ?? "Unknown",
      dpoh?.dpohTitle ?? null,
      subjectsMap.get(comlogId) ?? [],
    );
    if (!record) return;

    // Skip pre-cutoff communications to stay within Neon free-tier storage.
    if (record.communicationDate < COMMS_CUTOFF) {
      skipped++;
      return;
    }

    records.push({ ...record, rawPayload: emptyPayload(row) });
  });

  console.log(
    `  collected ${records.length.toLocaleString()} comm records` +
      ` (${skipped.toLocaleString()} pre-${COMMS_CUTOFF.getFullYear()} skipped)`,
  );
  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== OCL Open-Data Import ===\n");
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Step 0 — DB size before we touch anything.
  // If this is already > 400 MB on a fresh run, reset the Neon branch via
  // the console (Branches → main → Reset) to purge accumulated WAL history.
  console.log(`[Step 0] Current DB size: ${await getDbSizeMB()} MB`);

  // Step 1 — Resolve download URLs via CKAN API.
  console.log("\n[Step 1] Resolving download URLs from open.canada.ca...");
  const regUrl = await getCsvUrl(PACKAGE_IDS.registrations);
  const commUrl = await getCsvUrl(PACKAGE_IDS.communications);

  // Step 2 — Download ZIPs (skips if cached).
  console.log("\n[Step 2] Downloading ZIPs...");
  const regZip = path.join(DATA_DIR, "registrations.zip");
  const commZip = path.join(DATA_DIR, "communications.zip");
  await downloadZip(regUrl, regZip);
  await downloadZip(commUrl, commZip);

  // Step 3 — Parse CSVs into memory (zero DB I/O in this phase).
  console.log("\n[Step 3] Parsing CSVs into memory...");
  const regRecords = await collectRegistrationRecords(regZip);
  const commRecords = await collectCommunicationRecords(commZip);

  // Step 4 — Single atomic transaction: TRUNCATE → insert everything.
  //
  // Wrapping in one transaction makes repeated runs safe:
  //   • If the process dies mid-insert, no partial data is committed.
  //   • TRUNCATE before inserts means the tables always end in a known state.
  //
  // timeout: 300_000 ms (5 min) — generous for ~270 K rows at 500/batch.
  // maxWait: 10_000 ms — how long to wait to acquire a connection from the pool.
  console.log("\n[Step 4] Writing to database (single atomic transaction)...");

  try {
    await db.$transaction(
      async (tx) => {
        // Table names are PascalCase — no @@map in schema.prisma.
        await tx.$executeRaw`TRUNCATE TABLE "OclPublicCommReport", "OclPublicRegistration"`;
        console.log("  ✓ Tables truncated");

        // Insert registrations in sequential batches.
        let regInserted = 0;
        for (let i = 0; i < regRecords.length; i += BATCH_SIZE) {
          const result = await tx.oclPublicRegistration.createMany({
            data: regRecords.slice(i, i + BATCH_SIZE),
            skipDuplicates: true,
          });
          regInserted += result.count;
          if (i % 10_000 === 0 && i > 0) {
            process.stdout.write(
              `  registrations: ${i.toLocaleString()} / ${regRecords.length.toLocaleString()}…\r`,
            );
          }
        }
        console.log(`  ✓ Registrations: ${regInserted.toLocaleString()} inserted`);

        // Insert communications in sequential batches.
        let commInserted = 0;
        for (let i = 0; i < commRecords.length; i += BATCH_SIZE) {
          const result = await tx.oclPublicCommReport.createMany({
            data: commRecords.slice(i, i + BATCH_SIZE),
            skipDuplicates: true,
          });
          commInserted += result.count;
          if (i % 10_000 === 0 && i > 0) {
            process.stdout.write(
              `  comms: ${i.toLocaleString()} / ${commRecords.length.toLocaleString()}…\r`,
            );
          }
        }
        console.log(`  ✓ Communications: ${commInserted.toLocaleString()} inserted`);
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  } finally {
    // Runs on both success and failure so we always see the storage delta.
    console.log(`\n[Final] DB size: ${await getDbSizeMB()} MB`);
  }

  // Final row counts (only reached on success — transaction committed).
  const [regCount, commCount] = await Promise.all([
    db.oclPublicRegistration.count(),
    db.oclPublicCommReport.count(),
  ]);
  console.log("\n=== Done ===");
  console.log(`  OclPublicRegistration: ${regCount.toLocaleString()} rows`);
  console.log(`  OclPublicCommReport:   ${commCount.toLocaleString()} rows`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
