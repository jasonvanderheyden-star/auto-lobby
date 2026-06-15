"use client";

/**
 * Client-attribution UI for agency-own tenants (consultant lobbying).
 *
 * - EngagementBadge: compact chip for the collapsed filing row.
 * - EngagementPanel: expanded-row block with the suggestion's "why" signals,
 *   a Confirm button, and a reassign select — wired to confirmEngagementAction.
 *
 * Auto-suggested attributions are visually distinct (dashed border) from
 * human-confirmed ones: a suggestion never certifies until confirmed.
 */

import { useFormStatus } from "react-dom";
import { confirmEngagementAction } from "../_engagement-actions";

export type EngagementOption = {
  id: string;
  clientName: string;
  registrationNum: string | null;
};

export type WhySignal = { signal: string; weight: number; detail: string };

export type MeetingEngagement = {
  engagementId: string | null;
  engagementSource: string | null; // auto-suggested | confirmed | manual
  engagementConfidence: number | null;
  engagement: { id: string; clientName: string } | null;
};

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

function pct(confidence: number | null): string {
  return confidence == null ? "" : ` · ${Math.round(confidence * 100)}%`;
}

// ─── Collapsed-row badge ────────────────────────────────────────────────────

export function EngagementBadge({ me }: { me: MeetingEngagement }) {
  if (!me.engagementId || !me.engagement) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-stone-200 bg-stone-50 text-stone-500">
        No client
      </span>
    );
  }
  if (me.engagementSource === "auto-suggested") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-dashed border-emerald-300 bg-emerald-50/60 text-emerald-900"
        title={`Suggested client attribution${pct(me.engagementConfidence)} — confirm before filing`}
      >
        <span className="w-1.5 h-1.5 rounded-full border border-emerald-500" />
        {me.engagement.clientName}
        {me.engagementConfidence != null && (
          <span className="text-emerald-700/70">{Math.round(me.engagementConfidence * 100)}%</span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border border-emerald-200 bg-emerald-50 text-emerald-900">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      {me.engagement.clientName}
    </span>
  );
}

// ─── Expanded-row panel ─────────────────────────────────────────────────────

function ReassignForm({
  meetingId,
  engagements,
  currentEngagementId,
  buttonLabel,
}: {
  meetingId: string;
  engagements: EngagementOption[];
  currentEngagementId: string | null;
  buttonLabel: string;
}) {
  return (
    <form action={confirmEngagementAction} className="flex items-center gap-1.5">
      <input type="hidden" name="meetingId" value={meetingId} />
      <select
        name="engagementId"
        defaultValue={currentEngagementId ?? ""}
        required
        className="text-[11px] px-2 py-1 rounded border border-stone-200 bg-white text-stone-700 max-w-[220px]"
      >
        <option value="" disabled>
          Select client…
        </option>
        {engagements.map((e) => (
          <option key={e.id} value={e.id}>
            {e.clientName}
            {e.registrationNum ? ` (${e.registrationNum})` : ""}
          </option>
        ))}
      </select>
      <SubmitButton className="text-[11px] px-2.5 py-1 rounded border border-stone-200 text-stone-600 hover:bg-white disabled:opacity-40">
        {buttonLabel}
      </SubmitButton>
    </form>
  );
}

export function EngagementPanel({
  meetingId,
  me,
  engagements,
  why,
}: {
  meetingId: string;
  me: MeetingEngagement;
  engagements: EngagementOption[];
  why?: WhySignal[] | undefined;
}) {
  const isSuggested = me.engagementSource === "auto-suggested";
  const isConfirmed =
    me.engagementSource === "confirmed" || me.engagementSource === "manual";

  return (
    <div className="col-span-2">
      <div className="text-[11px] uppercase tracking-wide text-stone-500 mb-1.5">
        Client attribution
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <EngagementBadge me={me} />
        {isSuggested && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-800 border-amber-200">
            Suggested — confirm before filing
          </span>
        )}
        {isConfirmed && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-800 border-emerald-200">
            {me.engagementSource === "manual" ? "Manually assigned" : "Confirmed"}
          </span>
        )}

        {isSuggested && me.engagementId && (
          <form action={confirmEngagementAction}>
            <input type="hidden" name="meetingId" value={meetingId} />
            <input type="hidden" name="engagementId" value={me.engagementId} />
            <SubmitButton className="text-[11px] px-2.5 py-1 rounded bg-emerald-700 text-white font-medium hover:bg-emerald-800 disabled:opacity-40">
              ✓ Confirm client
            </SubmitButton>
          </form>
        )}

        <ReassignForm
          meetingId={meetingId}
          engagements={engagements}
          currentEngagementId={me.engagementId}
          buttonLabel={me.engagementId ? "Reassign" : "Assign"}
        />
      </div>

      {/* Why this suggestion — per-signal provenance from the audit trail */}
      {isSuggested && why && why.length > 0 && (
        <div className="mt-2 space-y-1">
          {why.map((s, i) => (
            <div key={i} className="text-xs text-stone-700">
              <span className="text-emerald-700">+{s.weight.toFixed(1)}</span>{" "}
              {s.detail}
            </div>
          ))}
        </div>
      )}
      {!me.engagementId && (
        <div className="mt-1.5 text-[11px] text-stone-500">
          No engagement scored high enough to suggest — assign the client
          manually. Unattributed meetings are never included in a filing batch.
        </div>
      )}
    </div>
  );
}
