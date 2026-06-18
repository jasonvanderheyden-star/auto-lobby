import Link from "next/link";
import { db } from "@/lib/db";
import { BrandLockup } from "@/components/Brand";

export const metadata = { title: "Registry Search — Auto Lobby" };

// Force dynamic rendering so searchParams are always fresh
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function RegistrySearchPage({ searchParams }: PageProps) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const results = query
    ? await db.oclPublicRegistration.findMany({
        where: {
          OR: [
            { companyName: { contains: query, mode: "insensitive" } },
            { registrationNum: { contains: query, mode: "insensitive" } },
            { registrantName: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: { effectiveDate: "desc" },
        take: 50,
        select: {
          id: true,
          registrationNum: true,
          companyName: true,
          registrantName: true,
          status: true,
          subjects: true,
          effectiveDate: true,
        },
      })
    : [];

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Nav */}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <BrandLockup />
            <nav className="flex items-center gap-1 text-sm">
              <a className="rounded-md px-3 py-1.5 text-stone-600 hover:bg-stone-100" href="#">
                Dashboard
              </a>
              <Link
                className="rounded-md bg-stone-100 px-3 py-1.5 font-medium text-stone-900"
                href="/registry-search"
              >
                Registry
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Page heading */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-stone-900">Federal Lobbying Registry</h1>
          <p className="mt-1 text-sm text-stone-500">
            Search the OCL public registry — faster than the{" "}
            <a
              className="text-emerald-700 hover:underline"
              href="https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/clntSmmry"
              target="_blank"
              rel="noreferrer"
            >
              OCL&apos;s own site
            </a>
            . Data refreshed monthly from open.canada.ca.
          </p>
        </div>

        {/* Search form */}
        <form method="GET" action="/registry-search" className="mb-8">
          <div className="flex gap-3">
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Company name or registration number…"
              autoFocus
              className="flex-1 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
            >
              Search
            </button>
          </div>
        </form>

        {/* Results */}
        {query && results.length === 0 && (
          <p className="text-sm text-stone-500">
            No registrations found for <strong>&ldquo;{query}&rdquo;</strong>.
          </p>
        )}

        {results.length > 0 && (
          <>
            <p className="mb-4 text-xs text-stone-400">
              {results.length === 50
                ? "Showing top 50 results — refine your search for more"
                : `${results.length} result${results.length === 1 ? "" : "s"}`}
            </p>
            <ul className="space-y-3">
              {results.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/registry-search/${encodeURIComponent(r.registrationNum)}`}
                    className="block rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-medium text-stone-900">
                            {r.companyName}
                          </span>
                          <StatusBadge status={r.status} />
                        </div>
                        <div className="mt-0.5 text-xs text-stone-400">
                          {r.registrationNum}
                          {r.registrantName && <> · {r.registrantName}</>}
                          {r.effectiveDate && (
                            <> · Effective {r.effectiveDate.toISOString().slice(0, 10)}</>
                          )}
                        </div>
                      </div>
                    </div>

                    {r.subjects.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {r.subjects.slice(0, 8).map((s) => (
                          <SubjectChip key={s} label={s} />
                        ))}
                        {r.subjects.length > 8 && (
                          <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] text-stone-400">
                            +{r.subjects.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {!query && (
          <div className="rounded-xl border border-dashed border-stone-200 bg-white p-10 text-center">
            <p className="text-sm text-stone-400">Enter a company name or registration number above to search.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "Active";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isActive
          ? "bg-emerald-100 text-emerald-800"
          : "bg-stone-100 text-stone-500"
      }`}
    >
      {status}
    </span>
  );
}

function SubjectChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-stone-100 px-2.5 py-0.5 text-[11px] text-stone-600">
      {label}
    </span>
  );
}
