/**
 * src/lib/env.ts
 *
 * Validated environment variables.  Import `env` instead of `process.env`
 * throughout the app so missing or malformed vars fail loudly at startup.
 *
 * Server-only: never import this in Client Components.
 */

import { z } from "zod";

const schema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_"),
  CLERK_WEBHOOK_SECRET: z.string().startsWith("whsec_"),

  // Google Calendar OAuth
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().startsWith(
    "GOCSPX-",
    "must be a Google OAuth client secret (starts with GOCSPX-)",
  ),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
  CALENDAR_ENCRYPTION_KEY: z.string().refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "must be 32 bytes when base64-decoded — generate with: openssl rand -base64 32",
  ),

  // Microsoft 365 Calendar OAuth (Entra ID).
  // Optional so the app boots before an Entra app registration exists —
  // the /api/oauth/microsoft/* routes fail loudly when unset.
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  /** Entra tenant segment of the authority URL — "common" allows any org + personal accounts. */
  MICROSOFT_TENANT: z.string().min(1).default("common"),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),

  // Optional — not yet wired, but validated when present
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-").optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const [key, issues] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${key}: ${issues?.join(", ")}`);
  }
  throw new Error("Environment validation failed — check .env.local");
}

export const env = parsed.data;
