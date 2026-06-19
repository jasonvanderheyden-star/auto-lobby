/**
 * Funding Navigator (Product 03) — G0 data-feed SMOKE TEST.
 *
 * Originally a throwaway spike; RETAINED + CORRECTED after the 2026-06-19 spike
 * (see docs/Funding-G0-Data-Foundation-Spec.md → "Spike Findings"). It now
 * verifies the two G0 feeds are reachable and have the expected shape:
 *   1. Catalog (Business Benefits Finder) — XLSX, NOT in DataStore: download + parse.
 *   2. Disbursements (Grants & Contributions) — the REAL CSV DataStore resource,
 *      NOT the "Nothing to Report" nil file that find(datastore_active) grabs.
 *
 * Read-only: no Prisma, no DB writes. Run:  npx tsx scripts/spike-funding-data.ts
 * Uses unzipper + fast-xml-parser (already deps) to parse the catalog XLSX.
 */

import unzipper from "unzipper";
import { XMLParser } from "fast-xml-parser";

const CKAN = "https://open.canada.ca/data/api/3/action";

// Package IDs are STABLE. Resource IDs change on re-publish — resolve at runtime,
// but pin the known-good targets so the smoke test selects correctly.
const CATALOG_PKG = "4e75337e-70d0-4ed7-92d1-3b85192ec6b1"; // Business Benefits Finder
const DISBURSE_PKG = "432527ab-7aac-45b5-81d6-7597107a7013"; // Grants & Contributions
const DISBURSE_RESOURCE = "1d15a62f-5656-49ad-8c88-f40ce689d831"; // real CSV (NOT 4e4db232 "Nothing to Report")

type CkanResource = {
  id: string;
  name?: string;
  format?: string;
  datastore_active?: boolean;
  url?: string;
  size?: number | null;
  last_modified?: string;
};

async function ckan<T>(action: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${CKAN}/${action}?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${action} → HTTP ${res.status}`);
  const body = (await res.json()) as { success: boolean; result: T };
  if (!body.success) throw new Error(`${action} → CKAN success=false`);
  return body.result;
}

async function listResources(pkgId: string): Promise<CkanResource[]> {
  const pkg = await ckan<{ resources: CkanResource[] }>("package_show", { id: pkgId });
  return pkg.resources ?? [];
}

async function sampleDatastore(resourceId: string, limit = 5, offset = 0) {
  return ckan<{
    fields: { id: string; type: string }[];
    records: Record<string, unknown>[];
    total: number;
  }>("datastore_search", { resource_id: resourceId, limit: String(limit), offset: String(offset) });
}

function header(t: string) {
  console.log(`\n${"=".repeat(72)}\n${t}\n${"=".repeat(72)}`);
}

// ---- minimal XLSX (SpreadsheetML) reader: unzip + parse the two XML parts ----

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
type XmlNode = string | number | { "#text"?: string | number; [k: string]: unknown };
const asArray = <T>(x: T | T[] | undefined): T[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
function nodeText(n: XmlNode | undefined): string {
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (n["#text"] != null) return String(n["#text"]);
  return "";
}
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? ["A"])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readXlsx(url: string): Promise<{ headers: string[]; rows: string[][] }> {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const dir = await unzipper.Open.buffer(buf);
  const read = async (path: string) => {
    const entry = dir.files.find((f) => f.path === path);
    if (!entry) throw new Error(`missing ${path} in workbook`);
    return (await entry.buffer()).toString("utf8");
  };

  // shared strings
  const ss = xml.parse(await read("xl/sharedStrings.xml")) as { sst?: { si?: XmlNode | XmlNode[] } };
  const shared = asArray(ss.sst?.si).map((si) => {
    const node = si as { t?: XmlNode; r?: XmlNode | XmlNode[] };
    if (node.t != null) return nodeText(node.t);
    return asArray(node.r).map((r) => nodeText((r as { t?: XmlNode }).t)).join("");
  });

  // sheet
  const sheet = xml.parse(await read("xl/worksheets/sheet1.xml")) as {
    worksheet?: { sheetData?: { row?: unknown } };
  };
  const rowNodes = asArray(sheet.worksheet?.sheetData?.row) as { c?: unknown }[];
  const rows: string[][] = rowNodes.map((row) => {
    const cells = asArray(row.c) as { "@_r"?: string; "@_t"?: string; v?: XmlNode; is?: { t?: XmlNode } }[];
    const out: string[] = [];
    for (const c of cells) {
      const idx = colIndex(c["@_r"] ?? "A1");
      let val = "";
      if (c.v != null) val = c["@_t"] === "s" ? (shared[Number(nodeText(c.v))] ?? "") : nodeText(c.v);
      else if (c.is?.t != null) val = nodeText(c.is.t);
      out[idx] = val;
    }
    return out;
  });
  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}

async function inspectCatalog() {
  header("1. PROGRAM CATALOG — Business Benefits Finder (XLSX, not DataStore)");
  const resources = await listResources(CATALOG_PKG);
  // resolve the latest XLSX resource (not hard-coded — pinned id is the fallback)
  const xlsxResources = resources.filter((r) => (r.format ?? "").toUpperCase() === "XLSX" && r.url);
  const latest =
    xlsxResources.find((r) => r.id === "d07f854d-1cac-4f18-b4f4-5b3c4c7ffa21") ??
    xlsxResources.sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""))[0];
  if (!latest?.url) {
    console.log("⚠️  No XLSX resource resolved on the catalog package.");
    return;
  }
  console.log(`Resolved catalog resource: ${latest.id} (${latest.name})`);
  const { headers, rows } = await readXlsx(latest.url);
  // row 0 of data is the FR header translation — real programs start at index 1
  const data = rows.slice(1);
  const orgCol = headers.findIndex((h) => /Organization - English/i.test(h));
  const federal = data.filter((r) => (r[orgCol] ?? "").startsWith("Government of Canada")).length;
  const cognit = data.filter((r) => /Cognit\.ca/.test(r[orgCol] ?? "")).length;
  console.log(`\nColumns (${headers.length}): ${headers.join(" | ")}`);
  console.log(`Program rows (excl. EN+FR headers): ${data.length}`);
  console.log(
    `Federal ("Government of Canada…"): ${federal} (${Math.round((100 * federal) / data.length)}%)  ` +
      `| non-federal/all-levels: ${data.length - federal}`,
  );
  console.log(`Near-duplicate "Cognit.ca | <institution>" rows: ${cognit}`);
  console.log(
    `\nReadout → import FEDERAL ONLY for G0a (~${federal} rows), de-dup the Cognit.ca boilerplate, ` +
      `drop advisory/services. No structured eligibility columns exist → eligibility is a per-page scrape (G0c).`,
  );
}

async function inspectDisbursements() {
  header("2. DISBURSEMENT HISTORY — Grants & Contributions (real CSV resource)");
  const resources = await listResources(DISBURSE_PKG);
  // select by identity — NOT find(datastore_active), which grabs the nil file
  const real = resources.find((r) => r.id === DISBURSE_RESOURCE) ?? null;
  const nil = resources.find((r) => /nothing to report/i.test(r.name ?? ""));
  if (nil) console.log(`(trap avoided) "Nothing to Report" nil resource = ${nil.id} — NOT used.`);
  if (!real) {
    console.log(`⚠️  Pinned disbursement resource ${DISBURSE_RESOURCE} not found — re-resolve via package_show.`);
    resources.forEach((r) => console.log(`  - [${r.format}] ${r.name} (${r.id})`));
    return;
  }
  const sizeMb = typeof real.size === "number" ? `${(real.size / 1e6).toFixed(0)} MB` : "?";
  console.log(`Resource: ${real.id} (${real.name}) — ${real.format}, raw size ${sizeMb}`);
  const sample = await sampleDatastore(real.id);
  console.log(`Total disbursement rows: ${sample.total.toLocaleString()}  | fields: ${sample.fields.length}`);
  const ids = sample.fields.map((f) => f.id.toLowerCase());
  const has = (s: string) => ids.includes(s);
  console.log(
    `Join keys → program-name (prog_name_en): ${has("prog_name_en")}, funder (owner_org_title): ${has("owner_org_title")}, ` +
      `amount (agreement_value): ${has("agreement_value")}, date (agreement_start_date): ${has("agreement_start_date")}, ` +
      `recipient: ${has("recipient_legal_name")}, sector (naics_identifier): ${has("naics_identifier")}.`,
  );
  console.log(
    `\nReadout → fuzzy-join on prog_name_en + owner_org_title (pg_trgm). Expect LOW catalog-match coverage ` +
      `(institution vocab vs. marketing titles); keep orphans for funder+NAICS aggregates. Window to ~3 yrs of ` +
      `agreement_start_date for the Neon 0.5 GB budget (full set ~${sizeMb} raw / ~630 MB trimmed).`,
  );
}

async function main() {
  console.log("Funding Navigator data smoke-test —", new Date().toISOString());
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
  header("DECISION GATES (see docs/Funding-G0-Data-Foundation-Spec.md → Spike Findings)");
  console.log(
    [
      "• Catalog reachable + federal subset plausible?       → G0a imports federal-only, de-duped",
      "• No structured eligibility in feed (confirmed)        → G0c = per-page scrape → LLM-parse (primary)",
      "• Disbursement real resource + join keys present?      → G0b fuzzy-join, orphan-tolerant",
      "• Disbursement window fits Neon 0.5 GB?                → ~3 yrs of agreement_start_date (measure MB on import)",
    ].join("\n"),
  );
}

void main();
