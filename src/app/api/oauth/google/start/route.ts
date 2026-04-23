/**
 * GET /api/oauth/google/start
 *
 * Initiates the Google Calendar OAuth flow for the authenticated user.
 * Generates a CSRF state token, stores it in an encrypted cookie, and
 * redirects the browser to Google's consent screen.
 *
 * Protected by Clerk middleware — only authenticated users with an active
 * org can reach this handler. The auth() check below is defense in depth.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getTenantContext } from "@/server/tenant/context";
import { buildGoogleAuthUrl } from "@/lib/oauth/google";
import { generateOAuthState, setOAuthStateCookie } from "@/lib/oauth/state-cookie";

export async function GET(): Promise<NextResponse> {
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

  const state = generateOAuthState();
  await setOAuthStateCookie({ state, tenantId, issuedAt: Date.now() });

  const authUrl = buildGoogleAuthUrl(state);
  return NextResponse.redirect(authUrl);
}
