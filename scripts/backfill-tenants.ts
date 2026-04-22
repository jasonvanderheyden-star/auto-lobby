/**
 * scripts/backfill-tenants.ts
 *
 * One-off: sync every Clerk Organization in this app to the Tenant table.
 * Safe to re-run — upserts are keyed on clerkOrgId.
 *
 * Usage:
 *   npm run tenants:backfill
 */

import { createClerkClient } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";

// env.ts validates CLERK_SECRET_KEY starts with "sk_" — guaranteed non-undefined here.
const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set — run via: npm run tenants:backfill");

const clerk = createClerkClient({ secretKey });
const db = new PrismaClient();

async function main() {
  console.log("=== Tenant backfill ===\n");

  // Fetch all orgs (paginated; limit 100 covers any realistic early-stage count)
  const { data: orgs, totalCount } = await clerk.organizations.getOrganizationList({
    limit: 100,
  });

  console.log(`Found ${totalCount} Clerk organization(s)\n`);

  let created = 0;
  let updated = 0;

  for (const org of orgs) {
    const existing = await db.tenant.findUnique({ where: { clerkOrgId: org.id } });

    await db.tenant.upsert({
      where: { clerkOrgId: org.id },
      update: { name: org.name },
      create: {
        clerkOrgId: org.id,
        name: org.name,
        jurisdiction: "federal",
      },
    });

    if (existing) {
      console.log(`  updated  ${org.id}  "${org.name}"`);
      updated++;
    } else {
      console.log(`  created  ${org.id}  "${org.name}"`);
      created++;
    }
  }

  const totalTenants = await db.tenant.count();

  console.log(`\nDone — ${created} created, ${updated} updated`);
  console.log(`Tenant table: ${totalTenants} total row(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
