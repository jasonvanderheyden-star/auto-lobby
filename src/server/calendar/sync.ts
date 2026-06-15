/**
 * src/server/calendar/sync.ts
 *
 * Inngest worker: cron fan-out + per-connection sync. Provider-specific event
 * fetching lives in src/server/{google,microsoft}/sync-events.ts — this file
 * only schedules and dispatches on CalendarConnection.provider.
 */

import type { CalendarProvider } from "@prisma/client";
import { inngest } from "@/lib/inngest";
import { db } from "@/lib/db";
import { syncGoogleConnection } from "@/server/google/sync-events";
import { syncMicrosoftConnection } from "@/server/microsoft/sync-events";
import type { CalendarSyncProvider } from "@/server/ingestion/provider";

const SYNC_PROVIDERS: Record<CalendarProvider, CalendarSyncProvider> = {
  google: syncGoogleConnection,
  microsoft365: syncMicrosoftConnection,
};

// ── Function 1: cron fan-out ─────────────────────────────────────────────────

export const scheduleCalendarSync = inngest.createFunction(
  {
    id: "calendar-sync-scheduler",
    name: "Calendar sync scheduler",
    triggers: [{ cron: "*/15 * * * *" }], // every 15 minutes
  },
  async ({ step }) => {
    const connections = await step.run("fetch-active-connections", async () => {
      return db.calendarConnection.findMany({
        where: { status: "active" },
        select: { id: true },
      });
    });

    if (connections.length === 0) return { synced: 0 };

    await step.sendEvent(
      "fan-out-sync-events",
      connections.map((c) => ({
        name: "calendar/connection.sync" as const,
        data: { connectionId: c.id },
      })),
    );

    return { queued: connections.length };
  },
);

// ── Function 2: per-connection sync ─────────────────────────────────────────

export const syncCalendarConnection = inngest.createFunction(
  {
    id: "calendar-connection-sync",
    name: "Sync calendar connection",
    retries: 3,
    triggers: [{ event: "calendar/connection.sync" }],
  },
  async ({ event, step }) => {
    const { connectionId } = event.data as { connectionId: string };

    const result = await step.run("fetch-and-upsert-events", async () => {
      const conn = await db.calendarConnection.findUniqueOrThrow({
        where: { id: connectionId },
        select: { provider: true },
      });
      return SYNC_PROVIDERS[conn.provider](connectionId);
    });

    return result;
  },
);
