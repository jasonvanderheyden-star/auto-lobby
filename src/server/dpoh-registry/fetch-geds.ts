// Sources:
//   DMs:  https://geds-sage.gc.ca/en/GEDS/?pgid=016&fid=11 (curated Deputy Ministers listing)
//   ADMs: https://geds-sage.gc.ca/en/GEDS/?pgid=010 advanced search, title = "Assistant/Associate Deputy Minister"

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

// NOTE: ADMs are fetched via the GEDS advanced search (pgid=010 → pgid=011).
// Form fields: sv=<title>, sf=4 (Title), sc=4 (Exact). Results paginate at 25/page
// via the same pgid=151 POST endpoint as DMs. If zero ADMs are returned, load
// pgid=010 in a browser and verify sf=4/sc=4 still exist and pgid=011 is the submit target.
const GEDS_ADM_SEARCH_PAGE_URL = "https://geds-sage.gc.ca/en/GEDS/?pgid=010";
const GEDS_ADM_SEARCH_URL = "https://geds-sage.gc.ca/en/GEDS/?pgid=011";

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
  // GEDS uses the full legal name; our registry uses the short form with domains attached.
  "treasury board of canada secretariat": "Treasury Board Secretariat",
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
  referer = GEDS_DM_PAGE_URL,
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
        Referer: referer,
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
    const roleSegment = segments.find((s) => /^(assistant deputy|associate deputy|deputy)\s/i.test(s));
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

const ADM_TITLES = ["Assistant Deputy Minister", "Associate Deputy Minister"] as const;
const GEDS_PAGE_SIZE = 25;

async function fetchGedsAdms(): Promise<GedsRow[]> {
  const seen = new Set<string>();
  const adms: GedsRow[] = [];

  for (const title of ADM_TITLES) {
    // Step 1: POST to the advanced search to get a bcrypt-signed filter token.
    const searchBody = new URLSearchParams({
      pgid: "011",
      cdn: "",
      sv: title,
      sf: "4", // Title field
      sc: "4", // Exact match
    });
    const searchHtml = await fetchWithTimeoutPost(
      GEDS_ADM_SEARCH_URL,
      searchBody,
      30_000,
      GEDS_ADM_SEARCH_PAGE_URL,
    );

    const tokenMatch = searchHtml.match(/showPageController\(1,(\d+),"([^"]+)",1\)/);
    if (!tokenMatch) {
      const titleMatch = searchHtml.match(/<title>([^<]*)<\/title>/);
      const formFields = [...searchHtml.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
      throw new Error(
        `fetchGedsAdms: could not find filter token for title "${title}"\n` +
          `  Page title: "${titleMatch?.[1]?.trim() ?? "(none)"}"\n` +
          `  Form fields found: ${formFields.join(", ")}\n` +
          `  The GEDS search form structure may have changed.`,
      );
    }

    const totalCount = parseInt(tokenMatch[1]!, 10);
    const token = tokenMatch[2]!;
    const numPages = Math.ceil(totalCount / GEDS_PAGE_SIZE);

    // Step 2: Fetch all pages of results.
    for (let page = 1; page <= numPages; page++) {
      const entriesBody = new URLSearchParams({ p1: String(page), p2: token, p3: "1" });
      const responseText = await fetchWithTimeoutPost(
        GEDS_ENTRIES_URL,
        entriesBody,
        30_000,
        GEDS_ADM_SEARCH_URL,
      );

      let entriesHtml: string;
      try {
        const json = JSON.parse(responseText) as { searchResults?: string };
        entriesHtml = json.searchResults ?? "";
      } catch {
        entriesHtml = responseText;
      }

      for (const row of parseEntriesHtml(entriesHtml)) {
        // Deduplicate by name+institution across both title searches.
        const key = `${row.name.toLowerCase()}|${row.institution.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          adms.push(row);
        }
      }
    }
  }

  if (adms.length === 0) {
    throw new Error(
      `fetchGedsAdms: no entries found across title searches: ${ADM_TITLES.join(", ")}.\n` +
        `  The GEDS advanced search structure may have changed.`,
    );
  }

  return adms;
}

export async function fetchGeds(): Promise<FetchGedsResult> {
  const dms = await fetchGedsDms();

  let adms: GedsRow[] = [];
  let admError: string | null = null;
  try {
    adms = await fetchGedsAdms();
  } catch (e) {
    admError = e instanceof Error ? e.message : String(e);
  }

  return { dms, adms, admError };
}
