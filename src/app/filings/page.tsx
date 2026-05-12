import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";
import { FilingRow } from "./_components/FilingRow";
import { certifyBatchAction } from "./_actions";

const DEFAULT_SUBJECTS_FOR_DEEP_SKY = [
  "Environment",
  "Climate Change",
  "Energy",
  "Science and Technology",
  "Industry",
];

export const metadata = { title: "Filings — Auto Lobby" };

export default async function FilingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const ctx = await getTenantContext();
  if (!ctx) redirect("/dashboard");

  const drafts = await db.draftMcr.findMany({
    where: { meeting: { tenantId: ctx.tenantId } },
    include: {
      meeting: {
        include: {
          attendees: true,
          reasons: true,
          institution: { select: { name: true, acronym: true } },
        },
      },
    },
    orderBy: { meeting: { startAt: "desc" } },
  });

  const [totalRawEvents, govAttendees, dpohConfirmed, internalEmployees, tenant] = await Promise.all([
    db.rawCalendarEvent.count({ where: { tenantId: ctx.tenantId } }),
    db.meetingAttendee.count({
      where: {
        meeting: { tenantId: ctx.tenantId },
        isInternal: false,
        OR: [{ email: { contains: ".gc.ca" } }, { email: { contains: ".parl.ca" } }],
      },
    }),
    db.detectedMeeting.count({ where: { tenantId: ctx.tenantId, hadDpoh: true } }),
    db.meetingAttendee.findMany({
      where: { meeting: { tenantId: ctx.tenantId }, isInternal: true },
      select: { email: true, name: true },
      distinct: ["email"],
      take: 20,
    }),
    db.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { name: true, industry: true, registrationId: true },
    }),
  ]);

  const lobbyingCount = drafts.filter((d) => d.meeting.classification === "lobbying").length;
  const needsInfoCount = drafts.filter((d) => d.meeting.classification === "needs-info").length;

  // Build a map of email -> potential role hints from OCL historical data.
  // Only fires for needs-info gov attendees where name matches a known PublicOfficial.
  type RoleHint = { role: string; isDpoh: boolean };
  const roleHints: Record<string, RoleHint[]> = {};

  const uniqueGovAttendees = new Map<string, { name: string; institutionId: string | null }>();
  for (const d of drafts) {
    if (d.meeting.classification !== "needs-info") continue;
    for (const a of d.meeting.attendees) {
      if (a.isInternal || !a.email) continue;
      if (!/\.(gc|parl)\.ca$/i.test(a.email)) continue;
      if (!uniqueGovAttendees.has(a.email)) {
        uniqueGovAttendees.set(a.email, { name: a.name, institutionId: d.meeting.institutionId });
      }
    }
  }

  for (const [email, { name, institutionId }] of uniqueGovAttendees) {
    if (!institutionId) continue;
    const matches = await db.publicOfficial.findMany({
      where: {
        name: { equals: name, mode: "insensitive" },
        institutionId,
      },
      select: { role: true, isDpoh: true },
      take: 5,
    });
    if (matches.length > 0) {
      const seen = new Set<string>();
      roleHints[email] = matches.filter((m) => {
        if (seen.has(m.role)) return false;
        seen.add(m.role);
        return true;
      });
    }
  }

  const totalFields = drafts.length * 4;
  let highConfidenceFields = 0;
  for (const d of drafts) {
    const prov = (d.provenance ?? {}) as Record<string, { confidence?: number }>;
    if ((prov.subjects?.confidence ?? 0) >= 0.6) highConfidenceFields++;
    if ((prov.institutionId?.confidence ?? 0) >= 0.6) highConfidenceFields++;
    if ((prov.namedLobbyists?.confidence ?? 0) >= 0.6) highConfidenceFields++;
    if ((prov.communicationDate?.confidence ?? 0) >= 0.6) highConfidenceFields++;
  }
  const autoFillPct = totalFields > 0 ? Math.round((highConfidenceFields / totalFields) * 100) : 0;

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 flex items-center justify-center text-white font-bold text-[13px]">
                AL
              </div>
              <span className="font-semibold text-stone-900">Auto Lobby</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/dashboard" className="px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100">
                Dashboard
              </Link>
              <Link href="/filings" className="px-3 py-1.5 rounded-md text-stone-900 bg-stone-100 font-medium">
                Filings
              </Link>
              <Link href="/settings/calendars" className="px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100">
                Settings
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <section className="grid grid-cols-3 gap-6 mb-6">
          <div className="col-span-2 bg-white border border-stone-200 rounded-2xl p-6 relative overflow-hidden">
            <div className="absolute -top-16 -right-16 w-64 h-64 bg-gradient-to-br from-emerald-100/70 to-teal-100/30 rounded-full blur-3xl"></div>
            <div className="relative">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wide">
                  {lobbyingCount > 0 ? "Ready to certify" : needsInfoCount > 0 ? "Needs your input" : "All clear"}
                </span>
              </div>
              <h1 className="text-[28px] font-semibold text-stone-900 leading-tight">
                {drafts.length} pre-drafted MCR{drafts.length === 1 ? "" : "s"}
              </h1>
              <p className="text-stone-600 mt-2 max-w-2xl">
                Auto Lobby scanned {totalRawEvents.toLocaleString()} calendar events, cross-checked attendees against
                the DPOH registry, and pre-drafted MCRs for every meeting that may be reportable lobbying.
              </p>

              <div className="flex items-center gap-3 mt-5">
                <form action={certifyBatchAction}>
                  <button
                    type="submit"
                    className="text-[15px] px-5 py-2.5 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 shadow-sm disabled:opacity-40 disabled:hover:bg-emerald-700"
                    disabled={lobbyingCount === 0}
                    title={lobbyingCount === 0 ? "No lobbying meetings to certify" : "Certify and submit all (stub — LRS submission lands in Phase 4)"}
                  >
                    Certify &amp; submit {lobbyingCount} →
                  </button>
                </form>
                <button className="text-sm px-4 py-2.5 rounded-lg border border-stone-200 hover:bg-stone-50">
                  Review individually first
                </button>
              </div>

              <div className="mt-6 pt-5 border-t border-stone-100 grid grid-cols-5 gap-4">
                <Stat label="Meetings scanned" value={totalRawEvents.toLocaleString()} />
                <Stat label="Gov. attendees detected" value={govAttendees.toLocaleString()} />
                <Stat label="DPOHs confirmed" value={dpohConfirmed.toLocaleString()} accent />
                <Stat label="Classified as lobbying" value={lobbyingCount.toLocaleString()} accent />
                <Stat label="Your time spent" value="0 min" />
              </div>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-3">Org profile</div>
            <div className="text-base font-semibold text-stone-900">{tenant?.name ?? "—"}</div>
            <div className="text-sm text-stone-600">{tenant?.industry ?? "—"}</div>
            {tenant?.registrationId && (
              <div className="mt-2 text-xs text-stone-500">Registration: {tenant.registrationId}</div>
            )}

            <div className="mt-4 pt-4 border-t border-stone-100 space-y-3">
              <div>
                <div className="text-xs text-stone-500 mb-1.5">
                  Default subjects <span className="text-stone-400">· used for auto-fill</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {DEFAULT_SUBJECTS_FOR_DEEP_SKY.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] px-1.5 py-0.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 mb-1.5">Internal email{internalEmployees.length === 1 ? "" : "s"} tracked</div>
                <div className="text-sm text-stone-700">{internalEmployees.length}</div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-stone-100">
              <div className="text-xs text-stone-500 mb-1">Auto-fill coverage this batch</div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-600" style={{ width: `${autoFillPct}%` }}></div>
                </div>
                <span className="text-sm font-semibold text-stone-900">{autoFillPct}%</span>
              </div>
              <div className="text-[11px] text-stone-500 mt-1">of fields filled without asking you</div>
            </div>
          </div>
        </section>

        {needsInfoCount > 0 && (
          <section className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-800 text-lg font-bold shrink-0">
              !
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-900">
                {needsInfoCount} {needsInfoCount === 1 ? "meeting needs" : "meetings need"} your input before certification
              </div>
              <div className="text-sm text-amber-900/90 mt-0.5">
                These meetings have federal attendees at DPOH-source institutions, but Auto Lobby couldn&apos;t confirm
                their roles. Open each one below — confirm whether the gov attendee is a DPOH, and the classification
                will update.
              </div>
            </div>
          </section>
        )}

        <section className="bg-white border border-stone-200 rounded-xl overflow-hidden mb-24">
          <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold text-stone-900">
                {drafts.length} pre-drafted MCR{drafts.length === 1 ? "" : "s"}
              </h2>
              <span className="text-xs text-stone-500">Click any row to see provenance</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Auto-confirmed lobbying
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Needs your input
              </span>
            </div>
          </div>

          {drafts.length === 0 ? (
            <div className="px-5 py-12 text-center text-stone-500 text-sm">
              No drafts yet. Connect a calendar and let the classifier sweep your events.
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {drafts.map((d) => (
                <FilingRow
                  key={d.id}
                  draft={JSON.parse(JSON.stringify(d))}
                  roleHints={roleHints}
                />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`text-xl font-semibold ${accent ? "text-emerald-800" : "text-stone-900"}`}>{value}</div>
    </div>
  );
}
