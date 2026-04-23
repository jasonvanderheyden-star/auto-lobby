import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, InvalidTokenCiphertextError } from "@/server/crypto/tokens";

// encryptToken / decryptToken wrap AES-256-GCM.
// Tests assert round-trip correctness and tamper-detection — not specific
// ciphertext values, so any valid 32-byte CALENDAR_ENCRYPTION_KEY passes.

describe("encryption helper", () => {
  // ── round-trip ────────────────────────────────────────────────────────────

  it("round-trips short ASCII plaintext", () => {
    const plaintext = "hello world";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("round-trips Unicode plaintext", () => {
    const plaintext = "éàü 中文 🌍 日本語";
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  it("round-trips a long string (~2KB) simulating a real refresh token", () => {
    const plaintext = "a".repeat(2048);
    const encrypted = encryptToken(plaintext);
    expect(decryptToken(encrypted)).toBe(plaintext);
  });

  // ── tamper detection ──────────────────────────────────────────────────────

  it("throws InvalidTokenCiphertextError when ciphertext is tampered", () => {
    const plaintext = "sensitive";
    const encrypted = encryptToken(plaintext);
    const buf = Buffer.from(encrypted, "base64");
    // Flip one byte in the ciphertext region (after iv[12] + authTag[16] = byte 28).
    // Round-trip length guarantees buf.length > 28 since plaintext is non-empty.
    buf[28] = buf[28]! ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptToken(tampered)).toThrow(InvalidTokenCiphertextError);
  });

  // ── IV freshness ──────────────────────────────────────────────────────────

  it("produces different ciphertext for same plaintext across calls", () => {
    const plaintext = "deterministic input";
    const a = encryptToken(plaintext);
    const b = encryptToken(plaintext);
    expect(a).not.toBe(b);
    // But both still decrypt to the same value
    expect(decryptToken(a)).toBe(plaintext);
    expect(decryptToken(b)).toBe(plaintext);
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  it("throws InvalidTokenCiphertextError on a truncated payload", () => {
    const tooShort = Buffer.alloc(10).toString("base64");
    expect(() => decryptToken(tooShort)).toThrow(InvalidTokenCiphertextError);
  });
});
