"use client";

/**
 * Certification block for the routed-certification page.
 *
 * Non-negotiable #1: the Responsible Officer must check the attestation
 * box, type their full name, and click Certify. The button stays disabled
 * until both are provided; the server action re-validates everything.
 */

import { useActionState, useState } from "react";
import {
  certifyRoutedBatchAction,
  type CertifyRoutedState,
} from "../_actions";

const INITIAL_STATE: CertifyRoutedState = { status: "idle" };

interface CertifyFormProps {
  token: string;
  count: number;
  monthLabel: string;
  tenantName: string;
  /** Resolved brand accent (tenant → agency → platform default). */
  brandColor: string;
}

export function CertifyForm({
  token,
  count,
  monthLabel,
  tenantName,
  brandColor,
}: CertifyFormProps) {
  const [state, formAction, pending] = useActionState(
    certifyRoutedBatchAction,
    INITIAL_STATE,
  );
  const [attested, setAttested] = useState(false);
  const [typedName, setTypedName] = useState("");

  if (state.status === "success") {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
        <div className="w-10 h-10 mx-auto rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-xl font-bold">
          ✓
        </div>
        <h2 className="mt-3 text-lg font-semibold text-emerald-900">
          Certification recorded
        </h2>
        <p className="mt-1 text-sm text-emerald-900/80">{state.message}</p>
        <p className="mt-3 text-xs text-emerald-900/60">
          This link has now been deactivated. {tenantName}&apos;s compliance
          team will submit the certified reports to the Lobbyists Registration
          System.
        </p>
      </div>
    );
  }

  const ready = attested && typedName.trim().length >= 3;

  return (
    <form
      action={formAction}
      className="bg-white border border-stone-200 rounded-2xl p-6"
    >
      <input type="hidden" name="token" value={token} />

      <h2 className="text-base font-semibold text-stone-900">
        Certification — {monthLabel}
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        As the Responsible Officer for {tenantName}, you are certifying{" "}
        {count} Monthly Communication Report{count === 1 ? "" : "s"} listed
        above.
      </p>

      <label className="mt-5 flex items-start gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          name="attested"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-emerald-700"
          required
        />
        <span className="text-sm text-stone-700 leading-relaxed">
          I certify that the information contained in{" "}
          {count === 1 ? "this report is" : "these reports is"} true to the
          best of my knowledge and belief, and that I am the officer
          responsible for filing returns on behalf of {tenantName} under the{" "}
          <span className="italic">Lobbying Act</span> (s. 5(3)).
        </span>
      </label>

      <div className="mt-5">
        <label
          htmlFor="typedName"
          className="block text-[11px] uppercase tracking-wide text-stone-500 mb-1.5"
        >
          Type your full name to sign
        </label>
        <input
          id="typedName"
          name="typedName"
          type="text"
          autoComplete="name"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder="e.g. Jane Q. Officer"
          className="w-full max-w-sm rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 focus:border-emerald-600"
          required
          minLength={3}
        />
      </div>

      {state.status === "error" && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {state.message}
        </p>
      )}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={!ready || pending}
          style={ready && !pending ? { backgroundColor: brandColor } : undefined}
          className="text-sm px-5 py-2.5 rounded-lg text-white font-semibold shadow-sm disabled:bg-stone-300 disabled:cursor-not-allowed bg-emerald-700 hover:opacity-90"
        >
          {pending
            ? "Certifying…"
            : `Certify ${count} report${count === 1 ? "" : "s"} →`}
        </button>
        <span className="text-xs text-stone-400">
          This action is recorded in the audit trail.
        </span>
      </div>
    </form>
  );
}
