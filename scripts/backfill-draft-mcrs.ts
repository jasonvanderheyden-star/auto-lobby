import { db } from "../src/lib/db";
import { generateDraftMcr } from "../src/server/filing-engine/generate-draft-mcr";

async function main() {
  const start = Date.now();

  const meetings = await db.detectedMeeting.findMany({
    where: { classification: { in: ["lobbying", "needs-info"] } },
    select: { id: true, classification: true },
    orderBy: { startAt: "desc" },
  });

  console.log(`\nDraftMcr backfill — ${meetings.length} meetings to process`);
  console.log(`  lobbying:    ${meetings.filter((m) => m.classification === "lobbying").length}`);
  console.log(`  needs-info:  ${meetings.filter((m) => m.classification === "needs-info").length}\n`);

  let processed = 0;
  let errors = 0;
  for (const m of meetings) {
    try {
      await generateDraftMcr(m.id);
    } catch (err) {
      errors++;
      console.error(`  [ERR] ${m.id}: ${(err as Error).message}`);
    }
    processed++;
    if (processed % 10 === 0 || processed === meetings.length) {
      console.log(`  ${processed}/${meetings.length} (errors: ${errors})`);
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`  DraftMcr backfill complete: ${processed} in ${elapsed}s, errors: ${errors}`);
  console.log(`──────────────────────────────────────────────────────────────────\n`);

  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
