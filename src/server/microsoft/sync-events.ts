/**
 * src/server/microsoft/sync-events.ts
 *
 * Microsoft 365 calendar event sync for one CalendarConnection, via Graph
 * delta queries. Mirrors src/server/google/sync-events.ts:
 *
 * - First sync: GET /me/calendarView/delta?startDateTime&endDateTime over the
 *   same window Google uses (90 days back, 365 days forward). calendarView
 *   expands recurring events to instances — equivalent to singleEvents: true.
 * - The @odata.deltaLink from the last page is persisted in
 *   CalendarConnection.syncToken; subsequent syncs call it directly.
 * - 410 Gone = delta token expired → clear syncToken, full resync next run.
 * - @removed entries are soft-cancelled, same as Google's status=cancelled.
 * - Upserts RawCalendarEvent keyed on [connectionId, externalId].
 *
 * Per CLAUDE.md, event bodies (descriptions) are NOT stored unless a tenant
 * opts in — body/bodyPreview are stripped from rawPayload and
 * descriptionIncluded stays false, matching the Google sync default.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { CalendarAuthError } from "@/server/calendar/auth";
import { getGraphAccessToken, GRAPH_BASE_URL } from "@/server/microsoft/graph-client";
import type { CalendarSyncProvider, CalendarSyncResult } from "@/server/ingestion/provider";

// ── Graph response schemas (known fields only; raw JSON kept separately) ────

const graphDateTimeSchema = z.object({
  dateTime: z.string().min(1),
  timeZone: z.string().nullish(),
});

const graphEmailAddressSchema = z.object({
  name: z.string().nullish(),
  address: z.string().nullish(),
});

const graphEventSchema = z.object({
  id: z.string().min(1),
  "@removed": z.object({ reason: z.string().nullish() }).nullish(),
  "@odata.etag": z.string().nullish(),
  iCalUId: z.string().nullish(),
  subject: z.string().nullish(),
  start: graphDateTimeSchema.nullish(),
  end: graphDateTimeSchema.nullish(),
  organizer: z.object({ emailAddress: graphEmailAddressSchema.nullish() }).nullish(),
  attendees: z
    .array(
      z.object({
        type: z.string().nullish(),
        status: z.object({ response: z.string().nullish() }).nullish(),
        emailAddress: graphEmailAddressSchema.nullish(),
      }),
    )
    .nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  sensitivity: z.string().nullish(),
  isCancelled: z.boolean().nullish(),
});

const deltaPageSchema = z.object({
  value: z.array(z.unknown()),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

// ── Field mappers ────────────────────────────────────────────────────────────

/**
 * Graph returns { dateTime, timeZone }. We request UTC via the
 * Prefer: outlook.timezone header, so the common case is a wall-clock string
 * without offset in UTC — append "Z" to parse as UTC. Non-UTC values (should
 * not occur given the Prefer header) fall back to local-time parsing.
 */
function parseGraphDateTime(
  dt: { dateTime: string; timeZone?: string | null | undefined } | null | undefined,
): Date | null {
  if (!dt?.dateTime) return null;
  const tz = dt.timeZone ?? "UTC";
  if (tz === "UTC" && !/[zZ]|[+-]\d{2}:\d{2}$/.test(dt.dateTime)) {
    return new Date(`${dt.dateTime}Z`);
  }
  return new Date(dt.dateTime);
}

/** Graph responseStatus → Google-style vocabulary already used in attendees Json. */
function mapResponseStatus(response: string | null | undefined): string | null {
  switch (response) {
    case "accepted":
    case "organizer":
      return "accepted";
    case "declined":
      return "declined";
    case "tentativelyAccepted":
      return "tentative";
    case "none":
    case "notResponded":
      return "needsAction";
    default:
      return null;
  }
}

/** Graph sensitivity → Google-style visibility vocabulary. */
function mapSensitivity(sensitivity: string | null | undefined): string | null {
  switch (sensitivity) {
    case "normal":
      return "default";
    case "private":
    case "personal": // Outlook "personal" flag — treat as private, err toward privacy
      return "private";
    case "confidential":
      return "confidential";
    default:
      return null;
  }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export const syncMicrosoftConnection: CalendarSyncProvider = async (
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

  let accessToken: string;
  try {
    accessToken = await getGraphAccessToken(connectionId);
  } catch (err) {
    if (err instanceof CalendarAuthError) {
      // status already marked in DB by getGraphAccessToken
      return { skipped: true, reason: err.reason };
    }
    throw err;
  }

  // Full sync window: 90 days back, 365 days forward — same as Google.
  const now = new Date();
  const startDateTime = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const endDateTime = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const initialUrl =
    `${GRAPH_BASE_URL}/me/calendarView/delta` +
    `?startDateTime=${encodeURIComponent(startDateTime)}` +
    `&endDateTime=${encodeURIComponent(endDateTime)}`;

  // syncToken holds the full @odata.deltaLink URL from the previous sync.
  let url: string | undefined = conn.syncToken ?? initialUrl;
  let deltaLink: string | undefined;
  let upsertCount = 0;
  let cancelCount = 0;

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // UTC keeps parseGraphDateTime trivial; maxpagesize matches Google's 250.
        Prefer: 'odata.maxpagesize=250, outlook.timezone="UTC"',
      },
    });

    // 410 Gone = delta token expired; clear it and let next run do a full sync
    if (response.status === 410) {
      await db.calendarConnection.update({
        where: { id: connectionId },
        data: { syncToken: null },
      });
      return { reset: true, reason: "sync_token_expired" };
    }

    if (!response.ok) {
      throw new Error(
        `Graph delta request failed for connection ${connectionId}: status ${response.status}`,
      );
    }

    const page = deltaPageSchema.parse(await response.json());

    for (const raw of page.value) {
      const parsed = graphEventSchema.safeParse(raw);
      if (!parsed.success) {
        // Log the connection id only — never event content (no PII in logs).
        console.warn(`[microsoft-sync] skipping unparseable event on connection ${connectionId}`);
        continue;
      }
      const event = parsed.data;

      // Deleted in delta — soft-delete like Google's status=cancelled.
      if (event["@removed"]) {
        await db.rawCalendarEvent.updateMany({
          where: { connectionId, externalId: event.id },
          data: { eventStatus: "cancelled" },
        });
        cancelCount++;
        continue;
      }

      const startsAt = parseGraphDateTime(event.start);
      const endsAt = parseGraphDateTime(event.end);
      const organizerEmail = event.organizer?.emailAddress?.address ?? null;

      const attendees = (event.attendees ?? []).map((a) => ({
        email: a.emailAddress?.address ?? null,
        displayName: a.emailAddress?.name ?? null,
        responseStatus: mapResponseStatus(a.status?.response),
        organizer:
          a.status?.response === "organizer" ||
          (organizerEmail !== null &&
            a.emailAddress?.address?.toLowerCase() === organizerEmail.toLowerCase()),
        optional: a.type === "optional",
      }));

      // Strip the body before persisting — descriptions are opt-in per tenant
      // (descriptionIncluded stays false, same as the Google sync default).
      const rawPayload: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
      delete rawPayload.body;
      delete rawPayload.bodyPreview;

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
          icalUID: event.iCalUId ?? null,
          title: event.subject ?? null,
          startsAt,
          endsAt,
          organizerEmail,
          attendees,
          location: event.location?.displayName ?? null,
          visibility: mapSensitivity(event.sensitivity),
          eventStatus: event.isCancelled ? "cancelled" : "confirmed",
          descriptionIncluded: false,
          rawPayload: rawPayload as object,
          etag: event["@odata.etag"] ?? null,
        },
        update: {
          icalUID: event.iCalUId ?? null,
          title: event.subject ?? null,
          startsAt,
          endsAt,
          organizerEmail,
          attendees,
          location: event.location?.displayName ?? null,
          visibility: mapSensitivity(event.sensitivity),
          eventStatus: event.isCancelled ? "cancelled" : "confirmed",
          rawPayload: rawPayload as object,
          etag: event["@odata.etag"] ?? null,
        },
      });
      upsertCount++;
    }

    if (page["@odata.nextLink"]) {
      url = page["@odata.nextLink"];
    } else {
      deltaLink = page["@odata.deltaLink"];
      url = undefined;
    }
  }

  // Persist the new deltaLink and update lastSyncedAt
  await db.calendarConnection.update({
    where: { id: connectionId },
    data: {
      syncToken: deltaLink ?? conn.syncToken,
      lastSyncedAt: new Date(),
    },
  });

  return { upserted: upsertCount, cancelled: cancelCount };
};
