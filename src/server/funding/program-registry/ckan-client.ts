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
 * Plain DataStore search helper (G0b reuse).
 *
 * Note the spike's CKAN quirks: `datastore_search_sql` is disabled (HTTP 400),
 * `datastore_search` with `limit=0` + `filters` returns HTTP 409, and the `q`
 * full-text param 409s as well. Source-side range filtering is therefore
 * impossible — but `sort=<col> desc` works, and dates are ISO `YYYY-MM-DD`
 * text, so G0b pages newest-first and stops once rows fall below the cutoff.
 *
 * `sort` is a CKAN sort expression (e.g. "agreement_start_date desc").
 * `fields` is a projection — only these columns are returned (smaller payloads).
 */
export async function datastoreSearch(
  resourceId: string,
  opts: { limit?: number; offset?: number; sort?: string; fields?: string[] } = {},
): Promise<DatastoreSearchResult> {
  const params: Record<string, string> = {
    resource_id: resourceId,
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
  };
  if (opts.sort) params.sort = opts.sort;
  if (opts.fields && opts.fields.length > 0) params.fields = opts.fields.join(",");
  return ckan<DatastoreSearchResult>("datastore_search", params);
}

// ─── Sequential paginator with backoff (G0b) ────────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Exponential backoff with jitter, retrying only on 409 / 5xx. CKAN's
 * disbursement endpoint is large and occasionally 409s under burst (spike
 * observation); transient 5xx are likewise retryable. Other errors throw.
 */
async function withCkanBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 6,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const msg = err instanceof Error ? err.message : String(err);
      const retryable = /HTTP (409|5\d\d)/.test(msg);
      if (!retryable || attempt >= maxAttempts) throw err;
      // Exponential backoff (base 500ms) capped at 16s, plus up to 1s jitter.
      const delay = Math.min(500 * 2 ** (attempt - 1), 16_000) + Math.random() * 1000;
      console.warn(
        `  ⚠ ${label}: ${msg} — retry ${attempt}/${maxAttempts - 1} in ${Math.round(delay)}ms`,
      );
      await sleep(delay);
    }
  }
}

export type DatastoreSearchAllOpts = {
  sort: string;
  fields?: string[];
  pageSize?: number;
  /**
   * Break predicate evaluated against the LAST record of each fetched page.
   * Return `true` to stop paging AFTER processing the current page. Used by
   * G0b for sorted-desc stop-at-cutoff: once a page's last (oldest-in-page)
   * row falls below the cutoff, no later page can be in-window.
   */
  stopWhen?: (lastRecord: Record<string, unknown>) => boolean;
  /** Optional per-page callback (e.g. for progress logging). */
  onPage?: (records: Record<string, unknown>[], offset: number, total: number) => void;
};

/**
 * Sequentially page an entire (or stop-at-cutoff truncated) DataStore resource.
 *
 * Sequential — NOT parallel — to keep load off the endpoint and respect the
 * backoff. Stops when a page returns fewer than `pageSize` rows (exhausted) or
 * when `stopWhen(lastRecord)` returns true (G0b cutoff). Returns every record
 * fetched up to and including the page that tripped `stopWhen`.
 */
export async function datastoreSearchAll(
  resourceId: string,
  opts: DatastoreSearchAllOpts,
): Promise<Record<string, unknown>[]> {
  const pageSize = opts.pageSize ?? 10_000;
  const out: Record<string, unknown>[] = [];
  let offset = 0;
  for (;;) {
    const searchOpts: { limit: number; offset: number; sort: string; fields?: string[] } = {
      limit: pageSize,
      offset,
      sort: opts.sort,
    };
    if (opts.fields) searchOpts.fields = opts.fields;
    const page = await withCkanBackoff(
      () => datastoreSearch(resourceId, searchOpts),
      `datastore_search offset=${offset}`,
    );
    const records = page.records;
    out.push(...records);
    opts.onPage?.(records, offset, page.total);

    if (records.length < pageSize) break; // resource exhausted
    const last = records[records.length - 1]!;
    if (opts.stopWhen?.(last)) break; // cutoff tripped — no later page is in-window
    offset += pageSize;
  }
  return out;
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
