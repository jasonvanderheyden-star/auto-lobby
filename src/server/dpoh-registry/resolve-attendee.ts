import { db } from "@/lib/db";
import {
  lookupOfficialByEmail,
  lookupOfficialByNameAtInstitution,
  type PublicOfficialLite,
} from "./lookup-official";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AttendeeInput {
  email: string | null;
  displayName: string | null;
}

export type ResolutionSignal =
  | "internal"
  | "external-non-gov"
  | "gov-with-named-dpoh"
  | "gov-with-named-non-dpoh"
  | "gov-attendee-unknown-role"
  | "gov-not-dpoh-source"
  | "gov-unresolved";

export type DpohMatchSource =
  | "email-exact"
  | "name-exact-at-institution"
  | "name-fuzzy-at-institution"
  | "institution-domain-fallback";

export interface AttendeeResolution {
  email: string | null;
  displayName: string | null;
  isInternal: boolean;

  institutionId: string | null;
  institutionName: string | null;
  institutionAcronym: string | null;

  resolvedOfficialId: string | null;
  resolvedOfficialName: string | null;
  resolvedOfficialRole: string | null;
  isDpoh: boolean | null;
  dpohBasis: string | null;
  dpohRuleRef: string | null;
  dpohMatchedBy: DpohMatchSource | null;

  confidence: number;
  signal: ResolutionSignal;
}

interface InstitutionWithDomains {
  id: string;
  name: string;
  acronym: string | null;
  domains: string[];
  isDpohSource: boolean;
}

export interface ResolverContext {
  internalDomains: Set<string>;
  institutionsByDomain: Map<string, InstitutionWithDomains>;
  lookupOfficialByEmail: (email: string) => Promise<PublicOfficialLite | null>;
  lookupOfficialByNameAtInstitution: (
    name: string,
    institutionId: string,
  ) => Promise<{ official: PublicOfficialLite; fuzzy: boolean } | null>;
}

// ── Pure resolver (testable with mocked context) ─────────────────────────────

export async function resolveAttendee(
  attendee: AttendeeInput,
  ctx: ResolverContext,
): Promise<AttendeeResolution> {
  const email = attendee.email?.toLowerCase().trim() || null;
  const displayName = attendee.displayName?.trim() || null;
  const domain = email ? extractDomain(email) : null;

  // 1. Internal?
  if (domain && ctx.internalDomains.has(domain)) {
    return blank({ email, displayName, isInternal: true, signal: "internal", confidence: 0.95 });
  }

  // 2. Institution lookup by domain
  const inst = domain ? ctx.institutionsByDomain.get(domain) : undefined;

  if (!inst) {
    return blank({ email, displayName, isInternal: false, signal: "external-non-gov", confidence: 0.9 });
  }

  // Special case: canada.ca shared domain → unresolved gov
  if (inst.acronym === "GOC") {
    return {
      email,
      displayName,
      isInternal: false,
      institutionId: inst.id,
      institutionName: inst.name,
      institutionAcronym: inst.acronym,
      resolvedOfficialId: null,
      resolvedOfficialName: null,
      resolvedOfficialRole: null,
      isDpoh: null,
      dpohBasis: null,
      dpohRuleRef: null,
      dpohMatchedBy: null,
      confidence: 0.4,
      signal: "gov-unresolved",
    };
  }

  // 3. Try PublicOfficial match — email first, then name at institution
  let official: PublicOfficialLite | null = null;
  let matchedBy: DpohMatchSource | null = null;

  if (email) {
    official = await ctx.lookupOfficialByEmail(email);
    if (official) matchedBy = "email-exact";
  }
  if (!official && displayName) {
    const result = await ctx.lookupOfficialByNameAtInstitution(displayName, inst.id);
    if (result) {
      official = result.official;
      matchedBy = result.fuzzy ? "name-fuzzy-at-institution" : "name-exact-at-institution";
    }
  }

  if (official) {
    return {
      email,
      displayName,
      isInternal: false,
      institutionId: inst.id,
      institutionName: inst.name,
      institutionAcronym: inst.acronym,
      resolvedOfficialId: official.id,
      resolvedOfficialName: official.name,
      resolvedOfficialRole: official.role,
      isDpoh: official.isDpoh,
      dpohBasis: official.dpohBasis,
      dpohRuleRef: official.ruleRef,
      dpohMatchedBy: matchedBy,
      confidence: official.confidence,
      signal: official.isDpoh ? "gov-with-named-dpoh" : "gov-with-named-non-dpoh",
    };
  }

  // 4. Institution-level: attendee is at a federal institution but not a known DPOH.
  //    Per CLAUDE.md non-negotiable #5 (anti-over-reporting bias): "Domain match ≠ DPOH".
  //    Most federal employees are NOT DPOHs — only those holding designated positions
  //    (Cabinet, MPs, Senators, DMs, ADMs, etc.) are. We do not have evidence this
  //    person holds a designated role, so we mark unknown and surface for human review.
  if (inst.isDpohSource) {
    return {
      email,
      displayName,
      isInternal: false,
      institutionId: inst.id,
      institutionName: inst.name,
      institutionAcronym: inst.acronym,
      resolvedOfficialId: null,
      resolvedOfficialName: null,
      resolvedOfficialRole: null,
      isDpoh: null,
      dpohBasis: null,
      dpohRuleRef: null,
      dpohMatchedBy: "institution-domain-fallback",
      confidence: 0.3,
      signal: "gov-attendee-unknown-role",
    };
  }

  return {
    email,
    displayName,
    isInternal: false,
    institutionId: inst.id,
    institutionName: inst.name,
    institutionAcronym: inst.acronym,
    resolvedOfficialId: null,
    resolvedOfficialName: null,
    resolvedOfficialRole: null,
    isDpoh: false,
    dpohBasis: null,
    dpohRuleRef: null,
    dpohMatchedBy: null,
    confidence: 0.7,
    signal: "gov-not-dpoh-source",
  };
}

// ── Convenience wrapper that builds context from the DB ──────────────────────

export async function buildResolverContext(tenantId: string): Promise<ResolverContext> {
  const calConns = await db.calendarConnection.findMany({
    where: { tenantId },
    select: { email: true },
  });
  const internalDomains = new Set<string>();
  for (const c of calConns) {
    const domain = extractDomain(c.email);
    if (domain) internalDomains.add(domain);
  }

  const institutions = await db.institutionRegistry.findMany({
    select: { id: true, name: true, acronym: true, domains: true, isDpohSource: true },
  });
  const institutionsByDomain = new Map<string, InstitutionWithDomains>();
  for (const inst of institutions) {
    for (const d of inst.domains) {
      institutionsByDomain.set(d.toLowerCase(), inst);
    }
  }

  return {
    internalDomains,
    institutionsByDomain,
    lookupOfficialByEmail,
    lookupOfficialByNameAtInstitution,
  };
}

export async function resolveAttendees(
  tenantId: string,
  attendees: AttendeeInput[],
): Promise<AttendeeResolution[]> {
  const ctx = await buildResolverContext(tenantId);
  const results: AttendeeResolution[] = [];
  for (const att of attendees) {
    results.push(await resolveAttendee(att, ctx));
  }
  return results;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

function blank(args: {
  email: string | null;
  displayName: string | null;
  isInternal: boolean;
  signal: ResolutionSignal;
  confidence: number;
}): AttendeeResolution {
  return {
    email: args.email,
    displayName: args.displayName,
    isInternal: args.isInternal,
    institutionId: null,
    institutionName: null,
    institutionAcronym: null,
    resolvedOfficialId: null,
    resolvedOfficialName: null,
    resolvedOfficialRole: null,
    isDpoh: null,
    dpohBasis: null,
    dpohRuleRef: null,
    dpohMatchedBy: null,
    confidence: args.confidence,
    signal: args.signal,
  };
}
