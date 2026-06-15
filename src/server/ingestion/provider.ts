/**
 * src/server/ingestion/provider.ts
 *
 * Minimal provider contract for calendar event sync. The Inngest worker in
 * src/server/calendar/sync.ts dispatches on CalendarConnection.provider to
 * one implementation per provider:
 *
 *   google       → src/server/google/sync-events.ts
 *   microsoft365 → src/server/microsoft/sync-events.ts
 *
 * Deliberately small — just a function signature and a result union. Don't
 * grow this into a class hierarchy until a third provider demands it.
 */

/** Auth failed (connection already marked failed in DB) — nothing synced. */
export interface SyncSkipped {
  skipped: true;
  reason: string;
}

/** Incremental sync token expired — token cleared; next run does a full sync. */
export interface SyncReset {
  reset: true;
  reason: string;
}

/** Sync completed — counts of upserted and soft-cancelled events. */
export interface SyncCompleted {
  upserted: number;
  cancelled: number;
}

export type CalendarSyncResult = SyncSkipped | SyncReset | SyncCompleted;

/** One full sync pass for a single CalendarConnection. */
export type CalendarSyncProvider = (connectionId: string) => Promise<CalendarSyncResult>;
