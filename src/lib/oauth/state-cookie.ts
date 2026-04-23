/**
 * src/lib/oauth/state-cookie.ts
 *
 * OAuth state cookie — CSRF protection for the Google OAuth flow.
 *
 * Layer A: pure encode/decode (testable without Next.js context).
 * Layer B: cookie I/O via next/headers (used by route handlers).
 *
 * Server-only. Never import from Client Components.
 */

import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cookies } from "next/headers";
import { decryptToken, encryptToken, InvalidTokenCiphertextError } from "@/server/crypto/tokens";

export { InvalidTokenCiphertextError };

// ── Types + constants ─────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  state: string;     // random CSRF token (64 hex chars from generateOAuthState)
  tenantId: string;  // tenant that initiated the flow
  issuedAt: number;  // Date.now() at issuance
}

export const OAUTH_STATE_COOKIE_NAME = "al_oauth_state";
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

export class InvalidOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOAuthStateError";
  }
}

const payloadSchema = z.object({
  state: z.string().length(64).regex(/^[0-9a-f]+$/),
  tenantId: z.string().min(1),
  issuedAt: z.number().int().positive(),
});

// ── Layer A: pure functions ───────────────────────────────────────────────────

export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function encodeOAuthStatePayload(p: OAuthStatePayload): string {
  return encryptToken(JSON.stringify(p));
}

export function decodeOAuthStatePayload(
  encoded: string,
  maxAgeMs: number = OAUTH_STATE_MAX_AGE_MS,
): OAuthStatePayload {
  const plaintext = decryptToken(encoded); // propagates InvalidTokenCiphertextError

  const parsed = payloadSchema.safeParse(JSON.parse(plaintext));
  if (!parsed.success) {
    throw new InvalidOAuthStateError("invalid_state_payload");
  }

  if (Date.now() - parsed.data.issuedAt > maxAgeMs) {
    throw new InvalidOAuthStateError("stale_state_payload");
  }

  return parsed.data;
}

// ── Layer B: cookie I/O ───────────────────────────────────────────────────────

export async function setOAuthStateCookie(p: OAuthStatePayload): Promise<void> {
  const jar = await cookies();
  jar.set({
    name: OAUTH_STATE_COOKIE_NAME,
    value: encodeOAuthStatePayload(p),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // NOT strict — must survive the Google redirect back to our origin
    maxAge: Math.floor(OAUTH_STATE_MAX_AGE_MS / 1000),
    path: "/",
  });
}

export async function readOAuthStateCookie(): Promise<OAuthStatePayload | null> {
  const jar = await cookies();
  const raw = jar.get(OAUTH_STATE_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return decodeOAuthStatePayload(raw);
  } catch {
    // Corrupt or expired cookie — treat as absent.
    return null;
  }
}

export async function clearOAuthStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(OAUTH_STATE_COOKIE_NAME);
}
