import Link from "next/link";
import { BrandTile } from "@/components/Brand";

/**
 * Shown when a tenant reaches a product surface (e.g. /filings) without an
 * active entitlement for that product. This is the user-facing side of the
 * revenue gate enforced by requireEntitlement() in the server actions.
 */
export function EntitlementRequired({
  productLabel = "Auto Lobby",
  supportEmail = "support@autolobby.ca",
}: {
  productLabel?: string;
  supportEmail?: string;
}) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-6">
      <div className="max-w-lg w-full bg-white border border-stone-200 rounded-2xl p-8 text-center">
        <div className="mx-auto w-12 flex justify-center mb-5">
          <BrandTile size={48} />
        </div>
        <h1 className="text-2xl font-semibold text-stone-900">
          {productLabel} isn&apos;t active for this workspace
        </h1>
        <p className="text-stone-600 mt-3">
          This workspace doesn&apos;t have an active {productLabel} subscription
          yet. Once it&apos;s set up, your meetings, draft MCRs, and monthly
          certification will appear here.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a
            href={`mailto:${supportEmail}?subject=Activate%20${encodeURIComponent(
              productLabel,
            )}`}
            className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800"
          >
            Contact us to activate
          </a>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-stone-300 text-stone-700 text-sm font-medium hover:bg-stone-100"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
