/**
 * scripts/submit-to-lrs.ts
 *
 * LRS submission harness — Phase 4.
 *
 * Finds all certified-but-not-submitted DraftMcrs for a tenant, opens a headed
 * Playwright browser, walks the user through each MCR on lobbycanada.gc.ca, and
 * writes the communication number back to the DB on success.
 *
 * Usage:
 *   TENANT_ID=<id> npm run lrs:submit
 *
 * Or directly:
 *   TENANT_ID=<id> npx dotenv-cli -e .env.local -- npx tsx scripts/submit-to-lrs.ts
 *
 * Requirements:
 *   - TENANT_ID must be set in the environment (or .env.local)
 *   - Playwright Chromium must be installed: npx playwright install chromium
 *   - The LRS submitter (Jason) must be present at the computer — they will
 *     sign in to LRS and enter their credentials at the Certify modal for each MCR.
 *
 * Non-negotiables:
 *   - This script NEVER stores LRS credentials.
 *   - The headed browser is always visible — no headless mode.
 *   - The user must click the final Certify button themselves.
 */

import { PrismaClient } from "@prisma/client";
import { prepareSubmissions } from "../src/server/submission/prepare-submission";
import { submitBatchToLrs } from "../src/server/submission/lrs-playwright";

// Use a direct PrismaClient instance (not the cached singleton) so this script
// works outside the Next.js runtime environment.
const db = new PrismaClient();

async function main() {
  const tenantId = process.env["TENANT_ID"];
  if (!tenantId) {
    console.error(
      "[lrs-submit] ERROR: TENANT_ID env var is required.\n" +
        "  Set it in .env.local and run: npm run lrs:submit\n" +
        "  Or: TENANT_ID=<id> npx dotenv-cli -e .env.local -- npx tsx scripts/submit-to-lrs.ts",
    );
    process.exit(1);
  }

  // Verify tenant exists
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) {
    console.error(`[lrs-submit] ERROR: No tenant found with id "${tenantId}".`);
    process.exit(1);
  }
  console.log(`[lrs-submit] Tenant: ${tenant.name} (${tenant.id})`);

  const filingMonth = process.env["FILING_MONTH"];
  if (filingMonth) {
    if (!/^\d{4}-\d{2}$/.test(filingMonth)) {
      console.error(`[lrs-submit] ERROR: FILING_MONTH must be YYYY-MM format (got "${filingMonth}").`);
      process.exit(1);
    }
    console.log(`[lrs-submit] Filing month: ${filingMonth}`);
  } else {
    console.log("[lrs-submit] No FILING_MONTH set — submitting ALL certified, unsubmitted MCRs.");
  }

  // Optional consultant-undertaking filter (agency-own tenants): submit one
  // engagement's batch at a time. Only confirmed/manual attributions submit.
  const engagementId = process.env["ENGAGEMENT_ID"];
  if (engagementId) {
    console.log(`[lrs-submit] Engagement filter: ${engagementId}`);
  }

  // Log initial DB size
  const sizeBefore = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
  console.log(`[Step 0] DB size before: ${sizeBefore[0]!.size}`);

  // Build submission payloads
  console.log("[lrs-submit] Preparing submissions...");
  const payloads = await prepareSubmissions(tenantId, filingMonth, engagementId);

  if (payloads.length === 0) {
    console.log(
      "[lrs-submit] No certified, unsubmitted MCRs found for this tenant. Nothing to do.\n" +
        "  To certify MCRs, go to /filings in the web app and click Certify.",
    );
    await db.$disconnect();
    process.exit(0);
  }

  console.log(`\n[lrs-submit] ${payloads.length} MCR(s) ready for submission:\n`);
  payloads.forEach((p, i) => {
    const dpohNames = p.dpohs
      .map((d) => `${d.firstName} ${d.lastName}`.trim())
      .join(", ");
    console.log(`  ${i + 1}. ${p.communicationDate}  DPOHs: ${dpohNames || "(none resolved)"}`);
  });

  console.log(
    "\n[lrs-submit] Opening LRS in a headed browser window.\n" +
      "  You will need to:\n" +
      "    1. Sign in to LRS with your username and password.\n" +
      "    2. For each MCR, enter your credentials at the Certify modal and click Certify.\n" +
      "  The script will pause at each step and wait for you.\n",
  );

  // Run the Playwright automation
  const results = await submitBatchToLrs(payloads, (msg) => console.log(`[lrs] ${msg}`));

  // Write results back to the DB
  console.log("\n[lrs-submit] Writing results to database...");
  for (const result of results) {
    if (result.status === "submitted") {
      await db.draftMcr.update({
        where: { id: result.draftMcrId },
        data: {
          submittedAt: new Date(),
          lrsReceiptId: result.communicationNumber ?? null,
        },
      });

      await db.auditEvent.create({
        data: {
          tenantId,
          actor: "system",
          actorRole: "system",
          action: "batch-certified",
          subject: result.draftMcrId,
          payload: {
            communicationNumber: result.communicationNumber ?? null,
            submittedAt: new Date().toISOString(),
            source: "lrs-playwright",
          },
        },
      });

      console.log(
        `[lrs-submit] ✓ ${result.draftMcrId} → communication number: ${result.communicationNumber ?? "not captured"}`,
      );
    } else {
      console.error(
        `[lrs-submit] ✗ ${result.draftMcrId} failed: ${result.error ?? "unknown error"}`,
      );
    }
  }

  // Summary
  const submitted = results.filter((r) => r.status === "submitted").length;
  const failed = results.filter((r) => r.status === "failed").length;
  console.log(`\n[lrs-submit] Done. ${submitted} submitted, ${failed} failed.`);

  const sizeAfter = await db.$queryRaw<[{ size: string }]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size
  `;
  console.log(`[Final] DB size after: ${sizeAfter[0]!.size}`);

  await db.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[lrs-submit] Fatal error:", e);
  process.exit(1);
});
