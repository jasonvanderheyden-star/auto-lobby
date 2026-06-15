/**
 * src/server/microsoft/graph-client.ts
 *
 * Authenticated access to Microsoft Graph for a CalendarConnection.
 * Mirrors the Google pattern in src/server/calendar/auth.ts: decrypt stored
 * tokens, proactively refresh when the access token expires within 5 minutes,
 * persist new tokens, and mark the connection token_refresh_failed on failure.
 *
 * IMPORTANT: Microsoft rotates refresh tokens — every refresh response may
 * carry a new refresh_token, and the old one is eventually invalidated. We
 * always persist the new refresh token when one is returned.
 *
 * Reuses the CalendarAuthError taxonomy from the Google implementation so the
 * sync worker handles auth failures identically for both providers.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { encryptToken, decryptToken } from "@/server/crypto/tokens";
import { CalendarAuthError } from "@/server/calendar/auth";
import {
  getMicrosoftOAuthConfig,
  microsoftTokenUrl,
  MICROSOFT_OAUTH_SCOPES,
} from "@/lib/oauth/microsoft";

export const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const refreshResponseSchema = z.object({
  access_token: z.string().min(1),
  /** Rotated refresh token — usually present; persist whenever it is. */
  refresh_token: z.string().min(1).optional(),
  /** Seconds until the new access token expires. */
  expires_in: z.number().int().positive(),
});

/**
 * Returns a valid Graph access token for the given CalendarConnection,
 * refreshing (and persisting) it first if it expires within 5 minutes.
 *
 * Throws CalendarAuthError after marking the connection failed in the DB —
 * same contract as getCalendarClient() on the Google side.
 */
export async function getGraphAccessToken(connectionId: string): Promise<string> {
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
  let refreshToken: string;

  try {
    accessToken = decryptToken(conn.accessTokenEncrypted);
    refreshToken = decryptToken(conn.refreshTokenEncrypted);
  } catch {
    await markConnectionFailed(connectionId, "token_decrypt_failed");
    throw new CalendarAuthError(connectionId, "token_decrypt_failed");
  }

  // Refresh proactively if token expires within 5 minutes
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000;
  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? 0;

  if (expiresAt >= fiveMinFromNow) {
    return accessToken;
  }

  try {
    const config = getMicrosoftOAuthConfig();

    const response = await fetch(microsoftTokenUrl(config.tenant), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: MICROSOFT_OAUTH_SCOPES.join(" "),
      }),
    });

    if (!response.ok) {
      throw new Error(`token refresh returned status ${response.status}`);
    }

    const parsed = refreshResponseSchema.parse(await response.json());

    await db.calendarConnection.update({
      where: { id: connectionId },
      data: {
        accessTokenEncrypted: encryptToken(parsed.access_token),
        accessTokenExpiresAt: new Date(Date.now() + parsed.expires_in * 1000),
        // Microsoft rotates refresh tokens — always persist the new one.
        ...(parsed.refresh_token
          ? { refreshTokenEncrypted: encryptToken(parsed.refresh_token) }
          : {}),
        status: "active",
        statusReason: null,
      },
    });

    return parsed.access_token;
  } catch (err) {
    await markConnectionFailed(connectionId, "token_refresh_failed");
    throw new CalendarAuthError(connectionId, "token_refresh_failed", err);
  }
}

async function markConnectionFailed(connectionId: string, reason: string) {
  await db.calendarConnection.update({
    where: { id: connectionId },
    data: {
      status: "token_refresh_failed",
      statusReason: reason,
    },
  });
}
