// Source: GEDS org-tree traversal for ministerial exempt staff.
// Strategy: search each cabinet minister by name → locate their GEDS person record →
//   navigate to their ministerial office org unit via the person page breadcrumb →
//   collect direct reports + one level of sub-orgs.
//
// NOTE: pgid=008 is the GEDS quick-name-search. It embeds showPageController() and uses
// the same pgid=151 POST pattern as DM/ADM fetches. pgid=015 is the person detail page;
// pgid=014 is the org-unit browse page.

import * as cheerio from "cheerio";
import { db } from "@/lib/db";
import { canonicalizeName } from "./canonicalize";
import { fetchWithTimeout, fetchWithTimeoutPost } from "./geds-http";

const GEDS_BASE = "https://geds-sage.gc.ca/en/GEDS/";
const GEDS_SEARCH_URL = `${GEDS_BASE}?pgid=008`;
const GEDS_PERSON_URL = `${GEDS_BASE}?pgid=015`;
const GEDS_ORG_URL = `${GEDS_BASE}?pgid=014`;
const GEDS_ENTRIES_URL = `${GEDS_BASE}?pgid=151`;
const PAGE_SIZE = 25;
const MAX_STAFF_PER_OFFICE = 150;

export interface ExemptStaffRow {
  name: string;
  role: string;
  institution: string;
  ministerName: string;
}

export interface FetchExemptStaffResult {
  staff: ExemptStaffRow[];
  skipped: Array<{ ministerName: string; reason: string }>;
}

interface PersonEntry {
  name: string;
  role: string;
  personDn: string;
  orgDn: string;
  orgText: string;
}

function normalizeForCompare(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function extractDn(href: string): string | null {
  const qs = href.includes("?") ? href.split("?")[1]! : href;
  return new URLSearchParams(qs ?? "").get("dn");
}

function extractToken(html: string): { token: string; count: number } | null {
  const m = html.match(/showPageController\(1,(\d+),"([^"]+)",1\)/);
  if (!m) return null;
  return { count: parseInt(m[1]!, 10), token: m[2]! };
}

async function postEntries(token: string, page: number, referer: string): Promise<string> {
  const body = new URLSearchParams({ p1: String(page), p2: token, p3: "1" });
  const responseText = await fetchWithTimeoutPost(GEDS_ENTRIES_URL, body, 30_000, referer);
  try {
    const json = JSON.parse(responseText) as { searchResults?: string };
    return json.searchResults ?? "";
  } catch {
    return responseText;
  }
}

function parsePersonEntries(html: string): PersonEntry[] {
  const $ = cheerio.load(html);
  const entries: PersonEntry[] = [];

  $("li").each((_, li) => {
    const $li = $(li);
    const personLink = $li.find("a[href*='pgid=015']").first();
    if (!personLink.length) return;

    const rawName = personLink.text().trim();
    const commaIdx = rawName.indexOf(",");
    if (commaIdx < 0) return;
    const name = canonicalizeName(
      `${rawName.slice(commaIdx + 1).trim()} ${rawName.slice(0, commaIdx).trim()}`,
    );
    if (!name || name.split(" ").length < 2) return;

    const personDn = extractDn(personLink.attr("href") ?? "") ?? "";
    if (!personDn) return;

    const orgLink = $li.find("a[href*='pgid=014']").first();
    const orgDn = extractDn(orgLink.attr("href") ?? "") ?? "";
    const orgText =
      orgLink.find("abbr").attr("title")?.trim() ??
      orgLink.text().replace(/\s+/g, " ").trim();

    const segments = $li
      .text()
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const orgTextNorm = orgText.toLowerCase();
    const role =
      segments.find(
        (s) =>
          s !== rawName &&
          s.toLowerCase() !== orgTextNorm &&
          s.length > 2,
      ) ?? "";

    entries.push({ name, role, personDn, orgDn, orgText });
  });

  return entries;
}

function parseSubOrgDns(html: string): string[] {
  const $ = cheerio.load(html);
  const dns: string[] = [];

  $("li").each((_, li) => {
    const $li = $(li);
    if ($li.find("a[href*='pgid=015']").length > 0) return; // person entry
    const orgLink = $li.find("a[href*='pgid=014']").first();
    if (!orgLink.length) return;
    const dn = extractDn(orgLink.attr("href") ?? "");
    if (dn) dns.push(dn);
  });

  return dns;
}

async function searchMinisterInGeds(name: string): Promise<PersonEntry[]> {
  const searchUrl = `${GEDS_SEARCH_URL}&sv=${encodeURIComponent(name)}`;
  const pageHtml = await fetchWithTimeout(searchUrl);
  const tokenInfo = extractToken(pageHtml);
  if (!tokenInfo || tokenInfo.count === 0) return [];
  const entriesHtml = await postEntries(tokenInfo.token, 1, searchUrl);
  return parsePersonEntries(entriesHtml);
}

async function getOfficeDnFromPersonPage(personDn: string): Promise<string | null> {
  const personUrl = `${GEDS_PERSON_URL}&dn=${encodeURIComponent(personDn)}`;
  const html = await fetchWithTimeout(personUrl);
  const $ = cheerio.load(html);

  // First try: find an org link whose text explicitly names a ministerial office
  let officeDn: string | null = null;
  $("a[href*='pgid=014']").each((_, a) => {
    const text = $(a).text().trim();
    if (
      /office of the (minister|secretary of state|minister of state)/i.test(text) ||
      /minister'?s office/i.test(text) ||
      /ministerial office/i.test(text) ||
      /^minister of /i.test(text) ||        // "Minister of Foreign Affairs", "Minister of Finance"
      /^minister$/i.test(text) ||
      /^president of the /i.test(text)      // "President of the Treasury Board"
    ) {
      officeDn = extractDn($(a).attr("href") ?? "");
      return false; // break
    }
  });
  if (officeDn) return officeDn;

  // Fallback: take the deepest pgid=014 link — the person's immediate org unit
  const allOrgLinks = $("a[href*='pgid=014']").toArray();
  for (let i = allOrgLinks.length - 1; i >= 0; i--) {
    const dn = extractDn($(allOrgLinks[i]!).attr("href") ?? "");
    if (dn) return dn;
  }

  return null;
}

async function browseOrgUnit(
  orgDn: string,
): Promise<{ people: Array<{ name: string; role: string }>; subOrgDns: string[] }> {
  const orgUrl = `${GEDS_ORG_URL}&dn=${encodeURIComponent(orgDn)}`;
  const pageHtml = await fetchWithTimeout(orgUrl);

  // Sub-org links live in the static tree on the initial GET — extract them regardless
  // of whether there are any direct-report people (which require the pgid=151 POST).
  const staticSubOrgDns = parseSubOrgDns(pageHtml);

  const tokenInfo = extractToken(pageHtml);
  if (!tokenInfo || tokenInfo.count === 0) {
    // No pagination token: either a small org with inline entries, or an org-only container
    // with no direct people (e.g. a ministerial office whose staff live in sub-orgs).
    // In both cases, parse whatever person entries are in the static page and propagate sub-orgs.
    return {
      people: parsePersonEntries(pageHtml).map((e) => ({ name: e.name, role: e.role })),
      subOrgDns: staticSubOrgDns,
    };
  }

  const numPages = Math.ceil(tokenInfo.count / PAGE_SIZE);
  let combined = "";
  for (let page = 1; page <= numPages; page++) {
    combined += await postEntries(tokenInfo.token, page, orgUrl);
  }

  return {
    people: parsePersonEntries(combined).map((e) => ({ name: e.name, role: e.role })),
    subOrgDns: [...new Set([...staticSubOrgDns, ...parseSubOrgDns(combined)])],
  };
}

async function fetchStaffForMinister(
  ministerName: string,
  institution: string,
): Promise<ExemptStaffRow[]> {
  const searchResults = await searchMinisterInGeds(ministerName);
  if (searchResults.length === 0) {
    throw new Error("no GEDS search results found");
  }

  const nameNorm = normalizeForCompare(ministerName);
  const exactMatches = searchResults.filter(
    (e) => normalizeForCompare(e.name) === nameNorm,
  );

  let ministerEntry: PersonEntry;
  if (exactMatches.length === 1) {
    ministerEntry = exactMatches[0]!;
  } else if (exactMatches.length > 1) {
    // Disambiguate: try institution word first, then role containing "Minister"
    const instWord = institution.split(" ").find((w) => w.length > 3) ?? institution;
    const byInst = exactMatches.find((e) =>
      e.orgText.toLowerCase().includes(instWord.toLowerCase()),
    );
    const byRole = exactMatches.find((e) => /minister/i.test(e.role));
    const disambig = byInst ?? byRole;
    if (disambig) {
      ministerEntry = disambig;
    } else {
      throw new Error(`ambiguous search results (${exactMatches.length} exact name matches)`);
    }
  } else {
    // No exact accent-normalized match — try all-parts match (handles middle names, initials)
    const parts = nameNorm.split(" ");
    const partials = searchResults.filter((e) => {
      const en = normalizeForCompare(e.name);
      return parts.every((p) => en.includes(p));
    });
    if (partials.length === 1) {
      ministerEntry = partials[0]!;
    } else {
      throw new Error(
        `no entry found matching "${ministerName}" (${searchResults.length} result(s) returned)`,
      );
    }
  }

  // Navigate to the person page to find the ministerial office org unit DN
  const officeDn = await getOfficeDnFromPersonPage(ministerEntry.personDn);
  const targetOrgDn = officeDn ?? ministerEntry.orgDn;

  if (!targetOrgDn) {
    throw new Error("could not determine ministerial office org unit DN");
  }

  // Browse the ministerial office org unit
  const { people: topLevel, subOrgDns } = await browseOrgUnit(targetOrgDn);

  const allPeople = [...topLevel];

  // Browse sub-orgs one level deep
  for (const subDn of subOrgDns) {
    const { people: subPeople } = await browseOrgUnit(subDn);
    allPeople.push(...subPeople);
  }

  // If first level returned only sub-orgs and no people, go one level deeper.
  // Handles ministerial offices where staff are nested two levels deep (e.g. Finance).
  if (allPeople.length === 0 && subOrgDns.length > 0) {
    for (const subDn of subOrgDns) {
      const { people: subPeople, subOrgDns: deeperDns } = await browseOrgUnit(subDn);
      allPeople.push(...subPeople);
      for (const deepDn of deeperDns) {
        const { people: deepPeople } = await browseOrgUnit(deepDn);
        allPeople.push(...deepPeople);
      }
    }
  }

  if (allPeople.length > MAX_STAFF_PER_OFFICE) {
    throw new Error(
      `too many staff (${allPeople.length} > ${MAX_STAFF_PER_OFFICE}) — traversal may be too broad`,
    );
  }

  const seen = new Set<string>();
  const result: ExemptStaffRow[] = [];
  for (const p of allPeople) {
    if (!seen.has(p.name.toLowerCase())) {
      seen.add(p.name.toLowerCase());
      result.push({ name: p.name, role: p.role, institution, ministerName });
    }
  }

  return result;
}

export async function fetchExemptStaff(): Promise<FetchExemptStaffResult> {
  // Cabinet ministers only — parliamentary secretaries are MPs and have no GEDS offices
  const ministers = await db.publicOfficial.findMany({
    where: {
      resolvedFrom: "manual-ministers",
      NOT: { role: { contains: "Parliamentary Secretary", mode: "insensitive" } },
    },
    select: {
      name: true,
      institution: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  console.log(`[2i] Processing ${ministers.length} cabinet ministers`);

  const allStaff: ExemptStaffRow[] = [];
  const skipped: Array<{ ministerName: string; reason: string }> = [];
  const globalSeen = new Set<string>();

  for (const minister of ministers) {
    const institutionName = minister.institution.name;
    try {
      const ministerStaff = await fetchStaffForMinister(minister.name, institutionName);
      console.log(`[2i] ${minister.name} → ${ministerStaff.length} staff`);
      for (const row of ministerStaff) {
        const key = `${row.name.toLowerCase()}|${institutionName.toLowerCase()}`;
        if (!globalSeen.has(key)) {
          globalSeen.add(key);
          allStaff.push(row);
        }
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      console.log(`[2i] Skipped ${minister.name}: ${reason}`);
      skipped.push({ ministerName: minister.name, reason });
    }
  }

  if (allStaff.length === 0) {
    throw new Error(
      `fetchExemptStaff: zero staff found across ${ministers.length} ministers — structural failure`,
    );
  }

  return { staff: allStaff, skipped };
}
