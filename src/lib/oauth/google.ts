/**
 * src/lib/oauth/google.ts
 *
 * Google OAuth2 helpers — auth URL generation and code exchange.
 * Route handlers import from here and stay Google-agnostic themselves.
 *
 * Server-only. Never import from Client Components.
 */

import { google } from "googleapis";
import { env } from "@/lib/env";

export const GOOGLE_OAUTH_SCOPES: readonly string[] = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;

export interface GoogleTokenBundle {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
  /** Google 'sub' claim — stable per account, immutable. */
  externalAccountId: string;
  /** Email address of the connected account — display only, not a join key. */
  email: string;
}

export class GoogleOAuthError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "GoogleOAuthError";
  }
}

const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_OAUTH_CLIENT_ID,
  env.GOOGLE_OAUTH_CLIENT_SECRET,
  env.GOOGLE_OAUTH_REDIRECT_URI,
);

export function buildGoogleAuthUrl(state: string): string {
  return oauth2Client.generateAuthUrl({
    access_type: "offline",       // required to receive a refresh token
    prompt: "consent",            // force consent screen — ensures refresh token on re-auth
    scope: [...GOOGLE_OAUTH_SCOPES],
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenBundle> {
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token)  throw new GoogleOAuthError("missing_access_token");
  if (!tokens.refresh_token) throw new GoogleOAuthError("missing_refresh_token");
  if (!tokens.expiry_date)   throw new GoogleOAuthError("missing_expiry_date");
  if (!tokens.id_token)      throw new GoogleOAuthError("missing_id_token");
  if (!tokens.scope)         throw new GoogleOAuthError("missing_scope");

  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw new GoogleOAuthError("missing_id_claims");
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(tokens.expiry_date),
    scopes: tokens.scope.split(" "),
    externalAccountId: payload.sub,
    email: payload.email,
  };
}
