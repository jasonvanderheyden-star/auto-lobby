import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getTenantContext } from "@/server/tenant/context";
import { db } from "@/lib/db";
import { updateRegistrationAction } from "./_actions";
import { SaveButton } from "./_save-button";

export const metadata = { title: "Registration Settings — Auto Lobby" };

function formatDateForInput(d: Date | null | undefined): string {
  if (!d) return "";
  // YYYY-MM-DD for <input type="date">
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function getRenewalStatus(expiresAt: Date | null): {
  kind: "none" | "ok" | "approaching" | "urgent" | "overdue";
  daysLeft: number | null;
} {
  if (!expiresAt) return { kind: "none", daysLeft: null };
  const now = new Date();
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return { kind: "overdue", daysLeft };
  if (daysLeft < 14) return { kind: "urgent", daysLeft };
  if (daysLeft <= 60) return { kind: "approaching", daysLeft };
  return { kind: "ok", daysLeft };
}

export default async function RegistrationSettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  let ctx: Awaited<ReturnType<typeof getTenantContext>>;
  try {
    ctx = await getTenantContext();
  } catch {
    redirect("/dashboard");
  }

  const tenant = await db.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { registrationId: true, registrationExpiresAt: true },
  });

  const status = getRenewalStatus(tenant?.registrationExpiresAt ?? null);
  const expiresAt = tenant?.registrationExpiresAt ?? null;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 text-[13px] font-bold text-white">
              AL
            </div>
            <span className="font-semibold text-stone-900">Auto Lobby</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {/* Back link */}
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900"
        >
          ← Back to dashboard
        </Link>

        {/* Page title */}
        <div className="mt-4">
          <h1 className="text-xl font-semibold text-stone-900">Registration settings</h1>
          <p className="mt-1 text-sm text-stone-500">
            Manage your OCL registration ID and annual renewal deadline. Auto Lobby will surface
            renewal warnings when your registration is approaching expiry.
          </p>
        </div>

        {/* Settings tabs */}
        <nav className="mt-6 flex gap-1 border-b border-stone-200">
          <Link
            href="/settings/calendars"
            className="px-4 py-2 text-sm text-stone-500 hover:text-stone-900"
          >
            Calendars
          </Link>
          <span className="px-4 py-2 text-sm font-medium text-stone-900 border-b-2 border-emerald-700 -mb-px">
            Registration
          </span>
        </nav>

        {/* Form card */}
        <section className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-900">OCL registration</h2>
            <p className="mt-0.5 text-xs text-stone-500">
              Your registration ID appears on all Monthly Communication Reports filed with the
              Lobbyists Registration System.
            </p>
          </div>

          <form action={updateRegistrationAction} className="px-6 py-6 space-y-5">
            {/* Registration ID */}
            <div>
              <label
                htmlFor="registrationId"
                className="block text-sm font-medium text-stone-700 mb-1.5"
              >
                Registration ID
              </label>
              <input
                id="registrationId"
                name="registrationId"
                type="text"
                placeholder="e.g. 123456789"
                defaultValue={tenant?.registrationId ?? ""}
                maxLength={50}
                className="block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="mt-1 text-xs text-stone-400">
                Find your registration ID on your OCL registration at{" "}
                <a
                  href="https://lobbycanada.gc.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-700 hover:underline"
                >
                  lobbycanada.gc.ca
                </a>
                .
              </p>
            </div>

            {/* Annual renewal date */}
            <div>
              <label
                htmlFor="registrationExpiresAt"
                className="block text-sm font-medium text-stone-700 mb-1.5"
              >
                Annual renewal date
              </label>
              <input
                id="registrationExpiresAt"
                name="registrationExpiresAt"
                type="date"
                defaultValue={formatDateForInput(tenant?.registrationExpiresAt)}
                className="block w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-900 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="mt-1 text-xs text-stone-400">
                The anniversary date of your registration — same date each year. Auto Lobby will
                warn you 60 days before this date.
              </p>
            </div>

            <div className="pt-1">
              <SaveButton />
            </div>
          </form>
        </section>

        {/* Renewal status */}
        <section className="mt-6 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="px-6 py-5 border-b border-stone-100">
            <h2 className="text-sm font-semibold text-stone-900">Renewal status</h2>
          </div>
          <div className="px-6 py-5">
            {status.kind === "none" && (
              <p className="text-sm text-stone-400">
                No renewal date set — add your registration&apos;s anniversary date above to get
                renewal reminders.
              </p>
            )}

            {status.kind === "ok" && expiresAt && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Renewal due {formatDisplayDate(expiresAt)}
              </span>
            )}

            {status.kind === "approaching" && expiresAt && status.daysLeft !== null && (
              <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Renewal due {formatDisplayDate(expiresAt)} — {status.daysLeft} days remaining
              </span>
            )}

            {status.kind === "urgent" && expiresAt && status.daysLeft !== null && status.daysLeft >= 0 && (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Renewal due in {status.daysLeft} day{status.daysLeft === 1 ? "" : "s"} —{" "}
                <a
                  href="https://lobbycanada.gc.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  file at canada.ca/lobbyists
                </a>
              </span>
            )}

            {status.kind === "overdue" && expiresAt && (
              <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm font-medium text-red-800">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                Renewal overdue since {formatDisplayDate(expiresAt)} —{" "}
                <a
                  href="https://lobbycanada.gc.ca"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  file at canada.ca/lobbyists
                </a>
              </span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
