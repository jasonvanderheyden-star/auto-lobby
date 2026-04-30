import { describe, it, expect } from "vitest";
import { relativeTime } from "@/lib/relative-time";

describe("relativeTime", () => {
  const now = new Date("2026-04-30T17:30:00Z");

  it("returns 'just now' for <1 minute ago", () => {
    expect(relativeTime(new Date("2026-04-30T17:29:30Z"), now)).toBe("just now");
  });

  it("singularizes 1 minute", () => {
    expect(relativeTime(new Date("2026-04-30T17:29:00Z"), now)).toBe("1 minute ago");
  });

  it("pluralizes minutes", () => {
    expect(relativeTime(new Date("2026-04-30T17:00:00Z"), now)).toBe("30 minutes ago");
  });

  it("rolls over to hours at 60min", () => {
    expect(relativeTime(new Date("2026-04-30T15:30:00Z"), now)).toBe("2 hours ago");
  });

  it("rolls over to days at 24h", () => {
    expect(relativeTime(new Date("2026-04-28T17:30:00Z"), now)).toBe("2 days ago");
  });

  it("treats future dates as 'just now'", () => {
    expect(relativeTime(new Date("2026-04-30T17:31:00Z"), now)).toBe("just now");
  });
});
