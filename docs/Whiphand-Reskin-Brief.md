# Whiphand re-skin brief — Auto Lobby app UI

**Status:** ready to implement · **Owner:** front-end (agent team, behind a PR)
**Goal:** bring the running app UI from the original *emerald / stone / Inter* theme onto the **Whiphand** brand — *periwinkle / mist / Space Grotesk + JetBrains Mono* — so the product matches the deck, the brand guide, and the demo assets.

This is a self-contained visual re-skin. No behavior, data, schema, or routing changes. Ship it on its own branch and PR so the diff is reviewable in isolation.

---

## 1. Why this is needed

The app was built to a pre-rebrand spec. `CLAUDE.md` (line ~41) still reads *"Inter font, emerald-700 accent, stone neutral palette"*, and the code implements exactly that. The Whiphand identity currently exists **only as assets** under `brand/` and is wired into nothing in `src/`.

Concretely, today:

- `src/app/globals.css` sets `--color-accent: var(--color-emerald-700)`.
- `src/app/layout.tsx` hardcodes the **Inter** font.
- The green **"AL"** logo tile (`bg-gradient-to-br from-emerald-600 to-teal-700`) is inlined in **13 places** — there is no shared logo component.
- **~180 occurrences** of `emerald-* / green-* / teal-*` utility classes across **24 files** (status chips, the primary button, nav active states, links).
- **463 occurrences** of `stone-*` neutrals.

## 2. Source of truth

`brand/02-guidelines/Whiphand-Brand.html` — the full brand guide (open in a browser).
Logo SVGs: `brand/01-logo/whiphand-mace.svg`, `whiphand-icon.svg`.

## 3. Brand tokens (exact values)

### Periwinkle (signal / primary action)

| Role | Hex |
|------|-----|
| Periwinkle (primary) | `#5B6CF0` |
| Periwinkle Deep (hover, text on tint) | `#3B43B8` |
| Periwinkle Light (accent on ink) | `#A6ADF5` |
| Periwinkle Mist (fills / highlights) | `#EEF0FE` |
| Periwinkle Ring (borders on tint) | `#D7DCFB` |

### Surfaces (light — the product)

| Role | Hex |
|------|-----|
| Mist (page background) | `#F5F6FB` |
| Paper (cards) | `#FFFFFF` |
| Line (borders) | `#E6E8F2` |
| Slate (primary text) | `#2A2E3A` |
| Muted (secondary text) | `#6E7385` |
| Faint (labels) | `#9AA0B5` |

### Ink (covers & marketing only — not product chrome)

| Role | Hex |
|------|-----|
| Ink | `#21243A` |
| Elevated | `#2A2E44` |
| Line (on ink) | `#343A52` |

### Semantic

| Role | Hex |
|------|-----|
| Success / OK | `#3FAE8E` |
| Danger (sparingly) | `#D98A8A` |

### Type

- **Display & UI:** Space Grotesk (400–700) — headlines, UI, body.
- **Mono · data & labels:** JetBrains Mono (400–600) — eyebrows, codes, status text, "system voice."
- Both are free on Google Fonts.

---

## 4. Recommended approach — remap the color ramps, don't hand-edit 180 classes

The app uses Tailwind v4 with `@theme` in `globals.css`. The lowest-risk, smallest-diff path is to **redefine the `emerald`, `teal`, and `stone` color ramps to brand values** at the theme layer. Every existing `bg-emerald-700`, `text-emerald-900`, `from-emerald-600 to-teal-700`, etc. then renders in periwinkle/mist automatically, with no component churn. Component-level class renames can follow later as cosmetic cleanup, not as a blocker.

### 4a. `src/app/globals.css`

Replace the current `@theme` block with brand tokens. Map emerald → periwinkle, teal → periwinkle (so the logo gradient resolves correctly), and stone → mist neutrals. Interpolated stops (those not given a brand hex) are derived to sit on a smooth ramp anchored to the brand stops; tune to taste.

```css
@import "tailwindcss";

@theme {
  /* Type — Whiphand */
  --font-sans: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;

  /* Accent token */
  --color-accent: #3B43B8;            /* periwinkle deep — primary action base */

  /* Periwinkle ramp mapped onto emerald-* (brand stops in bold comments) */
  --color-emerald-50:  #EEF0FE;       /* Periwinkle Mist (brand) */
  --color-emerald-100: #E0E4FC;
  --color-emerald-200: #D7DCFB;       /* Periwinkle Ring (brand) */
  --color-emerald-300: #C0C7F8;
  --color-emerald-400: #8E99F4;
  --color-emerald-500: #5B6CF0;       /* Periwinkle (brand) */
  --color-emerald-600: #4A57DE;
  --color-emerald-700: #3B43B8;       /* Periwinkle Deep (brand) */
  --color-emerald-800: #2F368F;
  --color-emerald-900: #21243A;       /* Ink (brand) — for text-emerald-900 */

  /* Teal mapped to periwinkle so the logo gradient stays in-brand */
  --color-teal-100: #E0E4FC;
  --color-teal-700: #3B43B8;

  /* Mist neutrals mapped onto stone-* */
  --color-stone-50:  #F5F6FB;         /* Mist page (brand) */
  --color-stone-100: #EEF0F5;
  --color-stone-200: #E6E8F2;         /* Line (brand) */
  --color-stone-300: #D5D8E4;
  --color-stone-400: #9AA0B5;         /* Faint (brand) */
  --color-stone-500: #6E7385;         /* Muted (brand) */
  --color-stone-600: #565B6E;
  --color-stone-700: #3D4254;
  --color-stone-800: #2A2E3A;         /* Slate text (brand) */
  --color-stone-900: #21243A;         /* Ink (brand) */
}
```

> Note: remapping `stone-*` touches 463 usages at once. If that feels too broad for one PR, ship the periwinkle (emerald/teal) remap first — that alone removes all the green — and treat the stone→mist shift as a fast follow.

### 4b. `src/app/layout.tsx` — fonts

Swap Inter for Space Grotesk + JetBrains Mono using `next/font/google`:

```tsx
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
// body className: `${display.variable} ${mono.variable} font-sans antialiased`
```

Update `metadata.title` from `"Auto Lobby"` to `"Auto Lobby — powered by Whiphand"` (optional).

---

## 5. Logo — replace the 13 inline "AL" tiles with the mace mark

Create one shared component and use it everywhere the green tile currently appears.

`src/components/Brand.tsx`:

```tsx
export function MaceMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none"
         className={className} aria-hidden="true">
      <line x1="24" y1="1.6" x2="24" y2="5"     stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="18.4" y1="3.3" x2="20.2" y2="6.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <line x1="29.6" y1="3.3" x2="27.8" y2="6.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
      <circle cx="24" cy="13" r="7.3" stroke="currentColor" strokeWidth="3.6"/>
      <circle cx="24" cy="13" r="2.5" fill="#5B6CF0"/>
      <rect x="21.4" y="19.5" width="5.2" height="18.6" rx="2.6" fill="currentColor"/>
      <rect x="16.5" y="38.1" width="15" height="4.6" rx="2.3" fill="currentColor"/>
    </svg>
  );
}

/** App-icon tile: mace on ink, matching brand/01-logo/whiphand-icon.svg */
export function BrandTile({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center justify-center rounded-md bg-[#21243A] border border-[#343A52] text-white"
          style={{ width: size, height: size }}>
      <MaceMark size={size * 0.62} />
    </span>
  );
}

/** Horizontal lockup for the top nav */
export function BrandLockup() {
  return (
    <span className="flex items-center gap-2 text-slate-800">
      <BrandTile size={28} />
      <span className="font-semibold tracking-tight">Auto Lobby</span>
      <span className="font-mono text-[10px] tracking-wide text-stone-500 uppercase">
        powered by Whiphand
      </span>
    </span>
  );
}
```

Replace the green tile (`flex h-7 w-7 … rounded-md bg-gradient-to-br from-emerald-600 to-teal-700 … >AL`) with `<BrandTile />` / `<BrandLockup />` in these locations:

- `src/app/dashboard/page.tsx`
- `src/app/filings/page.tsx`
- `src/app/filings/[draftMcrId]/subjects/page.tsx`
- `src/app/agency/page.tsx`
- `src/app/registry-search/page.tsx`
- `src/app/registry-search/[registrationNum]/page.tsx`
- `src/app/settings/registration/page.tsx`
- `src/app/settings/calendars/page.tsx`
- `src/app/settings/entitlements/page.tsx`
- `src/app/sign-in/[[...sign-in]]/page.tsx`
- `src/app/sign-up/[[...sign-up]]/page.tsx`
- `src/app/onboarding/create-organization/page.tsx`

(That's where `from-emerald-600 to-teal-700` appears today — 13 instances.)

### 5a. Fix the navigation drift (do this as part of the shared component)

The top nav is hand-rolled separately on every page, and the copies have drifted — so links disappear depending on where you are. Today:

| Page | Links shown |
|------|-------------|
| `/dashboard` | Dashboard · Registry · Calendars — **no Filings** |
| `/filings` | Dashboard · Filings · Settings — no Registry |
| `/agency` | Agency · Dashboard · Filings |
| `/registry-search` | (only itself) |
| `/settings/*` | Dashboard + sibling settings tab |

Result: from `/dashboard` there is **no way to reach Filings** except the browser back button or typing the URL. This is a real navigation bug, not cosmetic.

**Fix:** lift the nav into one shared `<TopNav active="..." />` component (alongside `Brand.tsx`) with a single canonical link set — **Dashboard · Filings · Registry · Settings** (plus Agency only for agency tenants) — rendered on every page, active item highlighted in periwinkle. This removes the drift and the duplicated logo tile in one pass.

---

## 6. Files touched (full checklist)

The 24 files carrying `emerald-* / green-* / teal-*` today. After the ramp remap (§4) most of these are already correct; verify each visually:

```
src/app/globals.css                                  ← token remap (§4a)
src/app/layout.tsx                                   ← fonts (§4b)
src/app/dashboard/page.tsx
src/app/filings/page.tsx
src/app/filings/_components/FilingRow.tsx
src/app/filings/_components/MonthGroup.tsx
src/app/filings/_components/EngagementChip.tsx
src/app/filings/[draftMcrId]/subjects/page.tsx
src/app/agency/page.tsx
src/app/agency/_components/RouteForCertificationForm.tsx
src/app/certify/[token]/page.tsx
src/app/certify/[token]/_components/CertifyForm.tsx
src/app/settings/registration/page.tsx
src/app/settings/registration/_save-button.tsx
src/app/settings/calendars/page.tsx
src/app/settings/calendars/sync-now-button.tsx
src/app/settings/entitlements/page.tsx
src/app/settings/entitlements/_form.tsx
src/app/registry-search/page.tsx
src/app/registry-search/[registrationNum]/page.tsx
src/app/sign-in/[[...sign-in]]/page.tsx
src/app/sign-up/[[...sign-up]]/page.tsx
src/app/onboarding/create-organization/page.tsx
src/components/subject-picker.tsx
src/components/EntitlementRequired.tsx
```

---

## 7. Update `CLAUDE.md`

Change the brand line (~41) from:

> Build React components that match the prototypes visually. Inter font, emerald-700 accent, stone neutral palette, generous whitespace.

to the Whiphand system: Space Grotesk + JetBrains Mono, periwinkle `#5B6CF0` accent (deep `#3B43B8`), mist neutrals (`#F5F6FB` page, `#FFFFFF` cards, `#E6E8F2` lines, `#2A2E3A` text), mace mark via `src/components/Brand.tsx`. Point to this brief and `brand/02-guidelines/Whiphand-Brand.html`. The `prototypes/` are now the *old* look — note that they predate the rebrand.

---

## 8. Voice / terminology — SEPARATE decision, not part of this PR

The brand guide also sets a plain-language voice that bans jargon and acronyms:

| Brand says | App currently says |
|------------|--------------------|
| your meetings | calendar events |
| officials | DPOHs |
| monthly report | MCR |
| the lobbying registry | OCL / LRS |

The live UI uses the technical terms throughout (`MCR`, `DPOH`, etc.). Aligning copy to the brand voice is a worthwhile but **larger product decision** with audit/legal-label implications — keep it out of the visual re-skin PR and scope it on its own. Flagging here so it isn't lost.

---

## 9. Acceptance criteria

- No `emerald-*`, `green-*`, or `teal-*` color renders anywhere in the app (verify visually on: dashboard, filings list, an expanded meeting detail, certify page, settings/calendars, settings/entitlements, registry-search, sign-in).
- Primary actions are periwinkle `#5B6CF0` (hover `#3B43B8`); page background is mist `#F5F6FB`; cards are paper white; text is slate `#2A2E3A`.
- The mace mark replaces every green "AL" tile; wordmark is "Auto Lobby" with "powered by Whiphand."
- Fonts render as Space Grotesk (UI) and JetBrains Mono (labels/data/status).
- The same nav (Dashboard · Filings · Registry · Settings) appears on every page; from any page you can reach Filings. No drifted/missing links.
- Success states use `#3FAE8E`, not the old emerald.
- `pnpm lint && pnpm typecheck && pnpm test` pass; no behavioral diff.

## 10. Out of scope

Copy/terminology change (§8), prototype files under `prototypes/`, any data/schema/route/auth changes, the marketing site.
