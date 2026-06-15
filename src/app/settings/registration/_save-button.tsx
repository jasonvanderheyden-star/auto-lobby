"use client";

import { useFormStatus } from "react-dom";

export function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border border-white/40 border-t-white" />
      )}
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
