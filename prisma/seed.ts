/**
 * prisma/seed.ts — Federal institution + gov-domain registry
 *
 * Idempotent: upserts keyed on institution name. Safe to re-run.
 * Run via: npm run db:seed
 *
 * Coverage rationale
 * ──────────────────
 * Ordered by relevance to Deep Sky (climate / direct air capture):
 *   1. Climate & clean-tech institutions — meetings here are highest-priority
 *   2. Central agencies — Finance, PCO, PMO, TBS have DPOHs for any registrant
 *   3. Other line departments with cross-cutting mandates
 *   4. Crown corporations relevant to deep-tech funding
 *   5. Parliament — MPs and senators are DPOHs by statute
 *   6. Oversight (OCL itself)
 *
 * Domain notes
 * ────────────
 * - gc.ca subdomains are the primary email domains for federal staff.
 * - canada.ca is a shared web domain; we only include institution-specific
 *   subdomains (e.g. ised-isde.canada.ca) to avoid false positives.
 * - Legacy domains kept alongside current ones (e.g. ic.gc.ca for ISED).
 * - Parliamentary email domains differ from public web domains.
 *
 * isDpohSource
 * ────────────
 * true  = institution has Designated Public Office Holders (ministers,
 *         parliamentary secretaries, DMs/ADMs, or named designated positions).
 * false = Crown corps / arm's-length bodies whose executives are NOT listed
 *         as designated positions in the current Lobbying Act regulations.
 *         (They can still appear in meetings; flag is for DPOH auto-detection.)
 *
 * Program-office notes
 * ────────────────────
 * - Strategic Innovation Fund (SIF): a program under ISED → matches ISED domains.
 * - Impact Canada / Impact and Innovation Unit: housed in PCO → matches PCO domains.
 * - Canada Growth Fund: administered through Finance Canada → matches FIN domains.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type InstitutionSeed = {
  name: string;
  acronym: string | null;
  domains: string[];
  isDpohSource: boolean;
};

const FEDERAL_INSTITUTIONS: InstitutionSeed[] = [
  // ── 1. Climate & clean-tech — highest priority for Deep Sky ─────────────────

  {
    name: "Environment and Climate Change Canada",
    acronym: "ECCC",
    // Primary email domain for all ECCC staff
    domains: ["ec.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Natural Resources Canada",
    acronym: "NRCan",
    // Single bilingual domain used for all NRCan email
    domains: ["nrcan-rncan.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Innovation, Science and Economic Development Canada",
    acronym: "ISED",
    // ised-isde.canada.ca: post-2017 rebrand; ic.gc.ca: legacy Industry Canada
    // Also administers Strategic Innovation Fund (SIF) and Clean Growth Hub
    domains: ["ised-isde.canada.ca", "ic.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Sustainable Development Technology Canada",
    acronym: "SDTC",
    // Arm's-length foundation; not a designated-position institution
    domains: ["sdtc.ca"],
    isDpohSource: false,
  },
  {
    name: "Canada Infrastructure Bank",
    acronym: "CIB",
    domains: ["cib-bic.ca"],
    isDpohSource: false,
  },
  {
    name: "Impact Assessment Agency of Canada",
    acronym: "IAAC",
    // Post-2019 successor to CEAA; major role for DAC projects
    domains: ["iaac-aeic.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Canada Energy Regulator",
    acronym: "CER",
    // Post-2019 successor to NEB
    domains: ["cer-rec.gc.ca"],
    isDpohSource: true,
  },

  // ── 2. Central agencies — relevant for any federal registrant ────────────────

  {
    name: "Finance Canada",
    acronym: "FIN",
    // Also administers Canada Growth Fund (via PSP Investments mandate)
    domains: ["fin.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Privy Council Office",
    acronym: "PCO",
    // Hosts Impact Canada / Impact and Innovation Unit
    domains: ["pco-bcp.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Prime Minister's Office",
    acronym: "PMO",
    // Ministers' exempt staff (chiefs of staff, senior policy advisors) are DPOHs
    domains: ["pmo-cpm.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Treasury Board Secretariat",
    acronym: "TBS",
    domains: ["tbs-sct.gc.ca"],
    isDpohSource: true,
  },

  // ── 3. Other line departments ────────────────────────────────────────────────

  {
    name: "Global Affairs Canada",
    acronym: "GAC",
    // international.gc.ca: current; dfatd-maecd.gc.ca: legacy DFATD pre-2015
    domains: ["international.gc.ca", "dfatd-maecd.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Agriculture and Agri-Food Canada",
    acronym: "AAFC",
    domains: ["agr.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Transport Canada",
    acronym: "TC",
    domains: ["tc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Public Services and Procurement Canada",
    acronym: "PSPC",
    domains: ["pwgsc-tpsgc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Canada Revenue Agency",
    acronym: "CRA",
    domains: ["cra-arc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Health Canada",
    acronym: "HC",
    domains: ["hc-sc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Public Health Agency of Canada",
    acronym: "PHAC",
    domains: ["phac-aspc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Employment and Social Development Canada",
    acronym: "ESDC",
    // esdc-edsc.gc.ca: post-rebrand; hrsdc-rhdcc.gc.ca: legacy HRSDC still in use
    domains: ["hrsdc-rhdcc.gc.ca", "esdc-edsc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Fisheries and Oceans Canada",
    acronym: "DFO",
    domains: ["dfo-mpo.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Public Safety Canada",
    acronym: "PS",
    domains: ["ps-sp.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Department of Justice Canada",
    acronym: "JUS",
    domains: ["justice.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "National Defence",
    acronym: "DND",
    // forces.gc.ca: CAF members; dnd-mdn.gc.ca: civilian DND employees
    domains: ["forces.gc.ca", "dnd-mdn.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "National Research Council Canada",
    acronym: "NRC",
    // NRC President is a designated position under the Lobbying Act
    domains: ["nrc-cnrc.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Canadian Space Agency",
    acronym: "CSA",
    domains: ["asc-csa.gc.ca"],
    isDpohSource: true,
  },
  {
    name: "Parks Canada",
    acronym: "PC",
    // Relevant for land-use and carbon sequestration discussions
    domains: ["pc.gc.ca"],
    isDpohSource: true,
  },

  // ── 4. Crown corporations (relevant to deep-tech / climate funding) ──────────

  {
    name: "Export Development Canada",
    acronym: "EDC",
    // EDC president not a designated DPOH under current regulations
    domains: ["edc.ca"],
    isDpohSource: false,
  },
  {
    name: "Business Development Bank of Canada",
    acronym: "BDC",
    domains: ["bdc.ca"],
    isDpohSource: false,
  },

  // ── 5. Parliament — MPs and senators are DPOHs by statute ───────────────────

  {
    name: "House of Commons",
    acronym: null,
    // parl.gc.ca: shared Parliamentary network; ourcommons.ca: HoC-specific
    domains: ["parl.gc.ca", "ourcommons.ca"],
    isDpohSource: true,
  },
  {
    name: "Senate of Canada",
    acronym: null,
    // sen.parl.gc.ca: Senate email; sencanada.ca: public-facing staff addresses
    domains: ["sen.parl.gc.ca", "sencanada.ca"],
    isDpohSource: true,
  },

  // ── 6. Oversight ─────────────────────────────────────────────────────────────

  {
    name: "Office of the Commissioner of Lobbying",
    acronym: "OCL",
    domains: ["ocl-cal.gc.ca"],
    isDpohSource: true,
  },
];

async function main() {
  console.log(`\nSeeding ${FEDERAL_INSTITUTIONS.length} federal institutions...\n`);

  let created = 0;
  let updated = 0;

  for (const inst of FEDERAL_INSTITUTIONS) {
    const existing = await db.institutionRegistry.findUnique({
      where: { name: inst.name },
    });

    await db.institutionRegistry.upsert({
      where: { name: inst.name },
      update: {
        acronym: inst.acronym,
        domains: inst.domains,
        isDpohSource: inst.isDpohSource,
      },
      create: {
        name: inst.name,
        acronym: inst.acronym,
        jurisdiction: "federal",
        domains: inst.domains,
        isDpohSource: inst.isDpohSource,
      },
    });

    const action = existing ? "updated" : "created";
    const dpohTag = inst.isDpohSource ? "[DPOH]" : "      ";
    const acronym = inst.acronym ? `(${inst.acronym})` : "      ";
    console.log(`  ${action === "created" ? "+" : "~"} ${dpohTag} ${acronym.padEnd(8)} ${inst.name}`);

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  const total = await db.institutionRegistry.count({
    where: { jurisdiction: "federal" },
  });

  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  Created: ${created}  Updated: ${updated}  Total federal rows: ${total}`);
  console.log(`──────────────────────────────────────────────────────────────────\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
