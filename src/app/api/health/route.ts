import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/health
 *
 * Liveness + DB connectivity check.
 * Runs a trivial COUNT on the Tenant table to prove Neon is reachable.
 * Never returns tenant data — only the count.
 */
export async function GET() {
  const tenantCount = await db.tenant.count();
  return NextResponse.json({ ok: true, tenantCount });
}
