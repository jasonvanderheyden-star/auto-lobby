/**
 * GET /api/oauth/google/callback
 *
 * Receives the Google OAuth authorization code, validates the state cookie,
 * exchanges the code for tokens, and upserts a CalendarConnection row.
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
import { exchangeCodeForTokens } from "@/lib/oauth/google";
import { clearOAuthStateCookie, readOAuthStateCookie } from "@/lib/oauth/state-cookie";
import { encryptToken } from "@/server/crypto/tokens";
import { db } from "@/lib/db";

const SETTINGS = "/settings/calendars";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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

  // 3. Error branch — user cancelled or Google returned an error
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
  if (!bundle.scopes.includes(CALENDAR_SCOPE)) {
    return redirect(`${SETTINGS}?error=missing_scope`);
  }

  // 8. Encrypt tokens
  const accessTokenEncrypted = encryptToken(bundle.accessToken);
  const refreshTokenEncrypted = encryptToken(bundle.refreshToken);

  // 9. Upsert CalendarConnection
  // TODO: append an AuditEvent row for the connect/reconnect action in a later pass.
  await db.calendarConnection.upsert({
    where: {
      tenantId_provider_externalAccountId: {
        tenantId: ctx.tenantId,
        provider: CalendarProvider.google,
        externalAccountId: bundle.externalAccountId,
      },
    },
    create: {
      tenantId: ctx.tenantId,
      connectedByUserId: ctx.userId,
      provider: CalendarProvider.google,
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

  // 10. Redirect on success
  return redirect(`${SETTINGS}?connected=${encodeURIComponent(bundle.email)}`);
}
