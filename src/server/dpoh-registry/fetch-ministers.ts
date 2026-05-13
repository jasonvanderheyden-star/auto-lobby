// Source: https://www.canada.ca/en/government/ministers.html
// Single page listing ministers, secretaries of state, and parliamentary secretaries.
// Carney ministry effective from 2025-05-13.

import * as cheerio from "cheerio";
import { canonicalizeName } from "./canonicalize";

const MINISTERS_URL =
  "https://www.canada.ca/en/government/ministers.html";
const EFFECTIVE_FROM = "2025-05-13";

export interface MinisterFetchRow {
  name: string;
  role: string;
  institution: string;
  effectiveFrom: string;
}

export interface FetchMinistersResult {
  cabinetMinisters: MinisterFetchRow[];
  parliamentarySecretaries: MinisterFetchRow[];
}

// Lowercase, dash-normalised first-portfolio key → InstitutionRegistry name.
// Multi-portfolio roles (e.g. "Minister of Justice … and Minister responsible for …")
// are split on " and " and only the first segment is looked up.
// Unmapped portfolios fall through to resolveInstitution(), which derives a
// plausible name and lets the seeder auto-create the InstitutionRegistry row.
const PORTFOLIO_TO_INSTITUTION: Readonly<Record<string, string>> = {
  "prime minister of canada": "Privy Council Office",
  "prime minister": "Privy Council Office",
  "president of the treasury board": "Treasury Board Secretariat",
  "president of the king's privy council for canada": "Privy Council Office",
  "president of the queen's privy council for canada": "Privy Council Office",
  "leader of the government in the house of commons": "House of Commons",
  "minister of transport and leader of the government in the house of commons":
    "Transport Canada",
  "minister of finance": "Finance Canada",
  "minister of finance and national revenue": "Finance Canada",
  "minister of national revenue": "Canada Revenue Agency",
  "minister of environment and climate change": "Environment and Climate Change Canada",
  "minister of environment, climate change and nature":
    "Environment and Climate Change Canada",
  "minister of the environment, climate change and nature":
    "Environment and Climate Change Canada",
  "minister of natural resources": "Natural Resources Canada",
  "minister of energy and natural resources": "Natural Resources Canada",
  "minister of foreign affairs": "Global Affairs Canada",
  "minister of international trade": "Global Affairs Canada",
  "minister of industry": "Innovation, Science and Economic Development Canada",
  "minister of artificial intelligence and digital innovation":
    "Innovation, Science and Economic Development Canada",
  "minister of agriculture and agri-food": "Agriculture and Agri-Food Canada",
  "minister of justice": "Department of Justice Canada",
  "minister of justice and attorney general": "Department of Justice Canada",
  "minister of justice and attorney general of canada": "Department of Justice Canada",
  "minister of health": "Health Canada",
  "minister of transport": "Transport Canada",
  "minister of transport and internal trade": "Transport Canada",
  "minister of national defence": "National Defence",
  "minister of public services and procurement": "Public Services and Procurement Canada",
  "minister of government transformation, public works and procurement":
    "Public Services and Procurement Canada",
  "minister of government transformation, public services and procurement":
    "Public Services and Procurement Canada",
  "minister of public safety": "Public Safety Canada",
  "minister of emergency management and community resilience": "Public Safety Canada",
  "minister of fisheries": "Fisheries and Oceans Canada",
  "minister of fisheries, oceans and the canadian coast guard":
    "Fisheries and Oceans Canada",
  "minister of employment and social development":
    "Employment and Social Development Canada",
  "minister of jobs and families": "Employment and Social Development Canada",
  "secretary of state (labour)": "Employment and Social Development Canada",
  "minister of immigration, refugees and citizenship":
    "Immigration, Refugees and Citizenship Canada",
  "minister of housing": "Infrastructure Canada",
  "minister of housing and infrastructure": "Infrastructure Canada",
  "minister of veterans affairs": "Veterans Affairs Canada",
  "minister of crown-indigenous relations":
    "Crown-Indigenous Relations and Northern Affairs Canada",
  "minister of indigenous services": "Indigenous Services Canada",
  "minister of northern and arctic affairs":
    "Crown-Indigenous Relations and Northern Affairs Canada",
  "minister of women and gender equality": "Women and Gender Equality Canada",
  "minister of women and gender equality and secretary of state (small business and tourism)":
    "Women and Gender Equality Canada",
  "minister of canadian heritage": "Canadian Heritage",
  "minister of canadian identity and culture": "Canadian Heritage",
};

function normaliseKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/['']/g, "'") // normalize curly apostrophes from HTML
    .replace(/\s+/g, " ");
}

// Strip secondary mandates so the primary portfolio can be looked up in the map.
// Handles: "and Minister responsible for X", "and Associate Minister of X",
// "and Secretary of State (X)", "and Québec/[Province] Lieutenant", etc.
function primaryPortfolio(role: string): string {
  return role
    .replace(
      / and (Minister responsible for|Associate Minister of|Secretary of State\b|\w+ Lieutenant\b).*/i,
      "",
    )
    .trim();
}

function resolveInstitution(role: string): string {
  // Parliamentary secretaries are always MPs — caller sets institution directly.
  const primary = primaryPortfolio(role);
  const mapped = PORTFOLIO_TO_INSTITUTION[normaliseKey(primary)];
  if (mapped) return mapped;
  // Derive a plausible institution name; the seeder will auto-create the row.
  const stripped = primary
    .replace(/^(the\s+)?minister (of|responsible for)\s+/i, "")
    .trim();
  return /canada/i.test(stripped) ? stripped : `${stripped} Canada`;
}

async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
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

// The canada.ca ministers page uses a <dl> pattern:
//   <dt> <a href="/en/government/ministers/<slug>.html">The Honourable Name</a> </dt>
//   <dd>  Role text  </dd>
//
// Ministers and parliamentary secretaries are all on the same page.
// We split them by checking whether the role contains "Parliamentary Secretary".
function parsePage(html: string): FetchMinistersResult {
  const $ = cheerio.load(html);
  const cabinetMinisters: MinisterFetchRow[] = [];
  const parliamentarySecretaries: MinisterFetchRow[] = [];
  const seen = new Set<string>();

  $("dt").each((_, dt) => {
    const $dt = $(dt);
    const $link = $dt.find("a[href*='/government/ministers/'], a[href*='/government/management/']");
    if (!$link.length) return;

    const rawName = $link.text().trim();
    const name = canonicalizeName(rawName);
    if (!name || name.split(" ").length < 2) return;
    if (seen.has(name.toLowerCase())) return;

    // Role is in the immediately following <dd>.
    const role = $dt.next("dd").text().trim().replace(/\s+/g, " ");
    if (!role) return;

    seen.add(name.toLowerCase());

    if (role.toLowerCase().includes("parliamentary secretary")) {
      // Parliamentary secretaries are MPs — institution is always House of Commons.
      parliamentarySecretaries.push({
        name,
        role,
        institution: "House of Commons",
        effectiveFrom: EFFECTIVE_FROM,
      });
    } else {
      cabinetMinisters.push({
        name,
        role,
        institution: resolveInstitution(role),
        effectiveFrom: EFFECTIVE_FROM,
      });
    }
  });

  if (cabinetMinisters.length === 0 && parliamentarySecretaries.length === 0) {
    const title = $("title").text().trim();
    const dtCount = $("dt").length;
    const govLinks =
      $("a[href*='/government/ministers/'], a[href*='/government/management/']").length;
    throw new Error(
      `parsePage: no entries found on ${MINISTERS_URL}\n` +
        `  Page title: "${title}"\n` +
        `  <dt> elements: ${dtCount}\n` +
        `  Links matching /government/ministers/ or /government/management/: ${govLinks}\n` +
        `  The HTML structure may have changed. Update selectors in fetch-ministers.ts.`,
    );
  }

  return { cabinetMinisters, parliamentarySecretaries };
}

export async function fetchMinisters(): Promise<FetchMinistersResult> {
  const html = await fetchWithTimeout(MINISTERS_URL);
  return parsePage(html);
}
