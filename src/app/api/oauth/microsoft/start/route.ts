/**
 * GET /api/oauth/microsoft/start
 *
 * Initiates the Microsoft 365 Calendar OAuth flow for the authenticated user.
 * Generates a CSRF state token, stores it in an encrypted cookie, and
 * redirects the browser to the Microsoft identity platform consent screen.
 *
 * Mirrors /api/oauth/google/start. Protected by Clerk middleware — only
 * authenticated users with an active org can reach this handler. The auth()
 * check below is defense in depth.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getTenantContext } from "@/server/tenant/context";
import { buildMicrosoftAuthUrl, MicrosoftOAuthError } from "@/lib/oauth/microsoft";
import { generateOAuthState, setOAuthStateCookie } from "@/lib/oauth/state-cookie";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let tenantId: string;
  try {
    const ctx = await getTenantContext();
    tenantId = ctx.tenantId;
  } catch {
    return new NextResponse("Tenant not found", { status: 404 });
  }

  // Build the auth URL before setting the cookie so a missing Entra app
  // registration doesn't leave a dangling state cookie behind.
  const state = generateOAuthState();
  let authUrl: string;
  try {
    authUrl = buildMicrosoftAuthUrl(state);
  } catch (err) {
    if (err instanceof MicrosoftOAuthError && err.message === "not_configured") {
      return NextResponse.redirect(
        new URL("/settings/calendars?error=microsoft_not_configured", request.nextUrl.origin),
        { status: 307 },
      );
    }
    throw err;
  }

  await setOAuthStateCookie({ state, tenantId, issuedAt: Date.now() });

  return NextResponse.redirect(authUrl);
}
