"use client";

/**
 * "Route for certification" form — month picker + RO email → single-use
 * certification link. The link is displayed exactly once (the raw token is
 * never stored); the staffer copies it into their own email to the RO.
 */

import { useActionState, useState } from "react";
import {
  routeForCertificationAction,
  type RouteForCertificationState,
} from "../_actions";

const INITIAL_STATE: RouteForCertificationState = { status: "idle" };

/** Previous calendar month as "YYYY-MM" — MCRs are filed for the month past. */
export function defaultRoutingMonth(now = new Date()): string {
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function RouteForCertificationForm({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  const [state, formAction, pending] = useActionState(
    routeForCertificationAction,
    INITIAL_STATE,
  );
  const [copied, setCopied] = useState(false);

  if (state.status === "success" && state.certificationPath) {
    const fullUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${state.certificationPath}`
        : state.certificationPath;

    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <div className="text-xs font-semibold text-emerald-900">
          {state.message} Copy this link now — it is shown only once.
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={fullUrl}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 rounded-md border border-emerald-200 bg-white px-2 py-1.5 text-xs text-stone-700 font-mono"
          />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(fullUrl);
              setCopied(true);
            }}
            className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-emerald-700 text-white font-semibold hover:bg-emerald-800"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-emerald-900/70">
          Email it to the Responsible Officer yourself — automated delivery is
          not wired up yet. Expires{" "}
          {state.expiresAt
            ? new Date(state.expiresAt).toLocaleDateString("en-CA", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "in 14 days"}
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />

      <label className="block">
        <span className="block text-[11px] uppercase tracking-wide text-stone-500 mb-1">
          Filing month
        </span>
        <input
          type="month"
          name="month"
          defaultValue={defaultRoutingMonth()}
          required
          className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 focus:border-emerald-600"
        />
      </label>

      <label className="block flex-1 min-w-[220px]">
        <span className="block text-[11px] uppercase tracking-wide text-stone-500 mb-1">
          Responsible Officer email
        </span>
        <input
          type="email"
          name="routedToEmail"
          placeholder={`ro@${tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example`}
          required
          className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 focus:border-emerald-600"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="text-xs px-3.5 py-2 rounded-lg bg-emerald-700 text-white font-semibold hover:bg-emerald-800 shadow-sm disabled:opacity-50"
      >
        {pending ? "Routing…" : "Route for certification →"}
      </button>

      {state.status === "error" && (
        <p className="basis-full text-xs text-red-700">{state.message}</p>
      )}
    </form>
  );
}
