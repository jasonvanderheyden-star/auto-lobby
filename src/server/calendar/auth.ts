import { google } from "googleapis";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { encryptToken, decryptToken } from "@/server/crypto/tokens";

export class CalendarAuthError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly reason: "token_decrypt_failed" | "token_refresh_failed" | "no_refresh_token",
    cause?: unknown,
  ) {
    super(`Calendar auth failed for connection ${connectionId}: ${reason}`);
    this.name = "CalendarAuthError";
    if (cause) this.cause = cause;
  }
}

/**
 * Returns an authenticated Google Calendar API client for the given
 * CalendarConnection. Refreshes the access token if it expires within
 * the next 5 minutes and persists the new token to the DB.
 */
export async function getCalendarClient(connectionId: string) {
  const conn = await db.calendarConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: {
      id: true,
      tenantId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      accessTokenExpiresAt: true,
    },
  });

  let accessToken: string;
  let refreshToken: string | null = null;

  try {
    accessToken = decryptToken(conn.accessTokenEncrypted);
  } catch {
    await markConnectionFailed(connectionId, "token_decrypt_failed");
    throw new CalendarAuthError(connectionId, "token_decrypt_failed");
  }

  if (conn.refreshTokenEncrypted) {
    try {
      refreshToken = decryptToken(conn.refreshTokenEncrypted);
    } catch {
      await markConnectionFailed(connectionId, "token_decrypt_failed");
      throw new CalendarAuthError(connectionId, "token_decrypt_failed");
    }
  }

  const oauth2Client = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? null,
    expiry_date: conn.accessTokenExpiresAt?.getTime() ?? null,
  });

  // Refresh proactively if token expires within 5 minutes
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? 0;

  if (expiresAt < fiveMinFromNow) {
    if (!refreshToken) {
      await markConnectionFailed(connectionId, "no_refresh_token");
      throw new CalendarAuthError(connectionId, "no_refresh_token");
    }
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      const newAccessToken = credentials.access_token;
      if (!newAccessToken) throw new Error("empty access token from refresh");

      await db.calendarConnection.update({
        where: { id: connectionId },
        data: {
          accessTokenEncrypted: encryptToken(newAccessToken),
          ...(credentials.expiry_date != null && {
            accessTokenExpiresAt: new Date(credentials.expiry_date),
          }),
          status: "active",
          statusReason: null,
        },
      });

      oauth2Client.setCredentials({
        access_token: newAccessToken,
        refresh_token: refreshToken,
        expiry_date: credentials.expiry_date ?? null,
      });
    } catch (err) {
      await markConnectionFailed(connectionId, "token_refresh_failed");
      throw new CalendarAuthError(connectionId, "token_refresh_failed", err);
    }
  }

  return google.calendar({ version: "v3", auth: oauth2Client });
}

async function markConnectionFailed(
  connectionId: string,
  reason: string,
) {
  await db.calendarConnection.update({
    where: { id: connectionId },
    data: {
      status: "token_refresh_failed",
      statusReason: reason,
    },
  });
}
