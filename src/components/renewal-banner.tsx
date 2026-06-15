"use client";

import { useState } from "react";

interface RenewalBannerProps {
  expiresAt: Date | null;
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

export function RenewalBanner({ expiresAt }: RenewalBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !expiresAt) return null;

  const now = new Date();
  const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Only render when within 60 days or overdue
  if (daysLeft > 60) return null;

  const isUrgent = daysLeft <= 14;

  return (
    <div
      className={`mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 ${
        isUrgent
          ? "border-red-200 bg-red-50"
          : "border-amber-200 bg-amber-50"
      }`}
    >
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isUrgent ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
        }`}
      >
        !
      </div>
      <p className={`flex-1 text-sm ${isUrgent ? "text-red-900" : "text-amber-900"}`}>
        {daysLeft < 0 ? (
          <>
            Your lobbying registration expired on {formatDisplayDate(expiresAt)}.{" "}
            <a
              href="https://lobbycanada.gc.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              File immediately at canada.ca/lobbyists
            </a>
            .
          </>
        ) : daysLeft === 0 ? (
          <>
            Your lobbying registration expires <strong>today</strong>.{" "}
            <a
              href="https://lobbycanada.gc.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              File your renewal at canada.ca/lobbyists
            </a>{" "}
            before {formatDisplayDate(expiresAt)}.
          </>
        ) : (
          <>
            Your lobbying registration{" "}
            {isUrgent ? (
              <>
                expires in <strong>{daysLeft} day{daysLeft === 1 ? "" : "s"}</strong>
              </>
            ) : (
              <>
                renews on <strong>{formatDisplayDate(expiresAt)}</strong>
              </>
            )}
            .{" "}
            <a
              href="https://lobbycanada.gc.ca"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline"
            >
              File your renewal at canada.ca/lobbyists
            </a>{" "}
            before {formatDisplayDate(expiresAt)}.
          </>
        )}
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss renewal warning"
        className={`shrink-0 text-lg leading-none transition ${
          isUrgent ? "text-red-400 hover:text-red-700" : "text-amber-400 hover:text-amber-700"
        }`}
      >
        ×
      </button>
    </div>
  );
}
