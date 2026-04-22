/**
 * src/app/api/webhooks/clerk/route.ts
 *
 * Receives Clerk webhook events and keeps the Tenant table in sync.
 *
 * Events handled:
 *   organization.created  → upsert Tenant row (clerkOrgId as stable key)
 *   organization.updated  → update Tenant name if it changed
 *
 * Signature verification uses svix — the same library Clerk uses internally.
 * Set CLERK_WEBHOOK_SECRET in .env.local (Clerk dashboard → Webhooks →
 * your endpoint → Signing Secret).
 *
 * Local dev: expose localhost with `ngrok http 3000` (or Clerk's tunnel),
 * then register https://<your-tunnel>/api/webhooks/clerk as the endpoint URL.
 */

import { headers } from "next/headers";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

// Clerk webhook payload shapes we care about.
interface OrgEventData {
  id: string;
  name: string;
  slug: string | null;
  created_at: number;
  updated_at: number;
}

interface ClerkWebhookEvent {
  type: string;
  data: OrgEventData;
}

export async function POST(req: Request) {
  const secret = env.CLERK_WEBHOOK_SECRET;

  // Read svix signature headers.
  const headerMap = await headers();
  const svixId = headerMap.get("svix-id");
  const svixTimestamp = headerMap.get("svix-timestamp");
  const svixSignature = headerMap.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  // Read raw body — svix verifies the exact bytes, so we must not parse first.
  const body = await req.text();

  const wh = new Webhook(secret);
  let event: ClerkWebhookEvent;

  try {
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    console.error("[clerk-webhook] Signature verification failed:", err);
    return new Response("Invalid webhook signature", { status: 400 });
  }

  const { type, data } = event;

  if (type === "organization.created" || type === "organization.updated") {
    await db.tenant.upsert({
      where: { clerkOrgId: data.id },
      update: { name: data.name },
      create: {
        clerkOrgId: data.id,
        name: data.name,
        jurisdiction: "federal", // default; user can change in onboarding
      },
    });
    console.log(`[clerk-webhook] Tenant upserted for org ${data.id} (${data.name})`);
  }

  return new Response("OK", { status: 200 });
}
