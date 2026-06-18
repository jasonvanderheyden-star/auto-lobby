import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { commsHaveBlankSubjects } from "./comm-utils";
import { BrandLockup } from "@/components/Brand";

interface PageProps {
  params: Promise<{ registrationNum: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { registrationNum } = await params;
  return { title: `${decodeURIComponent(registrationNum)} — Registry — Auto Lobby` };
}

export default async function RegistrationDetailPage({ params }: PageProps) {
  const { registrationNum: encodedNum } = await params;
  const registrationNum = decodeURIComponent(encodedNum);

  const registration = await db.oclPublicRegistration.findFirst({
    where: { registrationNum },
  });

  if (!registration) notFound();

  // CLIENT_ORG_CORP_NUM is the middle segment of the registration number
  // e.g. "777408-4993-4" → "4993"
  // This is the foreign key stored in OclPublicCommReport.registrationId
  const clientOrgNum = registrationNum.split("-")[1];

  const comms = clientOrgNum
    ? await db.oclPublicCommReport.findMany({
        where: { registrationId: clientOrgNum },
        orderBy: { communicationDate: "desc" },
        take: 50,
        select: {
          id: true,
          communicationDate: true,
          institution: true,
          dpohName: true,
          dpohTitle: true,
          subjects: true,
        },
      })
    : [];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <BrandLockup />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Back link */}
        <Link
          href="/registry-search"
          className="mb-6 inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900"
        >
          ← Back to search
        </Link>

        {/* Registration card */}
        <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-stone-900">{registration.companyName}</h1>
              <div className="mt-1 text-sm text-stone-400">
                {registration.registrationNum}
                {registration.registrantName && <> · {registration.registrantName}</>}
              </div>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                registration.status === "Active"
                  ? "bg-success-soft text-success-strong"
                  : "bg-stone-100 text-stone-500"
              }`}
            >
              {registration.status}
            </span>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-stone-100 pt-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-stone-400">Effective date</dt>
              <dd className="mt-0.5 font-medium text-stone-900">
                {registration.effectiveDate?.toISOString().slice(0, 10) ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-400">Registration #</dt>
              <dd className="mt-0.5 font-mono text-xs text-stone-700">{registration.registrationNum}</dd>
            </div>
          </dl>

          {registration.subjects.length > 0 && (
            <div className="mt-5 border-t border-stone-100 pt-5">
              <p className="mb-2 text-xs font-medium text-stone-400 uppercase tracking-wide">Subject matters</p>
              <div className="flex flex-wrap gap-1.5">
                {registration.subjects.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] text-stone-600"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {registration.institutions.length > 0 && (
            <div className="mt-5 border-t border-stone-100 pt-5">
              <p className="mb-2 text-xs font-medium text-stone-400 uppercase tracking-wide">
                Targeted institutions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {registration.institutions.map((inst) => (
                  <span
                    key={inst}
                    className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-800"
                  >
                    {inst}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Communications table */}
        <section className="mt-8">
          <h2 className="mb-4 text-base font-semibold text-stone-900">
            Monthly Communication Reports
            {comms.length > 0 && (
              <span className="ml-2 text-sm font-normal text-stone-400">
                ({comms.length === 50 ? "50 most recent" : comms.length})
              </span>
            )}
          </h2>
          {commsHaveBlankSubjects(comms) && (
            <p className="mt-1 mb-4 text-xs text-stone-500">
              Subject matters for recent months may show as —. OCL publishes
              subject-matter data on a slower cadence than communication
              metadata (~18-month lag). See docs/Detection-Pipeline.md §7 for
              how the classifier handles this.
            </p>
          )}

          {comms.length === 0 ? (
            <p className="text-sm text-stone-400">No communication reports on file for this client.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 bg-stone-50 text-left text-xs font-medium text-stone-400 uppercase tracking-wide">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">DPOH</th>
                    <th className="px-4 py-3">Institution</th>
                    <th className="px-4 py-3">Subjects</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {comms.map((c) => (
                    <tr key={c.id} className="hover:bg-stone-50">
                      <td className="px-4 py-3 font-mono text-xs text-stone-500 whitespace-nowrap">
                        {c.communicationDate.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-stone-900">{c.dpohName}</div>
                        {c.dpohTitle && (
                          <div className="text-xs text-stone-400">{c.dpohTitle}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-600 max-w-[200px] truncate">
                        {c.institution}
                      </td>
                      <td className="px-4 py-3">
                        {c.subjects.length === 0 ? (
                          <span className="text-[10px] text-stone-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {c.subjects.slice(0, 4).map((s) => (
                              <span
                                key={s}
                                className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500"
                              >
                                {s}
                              </span>
                            ))}
                            {c.subjects.length > 4 && (
                              <span className="text-[10px] text-stone-400">
                                +{c.subjects.length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
