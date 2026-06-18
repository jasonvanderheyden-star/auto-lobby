/**
 * /agency — minimal agency workspace (read-only + route-for-certification).
 *
 * For a signed-in AgencyMember: lists the agency's tenants (clients + the
 * firm's own tenant), with last-month draft counts, routing status, and a
 * "Route for certification" form per client tenant. Full client-switching
 * UX is later scope.
 */

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { revokeRoutingAction } from "./_actions";
import { RouteForCertificationForm } from "./_components/RouteForCertificationForm";
import { HeaderActions } from "@/components/HeaderActions";
import { BrandLockup } from "@/components/Brand";

export const metadata = { title: "Agency — Auto Lobby" };

/** Previous calendar month as "YYYY-MM" — MCRs are filed for the month past. */
function lastMonthKey(now = new Date()): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, mon - 1, 1)),
    end: new Date(Date.UTC(year, mon, 1)),
  };
}

interface TenantStats {
  pending: number;
  certified: number;
  routedToEmail: string | null;
  routingExpired: boolean;
}

interface TenantRow {
  id: string;
  name: string;
  isAgencyOwnTenant: boolean;
  stats: TenantStats;
}

interface Workspace {
  agencyId: string;
  agencyName: string;
  role: "admin" | "staff" | "consultant";
  tenants: TenantRow[];
}

async function statsForTenant(tenantId: string, month: string): Promise<TenantStats> {
  const { start, end } = monthRange(month);
  const drafts = await db.draftMcr.findMany({
    where: {
      meeting: {
        tenantId,
        classification: "lobbying",
        startAt: { gte: start, lt: end },
      },
    },
    select: {
      certifiedAt: true,
      routedForCertificationAt: true,
      routedToEmail: true,
      routingTokenExpiresAt: true,
    },
  });

  const pending = drafts.filter((d) => !d.certifiedAt).length;
  const certified = drafts.filter((d) => d.certifiedAt).length;
  const routed = drafts.find((d) => !d.certifiedAt && d.routedForCertificationAt);

  return {
    pending,
    certified,
    routedToEmail: routed?.routedToEmail ?? null,
    routingExpired: routed
      ? !routed.routingTokenExpiresAt || routed.routingTokenExpiresAt < new Date()
      : false,
  };
}

export default async function AgencyPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const memberships = await db.agencyMember.findMany({
    where: { clerkUserId: userId },
    include: {
      agency: {
        include: {
          tenants: {
            select: { id: true, name: true, isAgencyOwnTenant: true },
            orderBy: [{ isAgencyOwnTenant: "desc" }, { name: "asc" }],
          },
        },
      },
    },
  });

  const month = lastMonthKey();
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleString("en-CA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const workspaces: Workspace[] = await Promise.all(
    memberships.map(async (m) => ({
      agencyId: m.agency.id,
      agencyName: m.agency.name,
      role: m.role,
      tenants: await Promise.all(
        m.agency.tenants.map(async (t) => ({
          ...t,
          stats: await statsForTenant(t.id, month),
        })),
      ),
    })),
  );

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard">
              <BrandLockup />
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/dashboard" className="px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100">
                Dashboard
              </Link>
              <Link href="/filings" className="px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100">
                Filings
              </Link>
              <Link href="/agency" className="px-3 py-1.5 rounded-md text-stone-900 bg-stone-100 font-medium">
                Agency
              </Link>
            </nav>
          </div>
          <HeaderActions />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {workspaces.length === 0 ? (
          <section className="bg-white border border-stone-200 rounded-2xl px-6 py-16 text-center">
            <h1 className="text-lg font-semibold text-stone-900">No agency workspace</h1>
            <p className="mt-2 text-sm text-stone-500 max-w-md mx-auto">
              Your account isn&apos;t a member of any firm on this platform. If your
              firm manages client filings here, ask an agency admin to add you.
            </p>
          </section>
        ) : (
          workspaces.map((ws) => (
            <section key={ws.agencyId} className="mb-10">
              <div className="mb-4">
                <h1 className="text-[24px] font-semibold text-stone-900 leading-tight">
                  {ws.agencyName}
                </h1>
                <p className="text-sm text-stone-500 mt-1">
                  {ws.tenants.length} managed tenant{ws.tenants.length === 1 ? "" : "s"} ·
                  you are <span className="font-medium text-stone-700">{ws.role}</span> ·
                  showing {monthLabel}
                </p>
              </div>

              <div className="space-y-4">
                {ws.tenants.length === 0 && (
                  <div className="bg-white border border-stone-200 rounded-xl px-5 py-10 text-center text-sm text-stone-500">
                    No client tenants yet.
                  </div>
                )}
                {ws.tenants.map((tenant) => {
                  const { stats } = tenant;
                  const canRoute = ws.role === "admin" || ws.role === "staff";
                  return (
                    <div key={tenant.id} className="bg-white border border-stone-200 rounded-xl p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-stone-900">{tenant.name}</span>
                            {tenant.isAgencyOwnTenant && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-stone-100 text-stone-600 border-stone-200 uppercase tracking-wide">
                                Own firm
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                            <span>
                              <span className="font-semibold text-stone-800">{stats.pending}</span>{" "}
                              pending draft{stats.pending === 1 ? "" : "s"}
                            </span>
                            <span>
                              <span className="font-semibold text-emerald-800">{stats.certified}</span>{" "}
                              certified
                            </span>
                            {stats.routedToEmail ? (
                              <span className={stats.routingExpired ? "text-red-600" : "text-emerald-700"}>
                                {stats.routingExpired ? "Routing expired — " : "Routed to "}
                                {stats.routedToEmail}
                                {stats.routingExpired && " (re-route below)"}
                              </span>
                            ) : (
                              stats.pending > 0 && <span className="text-amber-700">Not yet routed</span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-stone-400">
                          Open via org switcher →{" "}
                          <span className="text-stone-500 font-medium">/filings</span>
                        </div>
                      </div>

                      {!tenant.isAgencyOwnTenant && canRoute && (
                        <div className="mt-4 pt-4 border-t border-stone-100">
                          <RouteForCertificationForm tenantId={tenant.id} tenantName={tenant.name} />
                          {stats.routedToEmail && (
                            <form action={revokeRoutingAction} className="mt-2">
                              <input type="hidden" name="tenantId" value={tenant.id} />
                              <input type="hidden" name="month" value={month} />
                              <button
                                type="submit"
                                className="text-[11px] text-stone-400 hover:text-red-600 underline underline-offset-2"
                              >
                                Revoke {monthLabel} routing (invalidates the sent link)
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                      {tenant.isAgencyOwnTenant && (
                        <p className="mt-3 text-[11px] text-stone-400">
                          In-house filings — certify in-app via /filings (no routing).
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </main>
    </div>
  );
}
