/**
 * /certify/[token] — public routed-certification page.
 *
 * No Clerk auth: the single-use routing token (issued by
 * routeBatchForCertification, 256-bit, hashed at rest, 14-day TTL) is the
 * authorization. The client's Responsible Officer reviews the month's draft
 * MCRs read-only, then attests and certifies — non-negotiable #1.
 *
 * Branding is white-label aware: tenant fields fall back to the managing
 * agency's defaults, then to the platform default. Always rendered through
 * variables, never hardcoded (non-negotiable #7).
 */

import { findRoutedBatchByToken } from "@/server/filing-engine/route-for-certification";
import { getSubjectName } from "@/lib/ocl-subjects";
import { CertifyForm } from "./_components/CertifyForm";

export const metadata = { title: "Certify Monthly Communication Reports" };

const PLATFORM_DEFAULTS = {
  productName: "Auto Lobby",
  brandColor: "#5B6CF0", // periwinkle
  logoUrl: null as string | null,
  supportEmail: null as string | null,
};

interface PageProps {
  params: Promise<{ token: string }>;
}

type SubjectEntry = { oclCode?: number; subjectId?: string; source: string };
type ProvenanceEntry = { value?: unknown; source?: string; confidence?: number };

export default async function RoutedCertificationPage({ params }: PageProps) {
  const { token } = await params;
  const batch = await findRoutedBatchByToken(token);

  if (!batch) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-6">
        <div className="max-w-md w-full bg-white border border-stone-200 rounded-2xl p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-stone-100 flex items-center justify-center text-stone-500 text-xl">
            !
          </div>
          <h1 className="mt-4 text-lg font-semibold text-stone-900">
            This certification link is no longer valid
          </h1>
          <p className="mt-2 text-sm text-stone-600 leading-relaxed">
            The link may have expired, been revoked, or already been used to
            certify. Please contact the firm that prepared your reports to
            request a new link.
          </p>
        </div>
      </div>
    );
  }

  const { tenant, drafts, month, expiresAt } = batch;
  const productName =
    tenant.productName ?? tenant.agency?.productName ?? PLATFORM_DEFAULTS.productName;
  const brandColor =
    tenant.brandColor ?? tenant.agency?.brandColor ?? PLATFORM_DEFAULTS.brandColor;
  const logoUrl =
    tenant.logoUrl ?? tenant.agency?.logoUrl ?? PLATFORM_DEFAULTS.logoUrl;
  const supportEmail =
    tenant.supportEmail ?? tenant.agency?.supportEmail ?? PLATFORM_DEFAULTS.supportEmail;

  const [year, mon] = month.split("-").map(Number) as [number, number];
  const monthLabel = new Date(Date.UTC(year, mon - 1, 1)).toLocaleString(
    "en-CA",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center gap-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote white-label logo, unknown host
            <img src={logoUrl} alt={productName} className="h-7 w-auto rounded" />
          ) : (
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center text-white font-bold text-[13px]"
              style={{ backgroundColor: brandColor }}
            >
              {productName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="font-semibold text-stone-900">{productName}</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide text-white"
            style={{ backgroundColor: brandColor }}
          >
            Certification requested
          </span>
          <h1 className="mt-3 text-[26px] font-semibold text-stone-900 leading-tight">
            {monthLabel} — {drafts.length} Monthly Communication Report
            {drafts.length === 1 ? "" : "s"} for {tenant.name}
          </h1>
          <p className="mt-2 text-stone-600 max-w-2xl">
            Review each report below, then certify at the bottom of the page.
            This link is single-use and expires on{" "}
            {expiresAt.toLocaleDateString("en-CA", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            .
          </p>
        </div>

        <ul className="space-y-4">
          {drafts.map((d) => {
            const meetingDate = d.meeting.startAt;
            const dpohs = d.meeting.attendees.filter((a) => a.isDpoh === true);
            const subjects = Array.isArray(d.subjects)
              ? (d.subjects as SubjectEntry[])
              : [];
            const provenance =
              d.provenance && typeof d.provenance === "object"
                ? (d.provenance as Record<string, ProvenanceEntry>)
                : {};
            const institutionLabel = d.meeting.institution
              ? `${d.meeting.institution.name}${d.meeting.institution.acronym ? ` (${d.meeting.institution.acronym})` : ""}`
              : "(institution unknown)";

            return (
              <li
                key={d.id}
                className="bg-white border border-stone-200 rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-stone-900">
                      {d.meeting.title}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {meetingDate.toLocaleDateString("en-CA", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        timeZone: "UTC",
                      })}{" "}
                      · {institutionLabel}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  <div>
                    <FieldLabel>
                      Designated public office holder{dpohs.length === 1 ? "" : "s"}
                    </FieldLabel>
                    {dpohs.length === 0 ? (
                      <p className="text-xs text-stone-400">
                        (none confirmed on this meeting)
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {dpohs.map((a) => (
                          <li key={a.id} className="text-sm text-stone-800">
                            {a.name}
                            <span className="text-stone-400 text-xs">
                              {" "}
                              · {institutionLabel}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <FieldLabel>Subject matters</FieldLabel>
                    <div className="flex flex-wrap gap-1.5">
                      {subjects.length === 0 && (
                        <span className="text-xs text-stone-400">(none)</span>
                      )}
                      {subjects.map((s, i) => {
                        const code =
                          s.oclCode != null ? Number(s.oclCode) : undefined;
                        const display = code
                          ? getSubjectName(code)
                          : (s.subjectId ?? `Subject ${i + 1}`);
                        return (
                          <span
                            key={code ?? s.subjectId ?? i}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-stone-50 text-stone-800 border-stone-200"
                          >
                            {display}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="sm:col-span-2">
                    <FieldLabel>How these fields were filled</FieldLabel>
                    <ul className="space-y-0.5">
                      {Object.entries(provenance).map(([field, p]) => (
                        <li key={field} className="text-xs text-stone-500">
                          <span className="text-stone-700 font-medium">
                            {field}
                          </span>{" "}
                          — {p.source ?? "unknown source"}
                          {typeof p.confidence === "number" && (
                            <span className="text-stone-400">
                              {" "}
                              · {Math.round(p.confidence * 100)}% confidence
                            </span>
                          )}
                        </li>
                      ))}
                      {Object.keys(provenance).length === 0 && (
                        <li className="text-xs text-stone-400">
                          (no provenance recorded)
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <CertifyForm
          token={token}
          count={drafts.length}
          monthLabel={monthLabel}
          tenantName={tenant.name}
          brandColor={brandColor}
        />

        <footer className="pt-2 pb-10 text-center text-xs text-stone-400">
          Questions about these reports?{" "}
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`} className="underline">
              {supportEmail}
            </a>
          ) : (
            <span>Contact the firm that sent you this link.</span>
          )}
        </footer>
      </main>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wide text-stone-500 mb-1.5">
      {children}
    </div>
  );
}
