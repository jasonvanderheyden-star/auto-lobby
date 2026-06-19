import Link from "next/link";
import { BrandLockup } from "@/components/Brand";

type NavKey = "dashboard" | "filings" | "registry" | "settings" | "agency";

interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

/** Canonical, ordered link set. Agency is appended conditionally. */
const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard" },
  { key: "filings", label: "Filings", href: "/filings" },
  { key: "registry", label: "Registry", href: "/registry-search" },
  { key: "settings", label: "Settings", href: "/settings/calendars" },
];

const AGENCY_ITEM: NavItem = { key: "agency", label: "Agency", href: "/agency" };

const ACTIVE_CLASS = "px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 font-medium";
const INACTIVE_CLASS = "px-3 py-1.5 rounded-md text-stone-600 hover:bg-stone-100";

/**
 * Shared top-nav left cluster: the brand lockup (links to /dashboard) plus the
 * canonical navigation. Pure presentational server component — it does not read
 * auth or the DB. The caller passes `showAgency` (non-negotiable #7 gate).
 */
export function TopNav({
  active,
  showAgency = false,
}: {
  active: NavKey;
  showAgency?: boolean;
}) {
  const items = showAgency ? [...NAV_ITEMS, AGENCY_ITEM] : NAV_ITEMS;

  return (
    <div className="flex items-center gap-8">
      <Link href="/dashboard">
        <BrandLockup />
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={item.key === active ? ACTIVE_CLASS : INACTIVE_CLASS}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
