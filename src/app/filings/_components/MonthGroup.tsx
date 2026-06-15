"use client";

import { useState } from "react";
import { certifyBatchAction } from "../_actions";
import { certifyConsultantBatchAction } from "../_engagement-actions";
import type { EngagementOption, WhySignal } from "./EngagementChip";
import { FilingRow } from "./FilingRow";

type Attendee = {
  id: string;
  name: string;
  email: string;
  isInternal: boolean;
  isDpoh: boolean | null;
};
type Reason = { id: string; ok: boolean | null; text: string; citation: string | null };
type Institution = { name: string; acronym: string | null } | null;
type Subject = { oclCode?: number; subjectId?: string; source: string };

export interface DraftWithMeeting {
  id: string;
  certifiedAt: Date | string | null;
  subjects: Subject[];
  provenance: Record<string, { value: unknown; source: string; confidence: number }>;
  meeting: {
    id: string;
    title: string;
    startAt: Date | string;
    classification: string;
    attendees: Attendee[];
    reasons: Reason[];
    institution: Institution;
    institutionId?: string | null;
    // Consultant client attribution (agency-own tenants only)
    engagementId?: string | null;
    engagementSource?: string | null;
    engagementConfidence?: number | null;
    engagement?: { id: string; clientName: string } | null;
  };
}

const CONFIRMED_SOURCES = new Set(["confirmed", "manual"]);

type RoleHint = { role: string; isDpoh: boolean };

interface MonthGroupProps {
  monthKey: string;   // "YYYY-MM"
  label: string;      // "April 2026"
  drafts: DraftWithMeeting[];
  roleHints: Record<string, RoleHint[]>;
  defaultOpen: boolean;
  /** True on agency-own tenants — per-engagement certify buttons + chips. */
  agencyMode?: boolean;
  engagements?: EngagementOption[];
  /** meetingId → suggestion signal breakdown (from the audit trail). */
  engagementWhy?: Record<string, WhySignal[]>;
}

export function MonthGroup({
  monthKey,
  label,
  drafts,
  roleHints,
  defaultOpen,
  agencyMode = false,
  engagements = [],
  engagementWhy = {},
}: MonthGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  const lobbyingCount    = drafts.filter((d) => d.meeting.classification === "lobbying").length;
  const certifiedCount   = drafts.filter((d) => d.meeting.classification === "lobbying" && d.certifiedAt).length;
  const needsInfoCount   = drafts.filter((d) => d.meeting.classification === "needs-info").length;
  const uncertified      = lobbyingCount - certifiedCount;
  const allCertified     = lobbyingCount > 0 && certifiedCount === lobbyingCount;

  // Agency-own tenants certify per client undertaking, not tenant-wide.
  // Only HUMAN-CONFIRMED attributions are certifiable; auto-suggested or
  // unattributed lobbying drafts are surfaced as "awaiting attribution".
  const engagementGroups = new Map<string, { clientName: string; count: number }>();
  let awaitingAttribution = 0;
  if (agencyMode) {
    for (const d of drafts) {
      if (d.meeting.classification !== "lobbying" || d.certifiedAt) continue;
      const eid = d.meeting.engagementId;
      const src = d.meeting.engagementSource;
      if (eid && src && CONFIRMED_SOURCES.has(src)) {
        const name =
          d.meeting.engagement?.clientName ??
          engagements.find((e) => e.id === eid)?.clientName ??
          "(unknown client)";
        const g = engagementGroups.get(eid) ?? { clientName: name, count: 0 };
        g.count++;
        engagementGroups.set(eid, g);
      } else {
        awaitingAttribution++;
      }
    }
  }

  return (
    <section className="bg-white border border-stone-200 rounded-xl overflow-hidden">

      {/* ── Month header (always visible) ── */}
      <div
        className="px-5 py-3.5 flex items-center justify-between bg-stone-50/60 cursor-pointer hover:bg-stone-100/60 select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          {/* Chevron */}
          <svg
            className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M7 5l6 5-6 5V5Z" />
          </svg>

          <h2 className="text-sm font-semibold text-stone-900">{label}</h2>
          <span className="text-xs text-stone-400">
            {drafts.length} MCR{drafts.length === 1 ? "" : "s"}
          </span>

          {/* Status chips — visible even when collapsed */}
          {allCertified && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Certified
            </span>
          )}
          {!allCertified && lobbyingCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-stone-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {lobbyingCount} ready
            </span>
          )}
          {needsInfoCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {needsInfoCount} needs input
            </span>
          )}
        </div>

        {/* Right side — certify button or certified badge */}
        <div
          className="flex items-center gap-3"
          onClick={(e) => e.stopPropagation()} // don't collapse when clicking certify
        >
          {certifiedCount > 0 && uncertified === 0 && (
            <span className="text-xs text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              ✓ {certifiedCount} certified
            </span>
          )}
          {certifiedCount > 0 && uncertified > 0 && (
            <span className="text-xs text-emerald-700 font-medium">
              ✓ {certifiedCount} certified
            </span>
          )}
          {/* In-house tenants: one tenant-wide batch (unchanged). */}
          {!agencyMode && uncertified > 0 && (
            <form action={certifyBatchAction}>
              <input type="hidden" name="month" value={monthKey} />
              <button
                type="submit"
                className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 shadow-sm"
              >
                Certify {label} ({uncertified}) →
              </button>
            </form>
          )}

          {/* Agency-own tenants: one certify button per client undertaking.
              Only the consultant of record can certify each batch (enforced
              server-side in certifyConsultantBatchAction). */}
          {agencyMode && uncertified > 0 && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {awaitingAttribution > 0 && (
                <span className="text-xs text-amber-700">
                  {awaitingAttribution} awaiting client confirmation
                </span>
              )}
              {[...engagementGroups.entries()].map(([eid, g]) => (
                <form key={eid} action={certifyConsultantBatchAction}>
                  <input type="hidden" name="month" value={monthKey} />
                  <input type="hidden" name="engagementId" value={eid} />
                  <button
                    type="submit"
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 shadow-sm"
                  >
                    Certify {g.clientName} ({g.count}) →
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Collapsible rows ── */}
      {open && (
        <ul className="divide-y divide-stone-100 border-t border-stone-100">
          {drafts.map((d) => (
            <FilingRow
              key={d.id}
              draft={JSON.parse(JSON.stringify(d))}
              roleHints={roleHints}
              agencyMode={agencyMode}
              engagements={engagements}
              engagementWhy={engagementWhy[d.meeting.id]}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
