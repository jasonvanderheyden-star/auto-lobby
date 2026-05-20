// Inngest scheduled function — weekly DPOH registry refresh.
// Runs Sundays at 2am ET (7am UTC). Order is load-bearing:
//   ministers must complete before exempt staff (exempt staff reads minister rows).
import { inngest } from "@/lib/inngest";
import { seedMinisters } from "./seed-ministers";
import { seedGeds } from "./seed-geds";
import { seedExemptStaff } from "./seed-exempt-staff";
import { seedParliament } from "./seed-parliament";

export const refreshDpohRegistry = inngest.createFunction(
  {
    id: "dpoh-registry-refresh",
    name: "DPOH registry weekly refresh",
    triggers: [{ cron: "0 7 * * 0" }],
  },
  async ({ step }) => {
    const ministersResult = await step.run("seed-ministers", async () => {
      try {
        const r = await seedMinisters();
        return { ok: true as const, ministersInserted: r.ministersInserted, parlSecsInserted: r.parlSecsInserted };
      } catch (e) {
        const error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error(`[registry-refresh] ministers: ${error}`);
        return { ok: false as const, error };
      }
    });

    const gedsResult = await step.run("seed-geds", async () => {
      try {
        const r = await seedGeds();
        return { ok: true as const, dmsInserted: r.dmsInserted, admsInserted: r.admsInserted, admError: r.admError };
      } catch (e) {
        const error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error(`[registry-refresh] geds: ${error}`);
        return { ok: false as const, error };
      }
    });

    const exemptResult = await step.run("seed-exempt-staff", async () => {
      try {
        const r = await seedExemptStaff();
        return { ok: true as const, staffInserted: r.staffInserted, skipped: r.ministersSkipped.length };
      } catch (e) {
        const error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error(`[registry-refresh] exempt-staff: ${error}`);
        return { ok: false as const, error };
      }
    });

    const parliamentResult = await step.run("seed-parliament", async () => {
      try {
        const r = await seedParliament();
        return { ok: true as const, membersInserted: r.membersInserted, senatorsInserted: r.senatorsInserted };
      } catch (e) {
        const error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
        console.error(`[registry-refresh] parliament: ${error}`);
        return { ok: false as const, error };
      }
    });

    const errors = [
      !ministersResult.ok && `ministers: ${ministersResult.error}`,
      !gedsResult.ok && `geds: ${gedsResult.error}`,
      !exemptResult.ok && `exempt-staff: ${exemptResult.error}`,
      !parliamentResult.ok && `parliament: ${parliamentResult.error}`,
    ].filter(Boolean);

    console.log(
      `[registry-refresh] complete — ` +
        (ministersResult.ok
          ? `ministers=${ministersResult.ministersInserted + ministersResult.parlSecsInserted}`
          : `ministers=ERR`) +
        ` geds=${gedsResult.ok ? `${gedsResult.dmsInserted}dm+${gedsResult.admsInserted}adm` : "ERR"}` +
        ` exempt=${exemptResult.ok ? exemptResult.staffInserted : "ERR"}` +
        ` parliament=${parliamentResult.ok ? `${parliamentResult.membersInserted}mp+${parliamentResult.senatorsInserted}sen` : "ERR"}` +
        (errors.length > 0 ? ` errors=[${errors.join(", ")}]` : ""),
    );

    return { ministersResult, gedsResult, exemptResult, parliamentResult, errors };
  },
);
