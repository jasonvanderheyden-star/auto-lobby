/**
 * src/server/crypto/tokens.ts
 *
 * AES-256-GCM encrypt/decrypt for OAuth tokens stored in Postgres.
 * Wire format: base64( iv[12] || authTag[16] || ciphertext[n] )
 *
 * Server-only. Never import from Client Components.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const IV_LEN = 12;
const TAG_LEN = 16;
const MIN_PAYLOAD_LEN = IV_LEN + TAG_LEN; // 28

const key = Buffer.from(env.CALENDAR_ENCRYPTION_KEY, "base64");

export class InvalidTokenCiphertextError extends Error {
  constructor() {
    super("failed to decrypt token");
    this.name = "InvalidTokenCiphertextError";
  }
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(payload: string): string {
  const buf = Buffer.from(payload, "base64");

  if (buf.length < MIN_PAYLOAD_LEN) {
    throw new InvalidTokenCiphertextError();
  }

  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new InvalidTokenCiphertextError();
  }
}
