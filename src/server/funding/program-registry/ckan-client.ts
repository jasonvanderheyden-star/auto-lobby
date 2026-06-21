/**
 * src/server/funding/program-registry/ckan-client.ts
 *
 * Typed, reusable CKAN client for the open.canada.ca action API.
 *
 * G0a uses the file-resource + XLSX-parse path: the Business Benefits Finder
 * catalog is published as periodic XLSX file resources, NOT loaded into the
 * DataStore. We resolve the latest XLSX resource via `package_show`, download
 * its `url`, and parse the workbook (unzipper + fast-xml-parser, both already
 * dependencies).
 *
 * Techniques ported from the corrected smoke test (scripts/spike-funding-data.ts;
 * see docs/Funding-G0-Data-Foundation-Spec.md → "Spike Findings").
 *
 * Resource-selection discipline (spike-learned):
 *   - Resource IDs change on re-publish → ALWAYS resolve at runtime via
 *     package_show; record the resolved id as sourceVersion. Never hardcode.
 *   - For the catalog, select the newest XLSX resource by last_modified.
 *   - `datastoreSearch()` is kept (typed) for G0b reuse; G0a never calls it.
 */

import unzipper from "unzipper";
import { XMLParser } from "fast-xml-parser";

const CKAN = "https://open.canada.ca/data/api/3/action";

// ─── Public types ───────────────────────────────────────────────────────────

export type CkanResource = {
  id: string;
  name?: string;
  format?: string;
  datastore_active?: boolean;
  url?: string;
  size?: number | null;
  last_modified?: string;
};

export type CkanPackage = {
  id: string;
  resources: CkanResource[];
};

export type DatastoreSearchResult = {
  fields: { id: string; type: string }[];
  records: Record<string, unknown>[];
  total: number;
};

export type ParsedSheet = { headers: string[]; rows: string[][] };

// ─── CKAN action API ────────────────────────────────────────────────────────

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

/** Fetch a package's metadata (including its resource list). */
export async function packageShow(pkgId: string): Promise<CkanPackage> {
  return ckan<CkanPackage>("package_show", { id: pkgId });
}

/** List the resources attached to a package. */
export async function listResources(pkgId: string): Promise<CkanResource[]> {
  const pkg = await packageShow(pkgId);
  return pkg.resources ?? [];
}

/**
 * Resolve the latest XLSX file resource on a package.
 *
 * Filters to `format === "XLSX" && url`, sorts by `last_modified` descending,
 * and returns the newest. Throws loudly if none resolve so the caller never
 * silently imports nothing. Deliberately NOT pinned to a hardcoded resource id
 * (the human was explicit): resource IDs change on re-publish.
 */
export async function resolveLatestCatalogXlsx(pkgId: string): Promise<CkanResource> {
  const resources = await listResources(pkgId);
  const xlsx = resources
    .filter((r) => (r.format ?? "").toUpperCase() === "XLSX" && Boolean(r.url))
    .sort((a, b) => (b.last_modified ?? "").localeCompare(a.last_modified ?? ""));
  const latest = xlsx[0];
  if (!latest?.url) {
    throw new Error(
      `resolveLatestCatalogXlsx: no XLSX resource with a url found on package ${pkgId} ` +
        `(found ${resources.length} resources: ${resources
          .map((r) => `${r.format}:${r.id}`)
          .join(", ")})`,
    );
  }
  return latest;
}

/**
 * Plain DataStore search helper (kept for G0b reuse — G0a does not call it).
 *
 * Note the spike's CKAN quirks: `datastore_search_sql` is disabled (HTTP 400)
 * and `datastore_search` with `limit=0` + `filters` returns HTTP 409. Page with
 * `limit`/`offset` instead.
 */
export async function datastoreSearch(
  resourceId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DatastoreSearchResult> {
  return ckan<DatastoreSearchResult>("datastore_search", {
    resource_id: resourceId,
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
  });
}

// ─── XLSX (SpreadsheetML) reader ────────────────────────────────────────────
// Lifted from the spike: unzip the workbook, parse sharedStrings + sheet1,
// resolve cell column positions via the A1-style cell reference.

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

type XmlNode =
  | string
  | number
  | { "#text"?: string | number; [k: string]: unknown };

const asArray = <T>(x: T | T[] | undefined): T[] =>
  Array.isArray(x) ? x : x == null ? [] : [x];

function nodeText(n: XmlNode | undefined): string {
  if (n == null) return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (n["#text"] != null) return String(n["#text"]);
  return "";
}

/** Convert an A1-style cell ref (e.g. "C5") to a 0-based column index. */
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? ["A"])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Download an XLSX file by URL and parse its first worksheet into a 2-D string
 * grid. Returns `{ headers, rows }` where `headers` is row 0 and `rows` is the
 * remainder. Callers decide which further rows are header/translation rows.
 */
export async function fetchAndParseXlsx(url: string): Promise<ParsedSheet> {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const dir = await unzipper.Open.buffer(buf);

  const read = async (entryPath: string): Promise<string> => {
    const entry = dir.files.find((f) => f.path === entryPath);
    if (!entry) throw new Error(`missing ${entryPath} in workbook`);
    return (await entry.buffer()).toString("utf8");
  };

  // shared strings table
  const ss = xml.parse(await read("xl/sharedStrings.xml")) as {
    sst?: { si?: XmlNode | XmlNode[] };
  };
  const shared = asArray(ss.sst?.si).map((si) => {
    const node = si as { t?: XmlNode; r?: XmlNode | XmlNode[] };
    if (node.t != null) return nodeText(node.t);
    return asArray(node.r)
      .map((r) => nodeText((r as { t?: XmlNode }).t))
      .join("");
  });

  // first worksheet
  const sheet = xml.parse(await read("xl/worksheets/sheet1.xml")) as {
    worksheet?: { sheetData?: { row?: unknown } };
  };
  const rowNodes = asArray(sheet.worksheet?.sheetData?.row) as { c?: unknown }[];
  const rows: string[][] = rowNodes.map((row) => {
    const cells = asArray(row.c) as {
      "@_r"?: string;
      "@_t"?: string;
      v?: XmlNode;
      is?: { t?: XmlNode };
    }[];
    const out: string[] = [];
    for (const c of cells) {
      const idx = colIndex(c["@_r"] ?? "A1");
      let val = "";
      if (c.v != null) {
        val = c["@_t"] === "s" ? (shared[Number(nodeText(c.v))] ?? "") : nodeText(c.v);
      } else if (c.is?.t != null) {
        val = nodeText(c.is.t);
      }
      out[idx] = val;
    }
    return out;
  });

  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}
