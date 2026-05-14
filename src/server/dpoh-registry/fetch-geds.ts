// Sources:
//   DMs:  https://geds-sage.gc.ca/en/GEDS/?pgid=016&fid=11  (curated GEDS Deputy Ministers listing)
//   ADMs: https://api.geds-sage.gc.ca/GEDS20/dist/opendata/ (open data API — probed, may be unavailable)

import * as cheerio from "cheerio";
import { canonicalizeName } from "./canonicalize";

// NOTE: The GEDS DM listing (pgid=016&fid=11) renders its results via AJAX.
// The page embeds a bcrypt-signed filter token in a showPageController() JS call.
// Fetching DMs requires two requests:
//   1. GET pgid=016&fid=11 to extract the session token
//   2. POST pgid=151 with the token to get the HTML fragment of results
// If zero DMs are returned, inspect the page's JS for showPageController() calls
// and verify the pgid=151 POST endpoint is still used.
const GEDS_DM_PAGE_URL = "https://geds-sage.gc.ca/en/GEDS/?pgid=016&fid=11";
const GEDS_ENTRIES_URL = "https://geds-sage.gc.ca/en/GEDS/?pgid=151";

// NOTE: As of 2026-05-14, this endpoint returns HTTP 403 Forbidden.
// If ADMs are needed in a future chunk, check api.geds-sage.gc.ca for a new
// open-data endpoint, or scrape https://geds-sage.gc.ca with a title filter
// using the same two-request pattern as the DM fetch above.
const GEDS_ADM_API_URL = "https://api.geds-sage.gc.ca/GEDS20/dist/opendata/";

export interface GedsRow {
  name: string;
  role: string;
  institution: string;
}

export interface FetchGedsResult {
  dms: GedsRow[];
  adms: GedsRow[];
  admError: string | null;
}

// Maps GEDS department names → InstitutionRegistry names where they differ.
// GEDS uses short-form or reorganized names that don't match our registry.
// Bilingual suffixes (" - French name") are stripped before this lookup.
const GEDS_DEPT_MAP: Readonly<Record<string, string>> = {
  "justice canada": "Department of Justice Canada",
};

function normalizeGedsDept(raw: string): string {
  // Strip bilingual suffix: "English Name - Nom français" → "English Name"
  const dashIdx = raw.indexOf(" - ");
  const english = dashIdx >= 0 ? raw.slice(0, dashIdx).trim() : raw.trim();
  return GEDS_DEPT_MAP[english.toLowerCase()] ?? english;
}

async function fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; auto-lobby/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithTimeoutPost(
  url: string,
  body: URLSearchParams,
  timeoutMs = 30_000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; auto-lobby/1.0)",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: GEDS_DM_PAGE_URL,
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseEntriesHtml(html: string): GedsRow[] {
  const $ = cheerio.load(html);
  const dms: GedsRow[] = [];

  $("li").each((_, li) => {
    const $li = $(li);

    // Person link uses pgid=015
    const personLink = $li.find("a[href*='pgid=015']");
    if (!personLink.length) return;

    // Name is in "Last, First" format
    const rawName = personLink.text().trim();
    const commaIdx = rawName.indexOf(",");
    if (commaIdx < 0) return;
    const last = rawName.slice(0, commaIdx).trim();
    const firstRest = rawName.slice(commaIdx + 1).trim();
    const name = canonicalizeName(`${firstRest} ${last}`);
    if (!name || name.split(" ").length < 2) return;

    // Department: first org link (pgid=014), first abbr title
    const rawDept = $li.find("a[href*='pgid=014']").first().find("abbr").attr("title")?.trim() ?? "";
    const institution = normalizeGedsDept(rawDept);
    if (!institution) return;

    // Role: segment matching "Deputy ..." in the full text, split by ";"
    const segments = $li
      .text()
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const roleSegment = segments.find((s) => /^(deputy|associate deputy)\s/i.test(s));
    const role = roleSegment ?? "Deputy Minister";

    dms.push({ name, role, institution });
  });

  return dms;
}

async function fetchGedsDms(): Promise<GedsRow[]> {
  // Step 1: load the DM listing page to get the session-bound filter token.
  const pageHtml = await fetchWithTimeout(GEDS_DM_PAGE_URL);
  const tokenMatch = pageHtml.match(/showPageController\(1,\d+,"([^"]+)",1\)/);
  if (!tokenMatch) {
    const titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/);
    throw new Error(
      `fetchGedsDms: could not find filter token in ${GEDS_DM_PAGE_URL}\n` +
        `  Page title: "${titleMatch?.[1]?.trim() ?? "(none)"}"\n` +
        `  The page structure may have changed. Look for showPageController() in the JS.`,
    );
  }
  const token = tokenMatch[1]!;

  // Step 2: POST to the entries endpoint with the token to get the HTML fragment.
  const body = new URLSearchParams({ p1: "1", p2: token, p3: "1" });
  const responseText = await fetchWithTimeoutPost(GEDS_ENTRIES_URL, body);

  // The endpoint returns JSON with a searchResults field containing an HTML fragment.
  let entriesHtml: string;
  try {
    const json = JSON.parse(responseText) as { searchResults?: string };
    entriesHtml = json.searchResults ?? "";
  } catch {
    entriesHtml = responseText;
  }

  const dms = parseEntriesHtml(entriesHtml);

  if (dms.length === 0) {
    throw new Error(
      `fetchGedsDms: no Deputy Minister entries found after parsing.\n` +
        `  Token extracted: ${token.length > 0 ? "yes" : "no"}\n` +
        `  Entries HTML length: ${entriesHtml.length}\n` +
        `  The GEDS page structure or AJAX endpoint may have changed.`,
    );
  }

  return dms;
}

async function fetchGedsAdms(): Promise<GedsRow[]> {
  // One request, 10-second timeout per brief. Throw on non-200 or unusable format.
  const indexHtml = await fetchWithTimeout(GEDS_ADM_API_URL, 10_000);

  // Check for a usable index — expect some machine-readable listing of data files.
  const hasUsableContent =
    indexHtml.includes(".csv") ||
    indexHtml.includes(".json") ||
    indexHtml.includes(".xml") ||
    indexHtml.includes("href=");

  if (!hasUsableContent) {
    throw new Error(
      `fetchGedsAdms: GEDS open data API at ${GEDS_ADM_API_URL} returned a response ` +
        `but no usable data format was found (no CSV/JSON/XML links detected).\n` +
        `  Response length: ${indexHtml.length} chars\n` +
        `  Handle ADMs in a follow-up chunk using an alternative source.`,
    );
  }

  // If we get here, the API returned a usable index. Parse and filter ADMs.
  // (Currently unreachable — API is 403 — but implemented for when it becomes available.)
  throw new Error(
    `fetchGedsAdms: GEDS open data API returned a usable index at ${GEDS_ADM_API_URL}, ` +
      `but ADM parsing from that index is not yet implemented. ` +
      `Implement ADM extraction in a follow-up chunk.`,
  );
}

export async function fetchGeds(): Promise<FetchGedsResult> {
  const dms = await fetchGedsDms();

  // ADM fetch: throws on 403 or unusable format per brief.
  // We capture the error rather than aborting the DM seed.
  let adms: GedsRow[] = [];
  let admError: string | null = null;
  try {
    adms = await fetchGedsAdms();
  } catch (e) {
    admError = e instanceof Error ? e.message : String(e);
  }

  return { dms, adms, admError };
}
