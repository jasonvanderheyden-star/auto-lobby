/**
 * scripts/seed-qa-pilot.ts
 *
 * Seeds the two-use-case QA scenario for the pilot walkthrough:
 *
 *  Use case 1 (in-house): the existing Deep Sky tenant — untouched here.
 *  Use case 2 (firm/agency): "Maple Leaf Strategies", a demo GR firm with
 *    - its own filing tenant (isAgencyOwnTenant) where consultant calendars live
 *    - one managed client tenant ("NorthVolt Battery Co.") for routed certification
 *    - two consultant engagements (NorthVolt + Prairie Hydrogen) for attribution
 *    - synthetic calendar events run through the REAL classifier pipeline
 *
 * Idempotency: deterministic IDs + upserts (NOT the TRUNCATE pattern — this
 * script touches shared tenant tables and must never wipe Deep Sky). Re-running
 * lands the DB at the same state. DB size is logged start + end per CLAUDE.md.
 *
 * Env (optional, for browser QA):
 *   SEED_CLERK_USER_ID   your Clerk user id — attached to the firm's
 *                        AgencyMember rows so you can play firm personas
 *   QA_FIRM_ORG_ID       Clerk org id to bind to the firm's own tenant
 *   QA_CLIENT_ORG_ID     Clerk org id to bind to the NorthVolt client tenant
 *
 * Run:  npx dotenv-cli -e .env.local -- npx tsx scripts/seed-qa-pilot.ts
 */

import { PrismaClient } from "@prisma/client";
import { buildResolverContext } from "../src/server/dpoh-registry/resolve-attendee";
import { classifyRawEvent } from "../src/server/classifier/classify-raw-event";
import { generateDraftMcr } from "../src/server/filing-engine/generate-draft-mcr";
import { suggestEngagementsForTenant } from "../src/server/engagements/suggest-engagement";

const db = new PrismaClient();

// Deterministic IDs — safe to upsert on re-run.
const IDS = {
  agency: "qa-agency-mapleleaf",
  firmTenant: "qa-tenant-mapleleaf-own",
  clientTenant: "qa-tenant-northvolt",
  memberAdmin: "qa-am-firm-admin",
  memberConsultant: "qa-am-consultant",
  engNorthvolt: "qa-eng-northvolt",
  engPrairie: "qa-eng-prairie",
  connFirm: "qa-conn-firm",
  connClient: "qa-conn-client",
} as const;

const CONSULTANT_EMAIL = "marie.tremblay@mapleleafstrategies.ca";

async function logDbSize(label: string) {
  const rows = await db.$queryRaw<{ size: bigint }[]>`
    SELECT pg_database_size(current_database()) AS size`;
  const mb = Number(rows[0]?.size ?? 0) / 1024 / 1024;
  console.log(`[${label}] Current DB size: ${mb.toFixed(1)} MB`);
}

/** Pick real DPOHs from the registry so the classifier resolves them by name. */
async function pickRealDpohs() {
  const officials = await db.publicOfficial.findMany({
    where: {
      isDpoh: true,
      resolvedFrom: { in: ["manual-ministers", "parliament", "geds"] },
      institution: { domains: { isEmpty: false } },
    },
    include: { institution: { select: { id: true, name: true, domains: true } } },
    take: 4,
    orderBy: { confidence: "desc" },
  });
  if (officials.length < 2) {
    throw new Error(
      "Registry has <2 high-confidence DPOHs with institution domains — run the Phase 2 seeds first",
    );
  }
  return officials.map((o) => {
    const domain = o.institution.domains[0]!;
    const local = o.name.toLowerCase().replace(/[^a-z ]/g, "").trim().replace(/ +/g, ".");
    return { name: o.name, email: `${local}@${domain}`, institution: o.institution.name };
  });
}

type SyntheticEvent = {
  externalId: string;
  title: string;
  daysAgo: number;
  attendees: { email: string; displayName: string }[];
};

function buildEvents(dpohs: Awaited<ReturnType<typeof pickRealDpohs>>): {
  firm: SyntheticEvent[];
  client: SyntheticEvent[];
} {
  const [d1, d2, d3] = [dpohs[0]!, dpohs[1]!, dpohs[2] ?? dpohs[0]!];
  return {
    // Firm-own tenant: consultant meetings for two different clients + noise
    firm: [
      {
        externalId: "qa-f1",
        title: "NorthVolt — battery supply chain incentives discussion",
        daysAgo: 12,
        attendees: [
          { email: CONSULTANT_EMAIL, displayName: "Marie Tremblay" },
          { email: "ceo@northvolt-batteries.ca", displayName: "Erik Anders" },
          { email: d1.email, displayName: d1.name },
        ],
      },
      {
        externalId: "qa-f2",
        title: "Prairie Hydrogen — clean fuel regulations follow-up",
        daysAgo: 9,
        attendees: [
          { email: CONSULTANT_EMAIL, displayName: "Marie Tremblay" },
          { email: "policy@prairieh2.ca", displayName: "Dana Whitecap" },
          { email: d2.email, displayName: d2.name },
        ],
      },
      {
        externalId: "qa-f3",
        title: "Internal: weekly pipeline review",
        daysAgo: 7,
        attendees: [
          { email: CONSULTANT_EMAIL, displayName: "Marie Tremblay" },
          { email: "ops@mapleleafstrategies.ca", displayName: "Firm Ops" },
        ],
      },
      {
        externalId: "qa-f4",
        title: "Coffee with ministry contact", // ambiguous: no client domain, no keyword
        daysAgo: 5,
        attendees: [
          { email: CONSULTANT_EMAIL, displayName: "Marie Tremblay" },
          { email: d3.email, displayName: d3.name },
        ],
      },
    ],
    // Managed client tenant: in-house style meetings, certification to be routed
    client: [
      {
        externalId: "qa-c1",
        title: "NorthVolt — critical minerals strategy meeting",
        daysAgo: 11,
        attendees: [
          { email: "ceo@northvolt-batteries.ca", displayName: "Erik Anders" },
          { email: d2.email, displayName: d2.name },
        ],
      },
      {
        externalId: "qa-c2",
        title: "Board prep (internal)",
        daysAgo: 4,
        attendees: [
          { email: "ceo@northvolt-batteries.ca", displayName: "Erik Anders" },
          { email: "cfo@northvolt-batteries.ca", displayName: "Ines Olsson" },
        ],
      },
    ],
  };
}

async function main() {
  await logDbSize("Step 0");
  const seedClerkUserId = process.env.SEED_CLERK_USER_ID ?? "user_qa_placeholder";
  // Two AgencyMembers in one agency can't share a clerkUserId (@@unique [agencyId, clerkUserId]).
  // Bind the real Clerk login to the consultant (the QA-driven persona); the firm admin
  // gets a distinct, deterministic placeholder unless explicitly overridden.
  const consultantClerkUserId =
    process.env.SEED_CONSULTANT_CLERK_USER_ID ?? seedClerkUserId;
  const adminClerkUserId =
    process.env.SEED_FIRM_ADMIN_CLERK_USER_ID ??
    (consultantClerkUserId === "user_qa_placeholder"
      ? "user_qa_firm_admin"
      : `${consultantClerkUserId}-firm-admin`);

  await db.$transaction(
    async (tx) => {
      // ── Agency + tenants ────────────────────────────────────────────────
      await tx.agency.upsert({
        where: { id: IDS.agency },
        create: {
          id: IDS.agency,
          name: "Maple Leaf Strategies",
          productName: "MLS Compliance Portal",
          brandColor: "#1d4ed8",
          supportEmail: "compliance@mapleleafstrategies.ca",
        },
        update: {},
      });

      await tx.tenant.upsert({
        where: { id: IDS.firmTenant },
        create: {
          id: IDS.firmTenant,
          name: "Maple Leaf Strategies (own filing)",
          industry: "Government relations",
          agencyId: IDS.agency,
          isAgencyOwnTenant: true,
          ...(process.env.QA_FIRM_ORG_ID ? { clerkOrgId: process.env.QA_FIRM_ORG_ID } : {}),
        },
        update: process.env.QA_FIRM_ORG_ID ? { clerkOrgId: process.env.QA_FIRM_ORG_ID } : {},
      });

      await tx.tenant.upsert({
        where: { id: IDS.clientTenant },
        create: {
          id: IDS.clientTenant,
          name: "NorthVolt Battery Co.",
          industry: "Advanced manufacturing",
          agencyId: IDS.agency,
          ...(process.env.QA_CLIENT_ORG_ID ? { clerkOrgId: process.env.QA_CLIENT_ORG_ID } : {}),
        },
        update: process.env.QA_CLIENT_ORG_ID ? { clerkOrgId: process.env.QA_CLIENT_ORG_ID } : {},
      });

      // ── Entitlements (revenue gate) ─────────────────────────────────────
      // Both QA tenants are entitled to Auto Lobby so the demo passes the gate.
      for (const tenantId of [IDS.firmTenant, IDS.clientTenant]) {
        await tx.tenantEntitlement.upsert({
          where: {
            tenantId_product: { tenantId, product: "lobbying_compliance" },
          },
          create: {
            tenantId,
            product: "lobbying_compliance",
            status: "active",
            source: "seed",
            plan: "agency",
          },
          update: { status: "active", source: "seed", plan: "agency" },
        });
      }

      // ── Firm members ────────────────────────────────────────────────────
      await tx.agencyMember.upsert({
        where: { id: IDS.memberAdmin },
        create: {
          id: IDS.memberAdmin,
          agencyId: IDS.agency,
          clerkUserId: adminClerkUserId,
          email: "admin@mapleleafstrategies.ca",
          name: "Firm Admin",
          role: "admin",
        },
        update: { clerkUserId: adminClerkUserId },
      });
      await tx.agencyMember.upsert({
        where: { id: IDS.memberConsultant },
        create: {
          id: IDS.memberConsultant,
          agencyId: IDS.agency,
          clerkUserId: consultantClerkUserId,
          email: CONSULTANT_EMAIL,
          name: "Marie Tremblay",
          role: "consultant",
        },
        update: { clerkUserId: consultantClerkUserId },
      });

      // Client RO as a TenantMember (claimed by email at first sign-in)
      await tx.tenantMember.upsert({
        where: { tenantId_email: { tenantId: IDS.clientTenant, email: "ceo@northvolt-batteries.ca" } },
        create: {
          tenantId: IDS.clientTenant,
          email: "ceo@northvolt-batteries.ca",
          name: "Erik Anders",
          roles: ["admin", "contributor", "certifier"],
        },
        update: {},
      });

      // ── Engagements (consultant undertakings) ───────────────────────────
      await tx.engagement.upsert({
        where: { id: IDS.engNorthvolt },
        create: {
          id: IDS.engNorthvolt,
          agencyId: IDS.agency,
          consultantMemberId: IDS.memberConsultant,
          clientName: "NorthVolt Battery Co.",
          clientTenantId: IDS.clientTenant,
          registrationNum: "QA-REG-001",
          clientDomains: ["northvolt-batteries.ca"],
          subjectKeywords: ["northvolt", "battery", "critical minerals"],
          subjects: ["Industry", "Energy"],
        },
        update: {},
      });
      await tx.engagement.upsert({
        where: { id: IDS.engPrairie },
        create: {
          id: IDS.engPrairie,
          agencyId: IDS.agency,
          consultantMemberId: IDS.memberConsultant,
          clientName: "Prairie Hydrogen Inc.",
          registrationNum: "QA-REG-002",
          clientDomains: ["prairieh2.ca"],
          subjectKeywords: ["hydrogen", "clean fuel"],
          subjects: ["Energy", "Environment"],
        },
        update: {},
      });

      // ── Disconnected calendar connections to hang raw events off ────────
      for (const [connId, tenantId, email] of [
        [IDS.connFirm, IDS.firmTenant, CONSULTANT_EMAIL],
        [IDS.connClient, IDS.clientTenant, "ceo@northvolt-batteries.ca"],
      ] as const) {
        await tx.calendarConnection.upsert({
          where: { id: connId },
          create: {
            id: connId,
            tenantId,
            connectedByUserId: seedClerkUserId,
            provider: "google",
            externalAccountId: `qa-${connId}`,
            email,
            accessTokenEncrypted: "qa-not-a-real-token",
            refreshTokenEncrypted: "qa-not-a-real-token",
            accessTokenExpiresAt: new Date(0),
            scopes: [],
            status: "disconnected", // never picked up by the sync worker
            statusReason: "qa-seed",
          },
          update: {},
        });
      }
    },
    { timeout: 300_000, maxWait: 10_000 },
  );

  // ── Synthetic events through the REAL pipeline ────────────────────────────
  const dpohs = await pickRealDpohs();
  const events = buildEvents(dpohs);
  console.log(`[Events] Using registry DPOHs: ${dpohs.map((d) => d.name).join("; ")}`);

  for (const [connId, tenantId, list] of [
    [IDS.connFirm, IDS.firmTenant, events.firm],
    [IDS.connClient, IDS.clientTenant, events.client],
  ] as const) {
    for (const ev of list) {
      const startsAt = new Date(Date.now() - ev.daysAgo * 86_400_000);
      const raw = await db.rawCalendarEvent.upsert({
        where: { connectionId_externalId: { connectionId: connId, externalId: ev.externalId } },
        create: {
          tenantId,
          connectionId: connId,
          externalId: ev.externalId,
          title: ev.title,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          organizerEmail: ev.attendees[0]!.email,
          attendees: ev.attendees.map((a) => ({ ...a, responseStatus: "accepted" })),
          eventStatus: "confirmed",
          rawPayload: { qaSeed: true },
        },
        update: {},
      });
      const resolverCtx = await buildResolverContext(tenantId);
      await classifyRawEvent(raw.id, resolverCtx);
      const dm = await db.detectedMeeting.findUnique({ where: { rawEventId: raw.id } });
      if (dm && (dm.classification === "lobbying" || dm.classification === "needs-info")) {
        await generateDraftMcr(dm.id);
      }
    }
  }

  // Attribution pass for the firm-own tenant
  const suggested = await suggestEngagementsForTenant(IDS.firmTenant);
  console.log(`[Attribution] suggestions written: ${JSON.stringify(suggested)}`);

  console.log("[Done] QA pilot scenario seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await logDbSize("Final");
    await db.$disconnect();
  });
