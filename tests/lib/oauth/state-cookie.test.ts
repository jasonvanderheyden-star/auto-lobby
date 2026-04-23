import { describe, expect, it } from "vitest";
import {
  decodeOAuthStatePayload,
  encodeOAuthStatePayload,
  generateOAuthState,
  InvalidOAuthStateError,
  type OAuthStatePayload,
} from "@/lib/oauth/state-cookie";
import { InvalidTokenCiphertextError } from "@/server/crypto/tokens";

// Tests cover only layer A (pure functions). Layer B (cookie I/O) requires
// Next.js runtime context and is exercised by integration tests.

describe("OAuth state cookie — pure functions", () => {
  it("generateOAuthState returns 64-char lowercase hex", () => {
    const s = generateOAuthState();
    expect(s).toHaveLength(64);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generateOAuthState returns different values across calls", () => {
    expect(generateOAuthState()).not.toBe(generateOAuthState());
  });

  it("encode → decode round-trips a valid payload", () => {
    const payload: OAuthStatePayload = {
      state: generateOAuthState(),
      tenantId: "tenant_abc123",
      issuedAt: Date.now(),
    };
    const encoded = encodeOAuthStatePayload(payload);
    expect(decodeOAuthStatePayload(encoded)).toEqual(payload);
  });

  it("decode throws InvalidOAuthStateError on stale payload", () => {
    const payload: OAuthStatePayload = {
      state: generateOAuthState(),
      tenantId: "tenant_abc123",
      issuedAt: Date.now() - 11 * 60 * 1000, // 11 min ago
    };
    const encoded = encodeOAuthStatePayload(payload);
    expect(() => decodeOAuthStatePayload(encoded)).toThrow(InvalidOAuthStateError);
  });

  it("decode throws InvalidTokenCiphertextError when cookie is corrupt", () => {
    const payload: OAuthStatePayload = {
      state: generateOAuthState(),
      tenantId: "tenant_abc123",
      issuedAt: Date.now(),
    };
    const encoded = encodeOAuthStatePayload(payload);
    const buf = Buffer.from(encoded, "base64");
    buf[28] = buf[28]! ^ 0xff; // flip one byte of ciphertext
    const tampered = buf.toString("base64");
    expect(() => decodeOAuthStatePayload(tampered)).toThrow(InvalidTokenCiphertextError);
  });
});
