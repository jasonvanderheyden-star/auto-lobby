import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { appendAuditEvent } from "@/server/audit-log/append";

export const renewalCheckCron = inngest.createFunction(
  {
    id: "renewal-check-weekly",
    name: "Weekly registration renewal check",
    triggers: [{ cron: "0 8 * * 1" }], // 8am UTC Mondays (4am ET)
  },
  async () => {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

    const tenants = await db.tenant.findMany({
      where: {
        registrationExpiresAt: { not: null, lte: in60 },
      },
      select: { id: true, name: true, registrationExpiresAt: true },
    });

    console.log(`[renewal-check] ${tenants.length} tenant(s) approaching or past renewal`);

    for (const tenant of tenants) {
      const expiresAt = tenant.registrationExpiresAt!;
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const status = daysLeft < 0 ? "overdue" : daysLeft <= 14 ? "urgent" : "approaching";

      await appendAuditEvent({
        tenantId: tenant.id,
        actor: "system",
        actorRole: "system",
        action: "registry-refreshed", // reuse closest action — TODO: add "renewal-alert" in a later chunk
        subject: tenant.id,
        payload: {
          type: "renewal-check",
          status,
          daysLeft,
          expiresAt: expiresAt.toISOString(),
        },
      });

      console.log(`[renewal-check] tenant ${tenant.id}: ${status} (${daysLeft} days)`);
    }

    return { checked: tenants.length };
  },
);
