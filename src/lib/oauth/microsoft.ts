/**
 * src/lib/oauth/microsoft.ts
 *
 * Microsoft identity platform (Entra ID) OAuth2 helpers — auth URL generation
 * and authorization-code exchange. Mirrors src/lib/oauth/google.ts; route
 * handlers import from here and stay Microsoft-agnostic themselves.
 *
 * No MSAL dependency — the v2.0 endpoints are plain OAuth2, called via fetch.
 *
 * Server-only. Never import from Client Components.
 */

import { z } from "zod";
import { env } from "@/lib/env";

export const MICROSOFT_OAUTH_SCOPES: readonly string[] = [
  "offline_access",
  "openid",
  "email",
  "User.Read",
  "Calendars.Read",
] as const;

export interface MicrosoftTokenBundle {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  scopes: string[];
  /** Entra `oid` claim (stable object id), falling back to `sub`. Immutable per account. */
  externalAccountId: string;
  /** Email address of the connected account — display only, not a join key. */
  email: string;
}

export class MicrosoftOAuthError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "MicrosoftOAuthError";
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  tenant: string;
  redirectUri: string;
}

/**
 * Microsoft env vars are optional in the Zod schema so the app boots without
 * an Entra app registration. Resolve them here and fail loudly at flow time.
 */
export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig {
  const clientId = env.MICROSOFT_CLIENT_ID;
  const clientSecret = env.MICROSOFT_CLIENT_SECRET;
  const redirectUri = env.MICROSOFT_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new MicrosoftOAuthError("not_configured");
  }

  return { clientId, clientSecret, tenant: env.MICROSOFT_TENANT, redirectUri };
}

export function microsoftAuthorizeUrl(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

export function microsoftTokenUrl(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

// ── Auth URL ──────────────────────────────────────────────────────────────────

export function buildMicrosoftAuthUrl(state: string): string {
  const config = getMicrosoftOAuthConfig();

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    state,
    // Let the user pick the right work account on re-auth — equivalent intent
    // to Google's prompt: "consent" (offline_access already guarantees a
    // refresh token on the Microsoft side).
    prompt: "select_account",
  });

  return `${microsoftAuthorizeUrl(config.tenant)}?${params.toString()}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  /** Seconds until the access token expires. */
  expires_in: z.number().int().positive(),
  /** Space-separated granted scopes (Graph scopes, without the resource prefix). */
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

const idTokenClaimsSchema = z.object({
  /** Entra object id — stable per user per tenant. Absent for some personal accounts. */
  oid: z.string().min(1).optional(),
  sub: z.string().min(1),
  preferred_username: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
});

const graphMeSchema = z.object({
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});

/**
 * Decodes the id_token payload WITHOUT signature verification. The token was
 * received directly from login.microsoftonline.com over TLS in the same
 * response as the access token, so it carries the same trust — this is the
 * documented pattern for confidential clients reading their own token
 * response (no equivalent of googleapis' verifyIdToken is installed).
 */
function decodeIdTokenClaims(idToken: string): z.infer<typeof idTokenClaimsSchema> {
  const segments = idToken.split(".");
  const payloadSegment = segments[1];
  if (segments.length !== 3 || !payloadSegment) {
    throw new MicrosoftOAuthError("malformed_id_token");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  } catch {
    throw new MicrosoftOAuthError("malformed_id_token");
  }

  const claims = idTokenClaimsSchema.safeParse(parsedJson);
  if (!claims.success) throw new MicrosoftOAuthError("missing_id_claims");
  return claims.data;
}

export async function exchangeCodeForTokens(code: string): Promise<MicrosoftTokenBundle> {
  const config = getMicrosoftOAuthConfig();

  const response = await fetch(microsoftTokenUrl(config.tenant), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      scope: MICROSOFT_OAUTH_SCOPES.join(" "),
    }),
  });

  if (!response.ok) throw new MicrosoftOAuthError("token_exchange_failed");

  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new MicrosoftOAuthError("malformed_token_response");

  const tokens = parsed.data;
  if (!tokens.refresh_token) throw new MicrosoftOAuthError("missing_refresh_token");
  if (!tokens.id_token) throw new MicrosoftOAuthError("missing_id_token");
  if (!tokens.scope) throw new MicrosoftOAuthError("missing_scope");

  const claims = decodeIdTokenClaims(tokens.id_token);

  // Email: prefer id_token claims; fall back to Graph /me for accounts that
  // omit both (e.g. some guest / personal account configurations).
  let email = claims.preferred_username ?? claims.email ?? null;
  if (!email) {
    const meResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (meResponse.ok) {
      const me = graphMeSchema.safeParse(await meResponse.json());
      if (me.success) email = me.data.mail ?? me.data.userPrincipalName ?? null;
    }
  }
  if (!email) throw new MicrosoftOAuthError("missing_id_claims");

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    scopes: tokens.scope.split(" "),
    externalAccountId: claims.oid ?? claims.sub,
    email,
  };
}
