/**
 * GET /api/oauth/microsoft/callback
 *
 * Receives the Microsoft authorization code, validates the state cookie,
 * exchanges the code for tokens, and upserts a CalendarConnection row with
 * provider = microsoft365. Mirrors /api/oauth/google/callback.
 *
 * All error branches redirect to /settings/calendars with a machine-readable
 * error param. No token or code values are ever logged or included in
 * redirect params.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { CalendarConnectionStatus, CalendarProvider } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { getTenantContext } from "@/server/tenant/context";
import { exchangeCodeForTokens } from "@/lib/oauth/microsoft";
import { clearOAuthStateCookie, readOAuthStateCookie } from "@/lib/oauth/state-cookie";
import { encryptToken } from "@/server/crypto/tokens";
import { appendAuditEvent } from "@/server/audit-log/append";
import { db } from "@/lib/db";

const SETTINGS = "/settings/calendars";
// Microsoft echoes Graph scopes without the resource prefix ("Calendars.Read"),
// but some tenant configurations return the fully-qualified form
// ("https://graph.microsoft.com/Calendars.Read") — accept both.
const CALENDAR_SCOPE_SUFFIX = "calendars.read";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.nextUrl.origin;

  function redirect(path: string): NextResponse {
    return NextResponse.redirect(new URL(path, origin), { status: 307 });
  }

  // 1. Auth + tenant resolution
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let ctx: Awaited<ReturnType<typeof getTenantContext>>;
  try {
    ctx = await getTenantContext();
  } catch {
    return new NextResponse("Tenant not found", { status: 404 });
  }

  // 2. Parse query params
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // 3. Error branch — user cancelled or Microsoft returned an error
  // (e.g. access_denied, consent_required, server_error)
  if (error) {
    await clearOAuthStateCookie();
    return redirect(`${SETTINGS}?error=${encodeURIComponent(error)}`);
  }

  // 4. Missing params
  if (!code || !state) {
    await clearOAuthStateCookie();
    return redirect(`${SETTINGS}?error=missing_params`);
  }

  // 5. State cookie validation
  const cookiePayload = await readOAuthStateCookie();

  if (!cookiePayload) {
    await clearOAuthStateCookie();
    return redirect(`${SETTINGS}?error=expired_state`);
  }

  if (cookiePayload.state !== state) {
    await clearOAuthStateCookie();
    return redirect(`${SETTINGS}?error=state_mismatch`);
  }

  if (cookiePayload.tenantId !== ctx.tenantId) {
    await clearOAuthStateCookie();
    return redirect(`${SETTINGS}?error=tenant_mismatch`);
  }

  // Clear the cookie now — before the token exchange — so a failed exchange
  // doesn't leave a reusable state cookie behind.
  await clearOAuthStateCookie();

  // 6. Token exchange
  let bundle: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
  try {
    bundle = await exchangeCodeForTokens(code);
  } catch {
    return redirect(`${SETTINGS}?error=exchange_failed`);
  }

  // 7. Scope validation
  const hasCalendarScope = bundle.scopes.some((s) =>
    s.toLowerCase().endsWith(CALENDAR_SCOPE_SUFFIX),
  );
  if (!hasCalendarScope) {
    return redirect(`${SETTINGS}?error=missing_scope`);
  }

  // 8. Encrypt tokens
  const accessTokenEncrypted = encryptToken(bundle.accessToken);
  const refreshTokenEncrypted = encryptToken(bundle.refreshToken);

  // 9. Upsert CalendarConnection
  const connection = await db.calendarConnection.upsert({
    where: {
      tenantId_provider_externalAccountId: {
        tenantId: ctx.tenantId,
        provider: CalendarProvider.microsoft365,
        externalAccountId: bundle.externalAccountId,
      },
    },
    create: {
      tenantId: ctx.tenantId,
      connectedByUserId: ctx.userId,
      provider: CalendarProvider.microsoft365,
      externalAccountId: bundle.externalAccountId,
      email: bundle.email,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt: bundle.accessTokenExpiresAt,
      scopes: bundle.scopes,
    },
    update: {
      email: bundle.email,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      accessTokenExpiresAt: bundle.accessTokenExpiresAt,
      scopes: bundle.scopes,
      status: CalendarConnectionStatus.active,
      statusReason: null,
      connectedByUserId: ctx.userId,
    },
  });

  // 10. Audit trail — IDs only, no attendee/account PII in the payload.
  await appendAuditEvent({
    tenantId: ctx.tenantId,
    actor: ctx.userId,
    action: "calendar-connected",
    subject: connection.id,
    payload: { provider: "microsoft365" },
  });

  // 11. Redirect on success
  return redirect(`${SETTINGS}?connected=${encodeURIComponent(bundle.email)}`);
}
