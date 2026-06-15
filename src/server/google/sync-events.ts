/**
 * src/server/google/sync-events.ts
 *
 * Google Calendar event sync for one CalendarConnection. Extracted verbatim
 * from src/server/calendar/sync.ts when Microsoft 365 support landed — the
 * Inngest worker now dispatches on connection.provider.
 *
 * Incremental fetch via syncToken when present; full-window fetch otherwise.
 * 410 Gone (expired syncToken) clears the token so the next run does a full
 * resync. Upserts RawCalendarEvent keyed on [connectionId, externalId].
 */

import { db } from "@/lib/db";
import { getCalendarClient, CalendarAuthError } from "@/server/calendar/auth";
import type { CalendarSyncProvider, CalendarSyncResult } from "@/server/ingestion/provider";
import type { calendar_v3 } from "googleapis";

export const syncGoogleConnection: CalendarSyncProvider = async (
  connectionId: string,
): Promise<CalendarSyncResult> => {
  const conn = await db.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: {
      id: true,
      tenantId: true,
      syncToken: true,
    },
  });

  let calendarClient: Awaited<ReturnType<typeof getCalendarClient>>;
  try {
    calendarClient = await getCalendarClient(connectionId);
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      // status already marked in DB by getCalendarClient
      return { skipped: true, reason: err.reason };
    }
    throw err;
  }

  // Fetch events — incremental if we have a syncToken, full if first sync.
  // Full sync window: 90 days back, 365 days forward.
  const now = new Date();
  const timeMin = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let upsertCount = 0;
  let cancelCount = 0;

  do {
    // Build params imperatively to satisfy exactOptionalPropertyTypes —
    // spreading { key: string | undefined } onto an interface with optional
    // keys typed as `string` (not `string | undefined`) is rejected by tsc.
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId: "primary",
      singleEvents: true,
      maxResults: 250,
    };
    if (conn.syncToken) {
      params.syncToken = conn.syncToken;
    } else {
      params.timeMin = timeMin;
      params.timeMax = timeMax;
    }
    if (pageToken) params.pageToken = pageToken;

    let response: calendar_v3.Schema$Events;
    try {
      const res = await calendarClient.events.list(params);
      response = res.data;
    } catch (err: unknown) {
      // 410 Gone = syncToken expired; clear it and let next run do a full sync
      const status = (err as { code?: number })?.code;
      if (status === 410) {
        await db.calendarConnection.update({
          where: { id: connectionId },
          data: { syncToken: null },
        });
        return { reset: true, reason: "sync_token_expired" };
      }
      throw err;
    }

    const events = response.items ?? [];
    nextSyncToken = response.nextSyncToken ?? undefined;
    pageToken = response.nextPageToken ?? undefined;

    for (const event of events) {
      if (!event.id) continue;

      if (event.status === "cancelled") {
        // Soft-delete: mark eventStatus = cancelled but keep the row
        await db.rawCalendarEvent.updateMany({
          where: { connectionId, externalId: event.id },
          data: { eventStatus: "cancelled" },
        });
        cancelCount++;
        continue;
      }

      const startsAt = event.start?.dateTime
        ? new Date(event.start.dateTime)
        : event.start?.date
          ? new Date(event.start.date)
          : null;

      const endsAt = event.end?.dateTime
        ? new Date(event.end.dateTime)
        : event.end?.date
          ? new Date(event.end.date)
          : null;

      const attendees = (event.attendees ?? []).map((a) => ({
        email: a.email ?? null,
        displayName: a.displayName ?? null,
        responseStatus: a.responseStatus ?? null,
        organizer: a.organizer ?? false,
        optional: a.optional ?? false,
      }));

      await db.rawCalendarEvent.upsert({
        where: {
          connectionId_externalId: {
            connectionId,
            externalId: event.id,
          },
        },
        create: {
          tenantId: conn.tenantId,
          connectionId,
          externalId: event.id,
          icalUID: event.iCalUID ?? null,
          title: event.summary ?? null,
          startsAt,
          endsAt,
          organizerEmail: event.organizer?.email ?? null,
          attendees,
          location: event.location ?? null,
          visibility: event.visibility ?? null,
          eventStatus: event.status ?? null,
          descriptionIncluded: false,
          rawPayload: event as object,
          etag: event.etag ?? null,
        },
        update: {
          icalUID: event.iCalUID ?? null,
          title: event.summary ?? null,
          startsAt,
          endsAt,
          organizerEmail: event.organizer?.email ?? null,
          attendees,
          location: event.location ?? null,
          visibility: event.visibility ?? null,
          eventStatus: event.status ?? null,
          rawPayload: event as object,
          etag: event.etag ?? null,
        },
      });
      upsertCount++;
    }
  } while (pageToken);

  // Persist the new syncToken and update lastSyncedAt
  await db.calendarConnection.update({
    where: { id: connectionId },
    data: {
      syncToken: nextSyncToken ?? conn.syncToken,
      lastSyncedAt: new Date(),
    },
  });

  return { upserted: upsertCount, cancelled: cancelCount };
};
