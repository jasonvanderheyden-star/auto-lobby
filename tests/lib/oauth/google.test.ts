import { describe, expect, it } from "vitest";
import { buildGoogleAuthUrl } from "@/lib/oauth/google";
import { env } from "@/lib/env";

// Tests cover buildGoogleAuthUrl only — it's pure and needs no mocking.
// exchangeCodeForTokens requires live googleapis network calls; omitted.

describe("buildGoogleAuthUrl", () => {
  it("includes all required params in the auth URL", () => {
    const url = new URL(buildGoogleAuthUrl("test-state"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(env.GOOGLE_OAUTH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(env.GOOGLE_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("test-state");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("requests exactly the three expected scopes", () => {
    const url = new URL(buildGoogleAuthUrl("s"));
    const scope = url.searchParams.get("scope") ?? "";
    const scopes = scope.split(" ");
    expect(scopes).toHaveLength(3);
    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("encodes state param safely (no injection)", () => {
    const weirdState = "has spaces & = ? chars";
    const url = new URL(buildGoogleAuthUrl(weirdState));
    expect(url.searchParams.get("state")).toBe(weirdState);
  });
});
