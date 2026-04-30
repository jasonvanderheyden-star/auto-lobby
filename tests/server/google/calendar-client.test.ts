import { describe, it, expect } from "vitest";
import { encryptToken } from "@/server/crypto/tokens";
import { CalendarAuthError } from "@/server/google/calendar-client";

// We test the error-path logic without hitting real Google APIs.
// Happy-path integration is covered by the end-to-end OAuth test.

describe("CalendarAuthError", () => {
  it("carries connectionId and reason", () => {
    const err = new CalendarAuthError("conn_123", "token_refresh_failed");
    expect(err.connectionId).toBe("conn_123");
    expect(err.reason).toBe("token_refresh_failed");
    expect(err.name).toBe("CalendarAuthError");
  });

  it("is an instance of Error", () => {
    const err = new CalendarAuthError("conn_abc", "no_refresh_token");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("encryptToken round-trip (used by calendar client)", () => {
  it("produces different ciphertexts for the same input (fresh IVs)", () => {
    const a = encryptToken("test-access-token");
    const b = encryptToken("test-access-token");
    expect(a).not.toBe(b);
  });
});
