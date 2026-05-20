"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateMcrSubjectsAction } from "@/server/filing-engine/update-mcr-subjects";

// ── Subject data (OCL-style, matches prototypes/File-Meeting.html) ──────────

type SubjectItem = { id: string; name: string; related?: string[] };
type SubjectGroup = { name: string; hint?: string; items: SubjectItem[] };

const GROUPS: SubjectGroup[] = [
  {
    name: "Climate, Energy & Environment",
    hint: "Most relevant for Deep Sky",
    items: [
      { id: "climate", name: "Climate", related: ["environment", "energy", "taxation"] },
      { id: "environment", name: "Environment", related: ["climate", "science-tech"] },
      { id: "energy", name: "Energy", related: ["climate", "mining", "industry"] },
      { id: "mining", name: "Mining", related: ["energy", "environment"] },
      { id: "forestry", name: "Forestry", related: ["environment", "climate"] },
      { id: "fisheries", name: "Fisheries", related: ["environment"] },
    ],
  },
  {
    name: "Economy & Finance",
    items: [
      { id: "taxation", name: "Taxation and Finance", related: ["budget", "industry"] },
      { id: "budget", name: "Budget", related: ["taxation", "economic-development"] },
      { id: "economic-development", name: "Economic Development", related: ["industry", "small-business"] },
      { id: "small-business", name: "Small Business", related: ["economic-development", "taxation"] },
      { id: "financial-institutions", name: "Financial Institutions" },
      { id: "pensions", name: "Pensions" },
    ],
  },
  {
    name: "Industry & Innovation",
    items: [
      { id: "industry", name: "Industry", related: ["economic-development", "science-tech"] },
      { id: "science-tech", name: "Science and Technology", related: ["climate", "r-and-d"] },
      { id: "r-and-d", name: "Research and Development", related: ["science-tech", "industry"] },
      { id: "intellectual-property", name: "Intellectual Property" },
      { id: "infrastructure", name: "Infrastructure", related: ["transportation", "energy"] },
      { id: "telecommunications", name: "Telecommunications" },
    ],
  },
  {
    name: "Trade & International",
    items: [
      { id: "international-trade", name: "International Trade", related: ["industry", "internal-trade"] },
      { id: "international-relations", name: "International Relations" },
      { id: "internal-trade", name: "Internal Trade" },
      { id: "defence", name: "Defence" },
      { id: "national-security", name: "National Security" },
      { id: "immigration", name: "Immigration" },
    ],
  },
  {
    name: "Health, Labour & Social",
    items: [
      { id: "health", name: "Health", related: ["pharmaceutical"] },
      { id: "pharmaceutical", name: "Pharmaceutical Industry", related: ["health"] },
      { id: "labour", name: "Labour", related: ["employment"] },
      { id: "employment", name: "Employment and Training", related: ["labour"] },
      { id: "education", name: "Education" },
      { id: "housing", name: "Housing" },
      { id: "social-issues", name: "Social Issues" },
      { id: "consumer-issues", name: "Consumer Issues" },
    ],
  },
  {
    name: "Government, Law & Regions",
    items: [
      { id: "government-procurement", name: "Government Procurement" },
      { id: "justice", name: "Justice and Law Enforcement" },
      { id: "privacy", name: "Privacy and Access to Information" },
      { id: "regional-development", name: "Regional Development" },
      { id: "municipalities", name: "Municipalities" },
      { id: "indigenous", name: "Indigenous Affairs", related: ["regional-development"] },
    ],
  },
  {
    name: "Culture, Media & Other",
    items: [
      { id: "arts-culture", name: "Arts and Culture" },
      { id: "broadcasting", name: "Broadcasting", related: ["telecommunications"] },
      { id: "media", name: "Media" },
      { id: "sports", name: "Sports" },
      { id: "tourism", name: "Tourism" },
      { id: "religion", name: "Religion" },
      { id: "agriculture", name: "Agriculture" },
      { id: "transportation", name: "Transportation", related: ["infrastructure"] },
      { id: "labelling", name: "Labelling" },
    ],
  },
];

const ALL_ITEMS = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.name })));
const BY_ID = Object.fromEntries(ALL_ITEMS.map((it) => [it.id, it]));

// Deep Sky registration subjects — shown as "on your registration"
const ON_REGISTRATION = new Set(["environment", "energy", "science-tech", "industry"]);

// ── Suggested (static for now; Phase N: derive from meeting title + past filings) ─
const SUGGESTED_IDS = ["environment", "climate", "energy", "science-tech", "taxation"];

// ── Sub-components ────────────────────────────────────────────────────────────

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 rounded-lg bg-emerald-700 text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "Saving…" : "Save subjects"}
    </button>
  );
}

interface ChipProps {
  id: string;
  name: string;
  active: boolean;
  variant?: "selected" | "suggested" | "default";
  onToggle: (id: string) => void;
}

function Chip({ id, name, active, variant = "default", onToggle }: ChipProps) {
  const base =
    "animate-chip-in inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm border transition-colors select-none cursor-pointer";

  const style = active
    ? "bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800"
    : variant === "suggested"
      ? "bg-white text-emerald-900 border-emerald-200 hover:border-emerald-600 hover:bg-emerald-50"
      : "bg-white text-stone-700 border-stone-200 hover:border-stone-400";

  return (
    <button type="button" className={`${base} ${style}`} onClick={() => onToggle(id)}>
      {active ? (
        <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 opacity-60" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 4a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0v-4H5a1 1 0 1 1 0-2h4V5a1 1 0 0 1 1-1Z" />
        </svg>
      )}
      {name}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface SubjectPickerProps {
  draftMcrId: string;
  initialSelectedIds: string[];
}

export function SubjectPicker({ draftMcrId, initialSelectedIds }: SubjectPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds));
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K → focus search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const term = search.trim().toLowerCase();
  const filteredGroups = GROUPS.map((g) => ({
    ...g,
    items: term
      ? g.items.filter(
          (it) => it.name.toLowerCase().includes(term) || it.id.toLowerCase().includes(term),
        )
      : g.items,
  })).filter((g) => g.items.length > 0);

  const selectedItems = [...selected]
    .map((id) => BY_ID[id])
    .filter(Boolean) as (SubjectItem & { group: string })[];

  // Compliance note
  const allOnReg = selectedItems.length > 0 && selectedItems.every((it) => ON_REGISTRATION.has(it.id));
  const offReg = selectedItems.filter((it) => !ON_REGISTRATION.has(it.id));

  return (
    <form action={updateMcrSubjectsAction} className="contents">
      <input type="hidden" name="draftMcrId" value={draftMcrId} />
      <input type="hidden" name="selectedIds" value={JSON.stringify([...selected])} />

      <div className="grid grid-cols-3 gap-8">
        {/* ── Left 2 cols: picker ─────────────────────────────────────── */}
        <div className="col-span-2 space-y-4">
          {/* Selected chips */}
          <section className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-stone-100">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-stone-900">What did you talk about?</h2>
                  <p className="text-sm text-stone-600 mt-0.5">
                    Pick everything that applies. Most meetings have 2–4 subjects.
                  </p>
                </div>
                <div className="text-xs text-stone-400 flex items-center gap-1 mt-0.5">
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 border border-stone-200 border-b-2 rounded bg-white text-stone-600">
                    ⌘
                  </kbd>
                  <kbd className="font-mono text-[10px] px-1.5 py-0.5 border border-stone-200 border-b-2 rounded bg-white text-stone-600">
                    K
                  </kbd>
                  <span className="text-stone-400">to search</span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5 min-h-[28px]">
                {selectedItems.length === 0 ? (
                  <span className="text-sm text-stone-400">No subjects selected yet.</span>
                ) : (
                  selectedItems.map((it) => (
                    <Chip key={it.id} id={it.id} name={it.name} active onToggle={toggle} variant="selected" />
                  ))
                )}
              </div>
            </div>

            {/* Search */}
            <div className="px-5 py-3 border-b border-stone-100 bg-stone-50/50">
              <div className="relative">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M9 3a6 6 0 1 0 3.47 10.9l3.31 3.32a.75.75 0 1 0 1.06-1.06l-3.31-3.32A6 6 0 0 0 9 3ZM4.5 9a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0Z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search subjects, e.g. carbon pricing, mining permits…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-stone-200 rounded-lg placeholder:text-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                />
              </div>
            </div>

            {/* Suggested */}
            {!term && (
              <div className="px-5 py-4 border-b border-stone-100 animate-fade-in-up">
                <div className="flex items-center gap-2 mb-3">
                  <svg className="w-4 h-4 text-emerald-700" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 2a1 1 0 0 1 .9.56l2.1 4.3 4.73.69a1 1 0 0 1 .56 1.7l-3.42 3.34.8 4.7a1 1 0 0 1-1.45 1.06L10 16.14l-4.22 2.22a1 1 0 0 1-1.45-1.06l.8-4.7L1.7 9.25a1 1 0 0 1 .56-1.7l4.73-.69 2.1-4.3A1 1 0 0 1 10 2Z" />
                  </svg>
                  <h3 className="text-sm font-semibold text-stone-900">Suggested for this meeting</h3>
                  <span className="text-xs text-stone-500">· Based on org profile</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_IDS.map((id) => {
                    const it = BY_ID[id];
                    if (!it) return null;
                    return (
                      <Chip
                        key={id}
                        id={id}
                        name={it.name}
                        active={selected.has(id)}
                        variant="suggested"
                        onToggle={toggle}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Browse all, grouped */}
            <div className="px-5 py-4 divide-y divide-stone-100">
              {filteredGroups.map((g, idx) => (
                <details key={g.name} open={!!term || idx === 0} className="group py-3 first:pt-0 last:pb-0">
                  <summary className="flex items-center gap-2 cursor-pointer list-none select-none">
                    <svg
                      className="w-3.5 h-3.5 text-stone-400 transition-transform group-open:rotate-90"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path d="M7 5l6 5-6 5V5Z" />
                    </svg>
                    <span className="text-sm font-semibold text-stone-900">{g.name}</span>
                    {g.hint && <span className="text-xs text-emerald-700 font-medium">{g.hint}</span>}
                    <span className="ml-auto text-xs text-stone-400">
                      {g.items.filter((it) => selected.has(it.id)).length > 0 &&
                        `${g.items.filter((it) => selected.has(it.id)).length} selected`}
                    </span>
                  </summary>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {g.items.map((it) => (
                      <Chip
                        key={it.id}
                        id={it.id}
                        name={it.name}
                        active={selected.has(it.id)}
                        onToggle={toggle}
                      />
                    ))}
                  </div>
                </details>
              ))}
              {term && filteredGroups.length === 0 && (
                <div className="py-6 text-center text-sm text-stone-500">
                  No subjects match &ldquo;{search}&rdquo;
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── Right rail ──────────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="bg-white border border-stone-200 rounded-xl p-5">
            <div className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">
              Selection summary
            </div>
            {selectedItems.length === 0 ? (
              <p className="text-sm text-stone-400">Nothing selected yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {selectedItems.map((it) => (
                  <li key={it.id} className="flex items-start gap-2 text-sm">
                    <svg className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <div>
                      <span className="text-stone-900">{it.name}</span>
                      {ON_REGISTRATION.has(it.id) && (
                        <span className="ml-1.5 text-[10px] font-medium text-emerald-700">on reg</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Compliance note */}
          {selectedItems.length > 0 && (
            <div
              className={`rounded-xl border p-4 text-xs animate-fade-in-up ${
                offReg.length > 0
                  ? "bg-amber-50 border-amber-200 text-amber-900"
                  : "bg-emerald-50 border-emerald-200 text-emerald-900"
              }`}
            >
              {allOnReg ? (
                <>
                  <span className="font-semibold">All subjects on your registration.</span> No registration
                  amendment needed.
                </>
              ) : (
                <>
                  <span className="font-semibold">
                    {offReg.length} subject{offReg.length === 1 ? "" : "s"} not on your current registration:
                  </span>{" "}
                  {offReg.map((it) => it.name).join(", ")}. You may need to amend your registration before
                  filing.
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky footer ───────────────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 border-t border-stone-200 bg-white/95 backdrop-blur-sm py-4 px-6 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="text-sm text-stone-600">
            {selectedItems.length === 0
              ? "Select at least one subject matter to save."
              : `${selectedItems.length} subject${selectedItems.length === 1 ? "" : "s"} selected`}
          </div>
          <div className="flex items-center gap-3">
            <a href="/filings" className="text-sm text-stone-600 hover:text-stone-900 px-3 py-2">
              Cancel
            </a>
            <SaveButton />
          </div>
        </div>
      </div>
    </form>
  );
}
