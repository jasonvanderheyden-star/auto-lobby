/**
 * THROWAWAY DATA SPIKE — Funding Navigator (Product 03), Phase G0 de-risk.
 *
 * Validates the two load-bearing assumptions in docs/Funding-G0-Data-Foundation-Spec.md
 * BEFORE any schema/migration work:
 *   1. Is the federal funding data actually usable? (catalog + disbursement shape, counts)
 *   2. Does the disbursement set join to programs, or is it a name-matching swamp?
 *
 * No Prisma, no DB writes, no dependencies beyond Node 18+ global fetch.
 * Run:  npx tsx scripts/spike-funding-data.ts
 * Delete once findings are recorded. This is not production code.
 */

const CKAN = "https://open.canada.ca/data/api/3/action";

// Datasets (resolve resources at runtime — IDs above are the dataset/package IDs).
const CATALOG_PKG = "4e75337e-70d0-4ed7-92d1-3b85192ec6b1"; // Business Benefits Finder
const DISBURSE_PKG = "432527ab-7aac-45b5-81d6-7597107a7013"; // Grants & Contributions

type CkanResource = {
  id: string;
  name?: string;
  format?: string;
  datastore_active?: boolean;
  url?: string;
  last_modified?: string;
};

async function ckan<T>(action: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CKAN}/${action}?${qs}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${action} → HTTP ${res.status}`);
  const body = (await res.json()) as { success: boolean; result: T };
  if (!body.success) throw new Error(`${action} → CKAN success=false`);
  return body.result;
}

async function listResources(pkgId: string): Promise<CkanResource[]> {
  const pkg = await ckan<{ resources: CkanResource[] }>("package_show", { id: pkgId });
  return pkg.resources ?? [];
}

/** Pull a sample of rows from a DataStore-active resource. */
async function sampleDatastore(resourceId: string, limit = 200) {
  return ckan<{ fields: { id: string; type: string }[]; records: Record<string, unknown>[]; total: number }>(
    "datastore_search",
    { resource_id: resourceId, limit: String(limit) },
  );
}

function header(t: string) {
  console.log(`\n${"=".repeat(72)}\n${t}\n${"=".repeat(72)}`);
}

async function inspectCatalog() {
  header("1. PROGRAM CATALOG — Business Benefits Finder");
  const resources = await listResources(CATALOG_PKG);
  console.log(`Resources on package: ${resources.length}`);
  for (const r of resources) {
    console.log(`  - [${r.format ?? "?"}] ${r.name ?? r.id} (datastore=${!!r.datastore_active})`);
  }
  const ds = resources.find((r) => r.datastore_active);
  if (!ds) {
    console.log("⚠️  No DataStore-active resource — must download + parse the file resource instead.");
    return;
  }
  const sample = await sampleDatastore(ds.id);
  console.log(`\nTotal rows in '${ds.name}': ${sample.total}`);
  console.log("Fields:");
  for (const f of sample.fields) console.log(`  - ${f.id} (${f.type})`);

  // Which fields look like structured eligibility vs. narrative?
  console.log("\nFirst record (truncated):");
  const first = sample.records[0] ?? {};
  for (const [k, v] of Object.entries(first)) {
    const s = String(v ?? "");
    console.log(`  ${k}: ${s.length > 120 ? s.slice(0, 120) + "…" : s}`);
  }

  // KEY QUESTION: how many programs, and how much eligibility text is free-form?
  const textyFields = sample.fields.filter((f) => f.type === "text");
  const longValues = sample.records.filter((rec) =>
    textyFields.some((f) => String(rec[f.id] ?? "").length > 300),
  ).length;
  console.log(
    `\nReadout → ${sample.total} programs. ${longValues}/${sample.records.length} sampled rows ` +
      `have a >300-char text field (likely narrative eligibility). ` +
      `If that ratio is high, the G0c rule-extraction model needs the LLM-parse path, not just typed filters.`,
  );
}

async function inspectDisbursements() {
  header("2. DISBURSEMENT HISTORY — Grants & Contributions");
  const resources = await listResources(DISBURSE_PKG);
  console.log(`Resources on package: ${resources.length}`);
  const ds = resources.find((r) => r.datastore_active);
  if (!ds) {
    console.log(
      "⚠️  No DataStore-active resource. This set is often per-institution CSV files — " +
        "size the full download before deciding the import window (Neon 0.5 GB budget).",
    );
    resources.slice(0, 10).forEach((r) => console.log(`  - [${r.format}] ${r.name}`));
    return;
  }
  const sample = await sampleDatastore(ds.id);
  console.log(`Total disbursement rows in '${ds.name}': ${sample.total}`);
  console.log("Fields:");
  for (const f of sample.fields) console.log(`  - ${f.id} (${f.type})`);

  // KEY QUESTION: is there a clean program/program-name + amount + date to join on?
  const fieldIds = sample.fields.map((f) => f.id.toLowerCase());
  const has = (substr: string) => fieldIds.some((id) => id.includes(substr));
  console.log(
    `\nJoin-readiness → program-name field: ${has("prog")}, amount: ${has("value") || has("amount")}, ` +
      `date: ${has("date")}, recipient: ${has("recipient")}.`,
  );
  console.log(
    "If program names are free strings (no program ID), the catalog join needs pg_trgm fuzzy matching " +
      "(reuse the lookup-official.ts approach). Measure matched-% during G0b.",
  );
}

async function main() {
  console.log("Funding Navigator data spike —", new Date().toISOString());
  try {
    await inspectCatalog();
  } catch (e) {
    console.error("Catalog inspection failed:", (e as Error).message);
  }
  try {
    await inspectDisbursements();
  } catch (e) {
    console.error("Disbursement inspection failed:", (e as Error).message);
  }
  header("DECISION GATES");
  console.log(
    [
      "• Catalog usable + program count plausible?           → green-light G0a",
      "• Eligibility mostly typed-able (hand-check 30)?      → G0c rule schema as specced; else redesign dimensions",
      "• Disbursement joins to catalog at acceptable %?      → green-light G0b moat; else scope a manual program-name crosswalk",
      "• Full disbursement download fits the window budget?  → set G0b window (default: 6 fiscal years)",
    ].join("\n"),
  );
}

void main();
