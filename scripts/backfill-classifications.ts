import { db } from "../src/lib/db";
import { classifyRawEvent } from "../src/server/classifier/classify-raw-event";
import { buildResolverContext } from "../src/server/dpoh-registry/resolve-attendee";

async function main() {
  const start = Date.now();

  const allEvents = await db.rawCalendarEvent.findMany({
    select: { id: true, tenantId: true },
    orderBy: { startsAt: "desc" },
  });
  const alreadyClassified = await db.detectedMeeting.findMany({
    select: { rawEventId: true },
  });
  const classifiedSet = new Set(alreadyClassified.map((c) => c.rawEventId));
  const remaining = allEvents.filter((e) => !classifiedSet.has(e.id));

  console.log(`\nClassifier backfill (optimized)`);
  console.log(`  Total raw events:   ${allEvents.length}`);
  console.log(`  Already classified: ${classifiedSet.size}`);
  console.log(`  Remaining to do:    ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log("Nothing to do.");
    await db.$disconnect();
    return;
  }

  // Group by tenant — context cached once per tenant
  const byTenant = new Map<string, typeof remaining>();
  for (const e of remaining) {
    if (!byTenant.has(e.tenantId)) byTenant.set(e.tenantId, []);
    byTenant.get(e.tenantId)!.push(e);
  }

  let processed = 0;
  let errors = 0;
  const verdictCounts: Record<string, number> = {
    lobbying: 0,
    "not-lobbying": 0,
    "needs-info": 0,
  };

  for (const [tenantId, events] of byTenant) {
    console.log(`Tenant ${tenantId}: ${events.length} events`);
    const ctx = await buildResolverContext(tenantId);

    for (const e of events) {
      try {
        const result = await classifyRawEvent(e.id, ctx);
        verdictCounts[result.verdict] = (verdictCounts[result.verdict] ?? 0) + 1;
      } catch (err) {
        errors++;
        console.error(`  [ERR] ${e.id}: ${(err as Error).message}`);
      }
      processed++;
      if (processed % 100 === 0 || processed === remaining.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(
          `  ${processed}/${remaining.length} (${elapsed}s)  ` +
            `lobbying=${verdictCounts.lobbying} ` +
            `not-lobbying=${verdictCounts["not-lobbying"]} ` +
            `needs-info=${verdictCounts["needs-info"]} ` +
            `errors=${errors}`,
        );
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  Backfill complete. ${processed} processed in ${elapsed}s`);
  console.log(`    lobbying:     ${verdictCounts.lobbying}`);
  console.log(`    not-lobbying: ${verdictCounts["not-lobbying"]}`);
  console.log(`    needs-info:   ${verdictCounts["needs-info"]}`);
  console.log(`    errors:       ${errors}`);
  console.log(`──────────────────────────────────────────────────────────────────\n`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
