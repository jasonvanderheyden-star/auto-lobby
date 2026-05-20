// OCL canonical subject matter codes — numeric IDs match the LRS filing form.
// Source: Office of the Commissioner of Lobbying open data.
// Note: there is no code 12 in the OCL list.

export type OclSubjectItem = {
  id: string; // readable slug for internal UI use
  name: string; // display name (matches OCL where possible)
  oclCode: number; // canonical numeric code sent to LRS
  related?: string[]; // slug IDs of related subjects (for UX hints)
};

export type OclSubjectGroup = {
  name: string;
  hint?: string;
  items: OclSubjectItem[];
};

export const SUBJECT_GROUPS: OclSubjectGroup[] = [
  {
    name: "Climate, Energy & Environment",
    hint: "Most relevant for Deep Sky",
    items: [
      { id: "climate",          name: "Climate",         oclCode: 41, related: ["environment", "energy", "taxation"] },
      { id: "environment",      name: "Environment",     oclCode: 13, related: ["climate", "science-tech"] },
      { id: "energy",           name: "Energy",          oclCode: 11, related: ["climate", "mining", "industry"] },
      { id: "mining",           name: "Mining",          oclCode: 28, related: ["energy", "environment"] },
      { id: "forestry",         name: "Forestry",        oclCode: 16, related: ["environment", "climate"] },
      { id: "fisheries",        name: "Fisheries",       oclCode: 15, related: ["environment"] },
      { id: "natural-resources", name: "Natural Resources", oclCode: 53 },
    ],
  },
  {
    name: "Economy & Finance",
    items: [
      { id: "taxation",             name: "Taxation and Finance",  oclCode: 33, related: ["budget", "industry"] },
      { id: "budget",               name: "Budget",                oclCode: 36, related: ["taxation", "economic-development"] },
      { id: "economic-development", name: "Economic Development",  oclCode: 45, related: ["industry", "small-business"] },
      { id: "small-business",       name: "Small Business",        oclCode: 31, related: ["economic-development", "taxation"] },
      { id: "financial-institutions", name: "Financial Institutions", oclCode: 14 },
      { id: "pensions",             name: "Pensions",              oclCode: 38 },
    ],
  },
  {
    name: "Industry & Innovation",
    items: [
      { id: "industry",             name: "Industry",                  oclCode: 20, related: ["economic-development", "science-tech"] },
      { id: "science-tech",         name: "Science and Technology",    oclCode: 30, related: ["climate", "r-and-d"] },
      { id: "r-and-d",              name: "Research and Development",  oclCode: 40, related: ["science-tech", "industry"] },
      { id: "intellectual-property", name: "Intellectual Property",    oclCode: 22 },
      { id: "infrastructure",       name: "Infrastructure",            oclCode: 21, related: ["transportation", "energy"] },
      { id: "telecommunications",   name: "Telecommunications",        oclCode: 1 },
    ],
  },
  {
    name: "Trade & International",
    items: [
      { id: "international-trade",        name: "International Trade",       oclCode: 25, related: ["industry", "internal-trade"] },
      { id: "international-relations",    name: "International Relations",   oclCode: 24 },
      { id: "internal-trade",             name: "Internal Trade",            oclCode: 23 },
      { id: "defence",                    name: "Defence",                   oclCode: 8 },
      { id: "national-security",          name: "National Security",         oclCode: 39 },
      { id: "immigration",                name: "Immigration",               oclCode: 19 },
      { id: "international-development",  name: "International Development", oclCode: 37 },
      { id: "foreign-affairs",            name: "Foreign Affairs",           oclCode: 54 },
    ],
  },
  {
    name: "Health, Labour & Social",
    items: [
      { id: "health",          name: "Health",                   oclCode: 18 },
      { id: "labour",          name: "Labour",                   oclCode: 27, related: ["employment"] },
      { id: "employment",      name: "Employment and Training",  oclCode: 10, related: ["labour"] },
      { id: "education",       name: "Education",                oclCode: 9 },
      { id: "housing",         name: "Housing",                  oclCode: 44 },
      { id: "consumer-issues", name: "Consumer Issues",          oclCode: 7 },
      { id: "child-services",  name: "Child Services",           oclCode: 50 },
    ],
  },
  {
    name: "Government, Law & Regions",
    items: [
      { id: "government-procurement",   name: "Government Procurement",           oclCode: 17 },
      { id: "justice",                  name: "Justice and Law Enforcement",       oclCode: 26 },
      { id: "privacy",                  name: "Privacy and Access to Information", oclCode: 43 },
      { id: "regional-development",     name: "Regional Development",             oclCode: 29 },
      { id: "municipalities",           name: "Municipalities",                    oclCode: 46 },
      { id: "indigenous",               name: "Aboriginal Affairs",                oclCode: 2,  related: ["regional-development"] },
      { id: "constitutional-issues",    name: "Constitutional Issues",             oclCode: 6 },
      { id: "bilingualism",             name: "Bilingualism/Official Languages",   oclCode: 42 },
      { id: "elections",                name: "Elections",                         oclCode: 48 },
      { id: "federal-provincial",       name: "Federal-Provincial Relations",      oclCode: 51 },
    ],
  },
  {
    name: "Culture, Media & Other",
    items: [
      { id: "arts-culture",   name: "Arts and Culture",  oclCode: 4 },
      { id: "broadcasting",   name: "Broadcasting",      oclCode: 5,  related: ["telecommunications"] },
      { id: "media",          name: "Media",             oclCode: 52 },
      { id: "sports",         name: "Sports",            oclCode: 32 },
      { id: "tourism",        name: "Tourism",           oclCode: 34 },
      { id: "religion",       name: "Religion",          oclCode: 47 },
      { id: "agriculture",    name: "Agriculture",       oclCode: 3 },
      { id: "transportation", name: "Transportation",    oclCode: 35, related: ["infrastructure"] },
      { id: "animal-welfare", name: "Animal Welfare",    oclCode: 49 },
    ],
  },
];

export const ALL_SUBJECTS = SUBJECT_GROUPS.flatMap((g) =>
  g.items.map((it) => ({ ...it, group: g.name })),
);

export const SUBJECT_BY_ID: Record<string, OclSubjectItem & { group: string }> = Object.fromEntries(
  ALL_SUBJECTS.map((it) => [it.id, it]),
);

export const SUBJECT_BY_OCL_CODE: Record<number, OclSubjectItem & { group: string }> = Object.fromEntries(
  ALL_SUBJECTS.map((it) => [it.oclCode, it]),
);

export function getSubjectName(oclCode: number): string {
  if (!oclCode || isNaN(oclCode)) return "Unknown subject";
  return SUBJECT_BY_OCL_CODE[oclCode]?.name ?? `Subject ${oclCode}`;
}

// Deep Sky org defaults — OCL codes for Environment, Climate, Energy, Science and Technology, Industry
export const DEFAULT_OCL_CODES: number[] = [13, 41, 11, 30, 20];

// Subjects on Deep Sky's active registration — used for the compliance note in the picker
export const ON_REGISTRATION_IDS = new Set(["environment", "energy", "science-tech", "industry"]);

// Suggested starting points for Deep Sky meetings (slugs, for picker UX)
export const SUGGESTED_IDS = ["environment", "climate", "energy", "science-tech", "taxation"];
