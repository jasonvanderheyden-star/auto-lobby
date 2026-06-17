/**
 * scripts/backfill-entitlements.ts
 *
 * Grandfather every EXISTING tenant into an active Auto Lobby
 * (lobbying_compliance) entitlement so the revenue gate (chunk 5d-1) does not
 * lock out tenants that pre-date the entitlement table — notably Deep Sky and
 * the QA pilot tenants.
 *
 * Safe to re-run: upserts are keyed on the [tenantId, product] unique. It only
 * CREATES missing rows; it never downgrades a tenant that already has an
 * explicit entitlement (e.g. canceled), so re-running won't resurrect access.
 *
 * Usage:
 *   pnpm dotenv -e .env.local -- tsx scripts/backfill-entitlements.ts
 *   (or: npm run entitlements:backfill)
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("=== Entitlement backfill (lobbying_compliance) ===\n");

  const tenants = await db.tenant.findMany({ select: { id: true, name: true } });
  console.log(`Found ${tenants.length} tenant(s)\n`);

  let created = 0;
  let skipped = 0;

  for (const t of tenants) {
    const existing = await db.tenantEntitlement.findUnique({
      where: {
        tenantId_product: {
          tenantId: t.id,
          product: "lobbying_compliance",
        },
      },
      select: { id: true, status: true },
    });

    if (existing) {
      console.log(
        `  • ${t.name} — already has an entitlement (${existing.status}); leaving as-is`,
      );
      skipped += 1;
      continue;
    }

    await db.tenantEntitlement.create({
      data: {
        tenantId: t.id,
        product: "lobbying_compliance",
        status: "active",
        source: "seed",
        notes: "Grandfathered by backfill-entitlements.ts",
      },
    });
    console.log(`  ✓ ${t.name} — granted active lobbying_compliance`);
    created += 1;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
