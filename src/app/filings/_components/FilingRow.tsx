"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { confirmDpohAction, excludeMeetingAction } from "../_actions";

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
type Subject = { subjectId: string; source: string };

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
  };
}

export function FilingRow({ draft }: { draft: Draft }) {
  const [expanded, setExpanded] = useState(false);
  const m = draft.meeting;
  const isLobbying = m.classification === "lobbying";
  const internalAttendee = m.attendees.find((a) => a.isInternal);
  const date = new Date(m.startAt);
  const dateLabel = `${date.toLocaleString("en-US", { month: "short" })} ${date.getDate()}`;

  return (
    <li>
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
        <div className="shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium text-xs ${
              isLobbying
                ? "bg-emerald-50 text-emerald-900 border border-emerald-200"
                : "bg-amber-50 text-amber-900 border border-amber-200"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isLobbying ? "bg-emerald-500" : "bg-amber-500"}`}></span>
            {isLobbying ? "Auto-drafted" : "Needs input"}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5 pl-[76px] bg-stone-50/40 border-t border-stone-100">
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 pt-4">
            <Field label="Institution" value={m.institution?.name ?? "(unknown)"} />
            <Field label="Date" value={date.toISOString().slice(0, 10)} />

            {(() => {
              const isGovAttendee = (a: Attendee) => a.email && /\.(gc|parl)\.ca$/i.test(a.email);
              const priority = m.attendees.filter((a) => a.isDpoh === true || a.isInternal || isGovAttendee(a));
              const external = m.attendees.filter((a) => !a.isDpoh && !a.isInternal && !isGovAttendee(a));

              return (
                <div className="col-span-2">
                  <FieldLabel>Attendees ({m.attendees.length})</FieldLabel>

                  {m.attendees.length === 0 && (
                    <div className="text-xs text-stone-400">(no attendees on this event)</div>
                  )}

                  {priority.length > 0 && (
                    <div className="space-y-1 mb-3">
                      {priority.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 text-sm flex-wrap">
                          {a.isDpoh === true && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-200 rounded">
                              DPOH
                            </span>
                          )}
                          {!a.isDpoh && isGovAttendee(a) && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded">
                              gov
                            </span>
                          )}
                          {a.isInternal && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-stone-100 text-stone-700 border border-stone-200 rounded">
                              internal
                            </span>
                          )}
                          <span className="text-stone-900">{a.name}</span>
                          <span className="text-stone-500 text-xs">{a.email}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {external.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wide text-stone-400 mb-1.5 mt-3">
                        Other attendees ({external.length})
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5">
                        {external.map((a) => (
                          <div key={a.id} className="text-xs text-stone-600 truncate" title={a.email}>
                            <span className="text-stone-700">{a.name}</span>
                            <span className="text-stone-400"> · {a.email}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            <div className="col-span-2">
              <FieldLabel>Subjects (pre-filled)</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {(draft.subjects ?? []).map((s) => (
                  <span
                    key={s.subjectId}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border bg-emerald-50 text-emerald-900 border-emerald-200"
                    title={`Source: ${s.source}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400"></span>
                    {s.subjectId}
                  </span>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">From org-profile defaults (level-0).</div>
            </div>

            <div className="col-span-2">
              <FieldLabel>Why was this classified this way?</FieldLabel>
              <div className="space-y-1">
                {m.reasons.map((r) => (
                  <div key={r.id} className="text-xs text-stone-700">
                    <span
                      className={
                        r.ok === true ? "text-emerald-700" : r.ok === false ? "text-stone-500" : "text-amber-700"
                      }
                    >
                      {r.ok === true ? "+" : r.ok === false ? "−" : "?"}
                    </span>{" "}
                    {r.text}
                    {r.citation && <span className="text-stone-400"> [{r.citation}]</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(() => {
            const candidateGovAttendee = m.attendees.find(
              (a) => !a.isInternal && a.email && /\.(gc|parl)\.ca$/i.test(a.email) && a.isDpoh !== true,
            );

            return (
              <div className="mt-4 flex items-center justify-end gap-2">
                {!isLobbying && candidateGovAttendee && (
                  <form action={confirmDpohAction}>
                    <input type="hidden" name="meetingId" value={m.id} />
                    <input type="hidden" name="attendeeEmail" value={candidateGovAttendee.email} />
                    <SubmitButton className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 text-white font-medium hover:bg-emerald-800 disabled:opacity-50">
                      Confirm — {candidateGovAttendee.name} is a DPOH
                    </SubmitButton>
                  </form>
                )}
                <form action={excludeMeetingAction}>
                  <input type="hidden" name="meetingId" value={m.id} />
                  {!isLobbying && candidateGovAttendee && (
                    <input type="hidden" name="attendeeEmail" value={candidateGovAttendee.email} />
                  )}
                  <SubmitButton className="text-xs px-3 py-1.5 rounded-md border border-stone-200 hover:bg-white text-stone-700 disabled:opacity-50">
                    {isLobbying
                      ? "Exclude from filing"
                      : candidateGovAttendee
                        ? `Not a DPOH — ${candidateGovAttendee.name} (apply to all meetings)`
                        : "Not lobbying — exclude"}
                  </SubmitButton>
                </form>
              </div>
            );
          })()}
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
