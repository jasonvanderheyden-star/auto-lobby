"use client";

/**
 * RouteForCertification — self-contained "route this month to the client's
 * Responsible Officer" block for the /filings page.
 *
 * NOT yet wired into src/app/filings/page.tsx (that file is owned by another
 * workstream). To wire it, render inside the month header area for agency
 * actors (ctx.actorKind === "agency"):
 *
 *   <RouteForCertification tenantId={ctx.tenantId} tenantName={tenant.name} />
 *
 * Posts to routeForCertificationAction, which independently verifies that
 * the signed-in user is an admin/staff AgencyMember of the agency managing
 * the tenant — rendering it for a non-agency user just yields a friendly
 * "forbidden" message, never a routed batch.
 */

import { RouteForCertificationForm } from "@/app/agency/_components/RouteForCertificationForm";

export function RouteForCertification({
  tenantId,
  tenantName,
}: {
  tenantId: string;
  tenantName: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-stone-900">
        Route for certification
      </h3>
      <p className="mt-1 mb-4 text-xs text-stone-500 max-w-2xl">
        Send this month&apos;s draft MCRs to {tenantName}&apos;s Responsible
        Officer for review and certification. They&apos;ll receive a single-use
        link — they review, attest, and certify themselves (nothing is filed
        without their click).
      </p>
      <RouteForCertificationForm tenantId={tenantId} tenantName={tenantName} />
    </div>
  );
}
