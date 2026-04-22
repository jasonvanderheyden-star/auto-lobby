import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { OrgSwitcher } from "./org-switcher";

export const metadata = { title: "Dashboard — Auto Lobby" };

export default async function DashboardPage() {
  const { userId, orgId } = await auth();

  if (!userId) redirect("/sign-in");
  if (!orgId) redirect("/onboarding/create-organization");

  const [user, tenant] = await Promise.all([
    currentUser(),
    db.tenant.findUnique({ where: { clerkOrgId: orgId } }),
  ]);

  const primaryEmail = user?.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId,
  )?.emailAddress;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 text-[13px] font-bold text-white">
                AL
              </div>
              <span className="font-semibold text-stone-900">Auto Lobby</span>
            </div>
            <nav className="flex items-center gap-1 text-sm">
              <a className="rounded-md bg-stone-100 px-3 py-1.5 font-medium text-stone-900" href="#">
                Dashboard
              </a>
              <Link
                className="rounded-md px-3 py-1.5 text-stone-600 hover:bg-stone-100"
                href="/registry-search"
              >
                Registry
              </Link>
            </nav>
          </div>
          <OrgSwitcher />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-stone-900">
          Hello, {user?.firstName ?? primaryEmail ?? "there"}
        </h1>
        {tenant && (
          <p className="mt-1 text-sm text-stone-500">
            Signed in as <span className="font-medium text-stone-700">{primaryEmail}</span> ·{" "}
            <span className="font-medium text-stone-700">{tenant.name}</span>
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {/* Identity card */}
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-stone-400 uppercase">
              Clerk Identity
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">User ID</dt>
                <dd className="truncate font-mono text-xs text-stone-700">{userId}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Email</dt>
                <dd className="text-stone-700">{primaryEmail ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-stone-500">Org ID</dt>
                <dd className="truncate font-mono text-xs text-stone-700">{orgId}</dd>
              </div>
            </dl>
          </div>

          {/* Tenant card */}
          <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-stone-400 uppercase">
              Tenant Row (DB)
            </h2>
            {tenant ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Tenant ID</dt>
                  <dd className="truncate font-mono text-xs text-stone-700">{tenant.id}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Name</dt>
                  <dd className="text-stone-700">{tenant.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Jurisdiction</dt>
                  <dd className="text-stone-700">{tenant.jurisdiction}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-stone-500">Created</dt>
                  <dd className="text-stone-700">{tenant.createdAt.toISOString().slice(0, 10)}</dd>
                </div>
              </dl>
            ) : (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-medium">Tenant not yet synced</p>
                <p className="mt-0.5 text-xs text-amber-700">
                  The Clerk webhook hasn&apos;t delivered the organization.created event yet.
                  Check that CLERK_WEBHOOK_SECRET is set and the webhook endpoint is registered.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
