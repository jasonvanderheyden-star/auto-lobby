// Sources:
//   MPs:      https://www.ourcommons.ca/members/en/search/xml?searchText=&province=&party=&caucusId=&current=True
//   Senators: https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?displayFor=senatorslist

import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { canonicalizeName } from "./canonicalize";

const MP_XML_URL =
  "https://www.ourcommons.ca/members/en/search/xml?searchText=&province=&party=&caucusId=&current=True";
// NOTE: This is the internal Umbraco AJAX endpoint that sencanada.ca/en/senators/
// calls on page load. It returns a partial HTML fragment (not JSON), hence the
// cheerio parsing below. If this starts returning 0 rows, inspect the network
// tab on sencanada.ca/en/senators/ to find the new endpoint or fall back to
// parsing that page directly.
const SENATORS_URL =
  "https://sencanada.ca/umbraco/surface/SenatorsAjax/GetSenators?displayFor=senatorslist";

export interface ParliamentFetchRow {
  name: string;
  role: string;
  institution: string;
}

export interface FetchParliamentResult {
  members: ParliamentFetchRow[];
  senators: ParliamentFetchRow[];
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; auto-lobby/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-CA,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://sencanada.ca/en/senators/",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseMpXml(xml: string): ParliamentFetchRow[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const doc = parser.parse(xml) as {
    ArrayOfMemberOfParliament?: {
      MemberOfParliament?: Array<{
        PersonOfficialFirstName?: string;
        PersonOfficialLastName?: string;
        ToDateTime?: { "@_xsi:nil"?: string } | string;
      }>;
    };
  };

  const raw = doc?.ArrayOfMemberOfParliament?.MemberOfParliament;
  if (!raw || raw.length === 0) {
    throw new Error(
      `parseMpXml: no MemberOfParliament entries found.\n` +
        `  XML root keys: ${Object.keys(doc ?? {}).join(", ")}\n` +
        `  The XML structure may have changed. Update selectors in fetch-parliament.ts.`,
    );
  }

  const members: ParliamentFetchRow[] = [];
  for (const mp of raw) {
    // Only include current members (ToDateTime xsi:nil="true" means still sitting)
    const toDate = mp.ToDateTime;
    const isCurrent =
      toDate === null ||
      toDate === undefined ||
      (typeof toDate === "object" && toDate["@_xsi:nil"] === "true");
    if (!isCurrent) continue;

    const first = (mp.PersonOfficialFirstName ?? "").trim();
    const last = (mp.PersonOfficialLastName ?? "").trim();
    if (!first || !last) continue;

    members.push({
      name: `${first} ${last}`,
      role: "Member of Parliament",
      institution: "House of Commons",
    });
  }

  if (members.length === 0) {
    throw new Error(
      `parseMpXml: parsed ${raw.length} MemberOfParliament elements but found 0 current members.\n` +
        `  Check ToDateTime filter logic in fetch-parliament.ts.`,
    );
  }

  return members;
}

function parseSenatorHtml(html: string): ParliamentFetchRow[] {
  const $ = cheerio.load(html);
  const senators: ParliamentFetchRow[] = [];
  const seen = new Set<string>();

  // Names are in td[data-order="Last, First"] format inside #senator-list-view-table
  $("#senator-list-view-table tbody tr").each((_, tr) => {
    const $td = $(tr).find("td[data-order]").first();
    const dataOrder = $td.attr("data-order")?.trim();
    if (!dataOrder) return;

    // Reverse "Last, First M." → "First M. Last"
    const commaIdx = dataOrder.indexOf(",");
    if (commaIdx < 0) return;
    const last = dataOrder.slice(0, commaIdx).trim();
    const firstRest = dataOrder.slice(commaIdx + 1).trim();
    const rawName = `${firstRest} ${last}`;

    const name = canonicalizeName(rawName);
    if (!name || name.split(" ").length < 2) return;
    if (seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());

    senators.push({
      name,
      role: "Senator",
      institution: "Senate of Canada",
    });
  });

  if (senators.length === 0) {
    const title = $("title").text().trim();
    const rowCount = $("#senator-list-view-table tbody tr").length;
    throw new Error(
      `parseSenatorHtml: no senator entries found.\n` +
        `  Page title: "${title}"\n` +
        `  Table rows: ${rowCount}\n` +
        `  The HTML structure may have changed. Update selectors in fetch-parliament.ts.`,
    );
  }

  return senators;
}

export async function fetchParliament(): Promise<FetchParliamentResult> {
  const [mpXml, senatorHtml] = await Promise.all([
    fetchWithTimeout(MP_XML_URL),
    fetchWithTimeout(SENATORS_URL),
  ]);

  const members = parseMpXml(mpXml);
  const senators = parseSenatorHtml(senatorHtml);

  return { members, senators };
}
