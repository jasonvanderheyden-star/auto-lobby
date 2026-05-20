"use client";

import { useFormStatus } from "react-dom";

export function SyncNowButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending && (
        <span className="h-3 w-3 animate-spin rounded-full border border-stone-300 border-t-emerald-600" />
      )}
      {pending ? "Syncing…" : "Sync now"}
    </button>
  );
}
