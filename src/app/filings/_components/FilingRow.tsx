"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { getSubjectName } from "@/lib/ocl-subjects";
import { confirmDpohAction, excludeMeetingAction, resetAttendeeAction } from "../_actions";
import {
  EngagementBadge,
  EngagementPanel,
  type EngagementOption,
  type WhySignal,
} from "./EngagementChip";

function SubmitButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? "Saving…" : children}
    </button>
  );
}

type Attendee = {
  id: string;
  name: string;
  email: string;
  isInternal: boolean;
  isDpoh: boolean | null;
};
type Reason = {
  id: string;
  ok: boolean | null;
  text: string;
  citation: string | null;
};
type Institution = { name: string; acronym: string | null } | null;
type Subject = { oclCode?: number; subjectId?: string; source: string };
type RoleHint = { role: string; isDpoh: boolean };

interface Draft {
  id: string;
  subjects: Subject[];
  provenance: Record<string, { value: unknown; source: string; confidence: number }>;
  meeting: {
    id: string;
    title: string;
    startAt: string;
    classification: string;
    attendees: Attendee[];
    reasons: Reason[];
    institution: Institution;
    // Consultant client attribution (agency-own tenants only)
    engagementId?: string | null;
    engagementSource?: string | null;
    engagementConfidence?: number | null;
    engagement?: { id: string; clientName: string } | null;
  };
}

// Prominent section header with coloured left border
function GroupHeader({
  label,
  count,
  accent,
  badge,
  badgeClass,
}: {
  label: string;
  count: number;
  accent: string; // Tailwind border-color class
  badge?: string;
  badgeClass?: string;
}) {
  return (
    <div className={`flex items-center gap-3 pl-3 border-l-2 ${accent} mb-2`}>
      <span className="text-xs font-semibold text-stone-800">{label}</span>
      <span className="text-[11px] text-stone-400">{count}</span>
      {badge && (
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badgeClass}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

export function FilingRow({
  draft,
  roleHints = {},
  agencyMode = false,
  engagements = [],
  engagementWhy,
}: {
  draft: Draft;
  roleHints?: Record<string, RoleHint[]>;
  /** True on agency-own tenants — shows client-attribution chip + controls. */
  agencyMode?: boolean;
  engagements?: EngagementOption[];
  engagementWhy?: WhySignal[] | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const m = draft.meeting;
  const meetingEngagement = {
    engagementId: m.engagementId ?? null,
    engagementSource: m.engagementSource ?? null,
    engagementConfidence: m.engagementConfidence ?? null,
    engagement: m.engagement ?? null,
  };
  const isLobbying = m.classification === "lobbying";
  const internalAttendee = m.attendees.find((a) => a.isInternal);
  const date = new Date(m.startAt);
  const dateLabel = `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}`;

  const isGov = (a: Attendee) =>
    !a.isInternal && !!a.email && /\.(gc|parl)\.ca$/i.test(a.email);

  return (
    <li>
      {/* ── Collapsed row ── */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-stone-50 text-left"
      >
        <svg
          className={`w-3.5 h-3.5 text-stone-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M7 5l6 5-6 5V5Z" />
        </svg>
        <div className="w-16 text-xs text-stone-500 shrink-0">{dateLabel}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-stone-900 truncate">{m.title}</div>
          <div className="text-xs text-stone-500 truncate mt-0.5">
            {internalAttendee?.name ?? "?"} · {m.institution?.name ?? "(institution unknown)"}
          </div>
        </div>
        {agencyMode && (
          <div className="shrink-0">
            <EngagementBadge me={meetingEngagement} />
          </div>
        )}
        <div className="shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium text-xs ${
              isLobbying
                ? "bg-success-soft text-success-strong border border-success"
                : "bg-amber-50 text-amber-900 border border-amber-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isLobbying ? "bg-success" : "bg-amber-500"}`} />
            {isLobbying ? "Auto-drafted" : "Needs input"}
          </span>
        </div>
      </button>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="px-5 pb-6 pl-[76px] bg-stone-50/40 border-t border-stone-100">
          <div className="grid grid-cols-2 gap-x-8 gap-y-5 pt-4">

            {/* Institution + Date */}
            <Field label="Institution" value={m.institution?.name ?? "(unknown)"} />
            <Field label="Date" value={date.toISOString().slice(0, 10)} />

            {/* Client attribution (agency-own tenants) */}
            {agencyMode && (
              <EngagementPanel
                meetingId={m.id}
                me={meetingEngagement}
                engagements={engagements}
                why={engagementWhy}
              />
            )}

            {/* ── Attendees ── */}
            {(() => {
              const yourTeam   = m.attendees.filter((a) => a.isInternal);
              const govDpoh    = m.attendees.filter((a) => isGov(a) && a.isDpoh === true);
              const govUnknown = m.attendees.filter((a) => isGov(a) && a.isDpoh === null);
              const govDenied  = m.attendees.filter((a) => isGov(a) && a.isDpoh === false);
              const other      = m.attendees.filter((a) => !a.isInternal && !isGov(a));

              return (
                <div className="col-span-2 space-y-4">
                  <FieldLabel>Attendees ({m.attendees.length})</FieldLabel>

                  {m.attendees.length === 0 && (
                    <p className="text-xs text-stone-400">(no attendees on this event)</p>
                  )}

                  {/* Your Team */}
                  {yourTeam.length > 0 && (
                    <div>
                      <GroupHeader label="Your Team" count={yourTeam.length} accent="border-stone-300" />
                      <div className="space-y-1">
                        {yourTeam.map((a) => (
                          <div key={a.id} className="flex items-center gap-2 text-sm">
                            <span className="text-stone-800 font-medium">{a.name}</span>
                            <span className="text-stone-400 text-xs">{a.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Government — DPOH */}
                  {govDpoh.length > 0 && (
                    <div>
                      <GroupHeader
                        label="Government — DPOH"
                        count={govDpoh.length}
                        accent="border-amber-400"
                        badge="Confirmed DPOH"
                        badgeClass="bg-amber-100 text-amber-900 border-amber-300"
                      />
                      <div className="space-y-1.5">
                        {govDpoh.map((a) => {
                          const hints = a.email ? roleHints[a.email] : undefined;
                          return (
                            <div key={a.id} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="text-stone-800 font-medium">{a.name}</span>
                                  <span className="text-stone-400 text-xs truncate">{a.email}</span>
                                </div>
                                {hints && hints.length > 0 && (
                                  <div className="text-[11px] text-stone-400 mt-0.5">
                                    OCL: {hints.map((h, i) => (
                                      <span key={i}>{i > 0 && "; "}{h.role}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <form action={resetAttendeeAction} className="shrink-0">
                                <input type="hidden" name="meetingId" value={m.id} />
                                <input type="hidden" name="attendeeEmail" value={a.email} />
                                <SubmitButton className="text-[11px] px-2.5 py-1 rounded border border-stone-200 text-stone-500 hover:bg-white hover:text-stone-700 disabled:opacity-40">
                                  Undo
                                </SubmitButton>
                              </form>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Government — Status Unknown */}
                  {govUnknown.length > 0 && (
                    <div>
                      <GroupHeader
                        label="Government — Status Unknown"
                        count={govUnknown.length}
                        accent="border-amber-300"
                        badge="Needs review"
                        badgeClass="bg-amber-50 text-amber-800 border-amber-200"
                      />
                      <div className="space-y-2">
                        {govUnknown.map((a) => {
                          const hints = a.email ? roleHints[a.email] : undefined;
                          return (
                            <div key={a.id} className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm">
                                  <span className="text-stone-800 font-medium">{a.name}</span>
                                  <span className="text-stone-400 text-xs truncate">{a.email}</span>
                                </div>
                                {hints && hints.length > 0 && (
                                  <div className="text-[11px] text-stone-400 mt-0.5">
                                    OCL: {hints.map((h, i) => (
                                      <span key={i}>
                                        {i > 0 && "; "}{h.role}
                                        {h.isDpoh && <span className="ml-1 font-semibold text-amber-700">DPOH</span>}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-1.5 shrink-0">
                                <form action={confirmDpohAction}>
                                  <input type="hidden" name="meetingId" value={m.id} />
                                  <input type="hidden" name="attendeeEmail" value={a.email} />
                                  <SubmitButton className="text-[11px] px-2.5 py-1 rounded bg-emerald-700 text-white font-medium hover:bg-emerald-800 disabled:opacity-40">
                                    ✓ DPOH
                                  </SubmitButton>
                                </form>
                                <form action={excludeMeetingAction}>
                                  <input type="hidden" name="meetingId" value={m.id} />
                                  <input type="hidden" name="attendeeEmail" value={a.email} />
                                  <SubmitButton className="text-[11px] px-2.5 py-1 rounded border border-stone-200 text-stone-600 hover:bg-white disabled:opacity-40">
                                    Not DPOH
                                  </SubmitButton>
                                </form>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Government — Not a DPOH */}
                  {govDenied.length > 0 && (
                    <div>
                      <GroupHeader
                        label="Government — Not a DPOH"
                        count={govDenied.length}
                        accent="border-stone-200"
                      />
                      <div className="space-y-1.5">
                        {govDenied.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-3 opacity-50">
                            <div className="flex items-center gap-2 text-sm min-w-0">
                              <span className="text-stone-600">{a.name}</span>
                              <span className="text-stone-400 text-xs truncate">{a.email}</span>
                            </div>
                            <form action={resetAttendeeAction} className="shrink-0">
                              <input type="hidden" name="meetingId" value={m.id} />
                              <input type="hidden" name="attendeeEmail" value={a.email} />
                              <SubmitButton className="text-[11px] px-2.5 py-1 rounded border border-stone-200 text-stone-500 hover:bg-white hover:opacity-100 disabled:opacity-40">
                                Undo
                              </SubmitButton>
                            </form>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Other Attendees */}
                  {other.length > 0 && (
                    <div>
                      <GroupHeader label="Other Attendees" count={other.length} accent="border-stone-200" />
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5">
                        {other.map((a) => (
                          <div key={a.id} className="text-xs text-stone-500 truncate" title={a.email}>
                            {a.name} · <span className="text-stone-400">{a.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Subjects */}
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1.5">
                <FieldLabel>Subjects (pre-filled)</FieldLabel>
                <Link href={`/filings/${draft.id}/subjects`} className="text-xs text-emerald-700 hover:underline">
                  Edit subjects →
                </Link>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(draft.subjects ?? []).map((s, i) => {
                  const code = s.oclCode ? Number(s.oclCode) : undefined;
                  const display = code ? getSubjectName(code) : (s.subjectId ?? `Subject ${i + 1}`);
                  const key = code ?? s.subjectId ?? i;
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border bg-emerald-50 text-emerald-900 border-emerald-200"
                      title={`OCL code: ${code ?? "legacy"} · Source: ${s.source}`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-stone-400" />
                      {display}
                    </span>
                  );
                })}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">From org-profile defaults (level-0).</div>
            </div>

            {/* Classification reasoning */}
            <div className="col-span-2">
              <FieldLabel>Why was this classified this way?</FieldLabel>
              <div className="space-y-1">
                {m.reasons.map((r) => (
                  <div key={r.id} className="text-xs text-stone-700">
                    <span className={r.ok === true ? "text-success-strong" : r.ok === false ? "text-stone-400" : "text-amber-600"}>
                      {r.ok === true ? "+" : r.ok === false ? "−" : "?"}
                    </span>{" "}
                    {r.text}
                    {r.citation && <span className="text-stone-400"> [{r.citation}]</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Exclude meeting — tertiary, bottom-right */}
          <div className="mt-5 flex justify-end">
            <form action={excludeMeetingAction}>
              <input type="hidden" name="meetingId" value={m.id} />
              <SubmitButton className="text-xs px-3 py-1.5 rounded border border-stone-200 text-stone-500 hover:bg-white hover:text-stone-700 disabled:opacity-40">
                {isLobbying ? "Exclude from filing" : "Exclude this meeting entirely"}
              </SubmitButton>
            </form>
          </div>
        </div>
      )}
    </li>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-stone-500 mb-1.5">{children}</div>;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="text-sm text-stone-900">{value}</div>
    </div>
  );
}
