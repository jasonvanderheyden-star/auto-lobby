// Shared HTTP utilities for GEDS (geds-sage.gc.ca) fetching.

const GEDS_BASE = "https://geds-sage.gc.ca/en/GEDS/";

export async function fetchWithTimeout(url: string, timeoutMs = 30_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; auto-lobby/1.0)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithTimeoutPost(
  url: string,
  body: URLSearchParams,
  timeoutMs = 30_000,
  referer = GEDS_BASE,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; auto-lobby/1.0)",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: referer,
      },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
