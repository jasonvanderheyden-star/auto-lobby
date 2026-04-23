import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getTenantContext } from "@/server/tenant/context";
import { db } from "@/lib/db";

export const metadata = { title: "Calendar Connections — Auto Lobby" };

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You canceled the Google sign-in. No calendar connected.",
  missing_params: "Google's response was missing required parameters. Please try again.",
  expired_state: "Your sign-in session expired. Please try connecting again.",
  state_mismatch: "There was a security mismatch during sign-in. Please try again.",
  tenant_mismatch:
    "You switched organizations during sign-in. Please restart the connect flow from this organization.",
  exchange_failed:
    "We couldn't complete the connection with Google. Please try again in a moment.",
  missing_scope:
    "Calendar read access wasn't granted. Please try again and keep the Calendar Read scope enabled at the consent screen.",
};

const STATUS_STYLES = {
  active: { pill: "bg-emerald-100 text-emerald-800", label: "Active" },
  disconnected: { pill: "bg-stone-100 text-stone-500", label: "Disconnected" },
  token_refresh_failed: { pill: "bg-amber-100 text-amber-900", label: "Needs reconnection" },
} as const;

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function CalendarSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // 1. Auth + tenant gate
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  let ctx: Awaited<ReturnType<typeof getTenantContext>>;
  try {
    ctx = await getTenantContext();
  } catch {
    redirect("/dashboard");
  }

  // 2. Fetch calendar connections
  const connections = await db.calendarConnection.findMany({
    where: { tenantId: ctx.tenantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      provider: true,
      status: true,
      statusReason: true,
      scopes: true,
      createdAt: true,
      lastSyncedAt: true,
      connectedByUserId: true,
    },
  });

  const errorMessage = params.error
    ? (ERROR_MESSAGES[params.error] ??
      "Something went wrong connecting your calendar. Please try again.")
    : null;

  const connectLabel =
    connections.length === 0 ? "Connect Google Calendar" : "Connect another calendar";

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
          <h1 className="text-xl font-semibold text-stone-900">Calendar connections</h1>
          <p className="mt-1 text-sm text-stone-500">
            Connect your Google Calendar so Auto Lobby can detect meetings with public officials.
            We only request read access to your calendar — we never write events or modify your
            calendar.
          </p>
        </div>

        {/* Success banner */}
        {params.connected && (
          <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Connected <span className="font-medium">{params.connected}</span>. Events will begin
            syncing shortly.
          </div>
        )}

        {/* Error banner */}
        {errorMessage && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {errorMessage}
          </div>
        )}

        {/* Connections list / empty state */}
        <section className="mt-8">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-stone-200 bg-white px-6 py-14 text-center shadow-sm">
              <p className="text-sm text-stone-500">No calendars connected yet.</p>
              <a
                href="/api/oauth/google/start"
                className="mt-5 inline-block rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800"
              >
                {connectLabel}
              </a>
            </div>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
                <ul className="divide-y divide-stone-100">
                  {connections.map((conn) => {
                    const style = STATUS_STYLES[conn.status] ?? STATUS_STYLES.disconnected;
                    return (
                      <li key={conn.id} className="flex items-center justify-between gap-4 px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Provider badge */}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-xs font-bold text-stone-600">
                            G
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-stone-900 text-sm truncate">
                                {conn.email}
                              </span>
                              <span
                                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${style.pill}`}
                              >
                                {style.label}
                              </span>
                            </div>
                            {conn.statusReason && (
                              <p className="mt-0.5 text-xs text-stone-400">{conn.statusReason}</p>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-xs text-stone-400">
                            Connected {formatDate(conn.createdAt)}
                          </p>
                          <p className="mt-0.5 text-xs text-stone-400">
                            {conn.lastSyncedAt
                              ? `Last synced ${relativeTime(conn.lastSyncedAt)}`
                              : "Not yet synced"}
                          </p>
                          {/* TODO: add disconnect button here (requires token revocation at Google + row update) */}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="mt-4">
                <a
                  href="/api/oauth/google/start"
                  className="inline-block rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-800"
                >
                  {connectLabel}
                </a>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
