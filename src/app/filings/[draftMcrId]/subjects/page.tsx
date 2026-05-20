import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getTenantContext } from "@/server/tenant/context";
import { SubjectPicker } from "@/components/subject-picker";

interface PageProps {
  params: Promise<{ draftMcrId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { draftMcrId } = await params;
  return { title: `Edit subjects — ${draftMcrId} — Auto Lobby` };
}

export default async function SubjectsPage({ params }: PageProps) {
  const { draftMcrId } = await params;

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const ctx = await getTenantContext();
  if (!ctx) redirect("/dashboard");

  const draft = await db.draftMcr.findFirst({
    where: { id: draftMcrId, meeting: { tenantId: ctx.tenantId } },
    select: {
      id: true,
      subjects: true,
      meeting: {
        select: {
          title: true,
          startAt: true,
          classification: true,
          attendees: { select: { name: true, email: true, isInternal: true, isDpoh: true } },
          institution: { select: { name: true, acronym: true } },
        },
      },
    },
  });
  if (!draft) redirect("/filings");

  const m = draft.meeting;
  const dateLabel = m.startAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  type SubjectRow = { subjectId: string; source: string };
  const currentSubjects = (draft.subjects ?? []) as SubjectRow[];
  const initialSelectedIds = currentSubjects.map((s) => s.subjectId);

  const internalAttendee = m.attendees.find((a) => a.isInternal);
  const dpohAttendees = m.attendees.filter((a) => a.isDpoh === true);

  return (
    <div className="min-h-screen bg-stone-50 pb-28">
      {/* Nav */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-8">
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
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-stone-500 mb-6">
          <Link href="/filings" className="hover:text-stone-800">
            Filings
          </Link>
          <span>/</span>
          <span className="text-stone-800">Edit subjects</span>
        </div>

        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900">Edit subject matters</h1>
          <p className="text-stone-600 mt-1">
            Select every subject matter discussed. Your choices will update the pre-drafted MCR.
          </p>
        </div>

        {/* Meeting summary card */}
        <section className="bg-white border border-stone-200 rounded-xl p-5 mb-6">
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide mb-2">Meeting</div>
          <div className="text-base font-semibold text-stone-900">{m.title}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-stone-600">
            <span>{dateLabel}</span>
            {m.institution && (
              <span>{m.institution.name}</span>
            )}
            {dpohAttendees.length > 0 && (
              <span className="text-amber-700 font-medium">
                {dpohAttendees.length} DPOH{dpohAttendees.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {internalAttendee && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-900 text-xs rounded-md border border-emerald-200 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                {internalAttendee.name}
              </span>
            )}
            {dpohAttendees.map((a) => (
              <span
                key={a.email}
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-900 text-xs rounded-md border border-amber-200 font-medium"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                {a.name}
                <span className="text-amber-700">· DPOH</span>
              </span>
            ))}
          </div>
        </section>

        {/* Subject picker */}
        <SubjectPicker draftMcrId={draft.id} initialSelectedIds={initialSelectedIds} />
      </main>
    </div>
  );
}
