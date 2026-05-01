# Future motion — Agency / GR-firm GTM (parked, but architect for it now)

This is parked as a *go-to-market motion*, but the *architectural implications* are not parked — they're encoded in CLAUDE.md and influence Phase 1+ decisions today. Resume the actual sales motion after Phase 3 ships (Monthly Certification UI live with ≥1 design partner certifying real batches monthly).

## The idea

Sell Auto Lobby to **GR firms and law firms** that manage Canadian lobbying compliance on behalf of multiple corporate clients. They white-label or co-brand the platform, fold the cost into their existing client retainers, and bring portfolios of 10–50 client tenants with each firm relationship.

Same product, fundamentally different go-to-market motion. Selling to the firm is faster, stickier, and brings more tenants per logo than selling one corporate-by-one.

## The pattern has a name

This is the **agency / reseller pattern**. Same playbook used by:

- **HubSpot** Partner Portal (marketing agencies managing client portals)
- **Stripe** Connect (platforms reselling Stripe to sub-merchants)
- **Shopify Plus** (agencies managing client storefronts)
- **Clio** for law firms managing client matters
- **Mailchimp** Pro for agencies

In every case: an agency tier sits above multiple client tenants, the agency owns the customer relationship and billing, the platform underneath captures the technical value.

## Why this is strategically a step-change

- **GTM acceleration.** 10 firm-deals × 30 client tenants each = 300 tenants from a sales motion that closes 10 contracts. Versus selling one-by-one to corporates with internal GR teams, which closes one tenant per deal.
- **Built-in product validation.** GR firms already run the manual lobbying-compliance process for clients today on spreadsheets and exhausted associates. We're not selling a category — we're selling a software upgrade to a service they already deliver. Buyers know exactly who needs this.
- **Distribution moat.** Once a firm's entire client book runs through us, switching costs are enormous. Every client's historical filings, audit trails, and DPOH attribution chains live in our system.
- **White-label is a wedge for them, not a giveaway from us.** A firm that positions "we use proprietary tech for compliance" against rivals still on spreadsheets gets a competitive edge worth paying for. They capture client relationship; we capture underlying value.
- **Buyers are compliance-sophisticated.** Canadian GR firms register themselves as Consultant Lobbyists under the Act. They speak our language. Sales cycles compress because we don't have to educate.
- **Pricing leverage.** Per-client seat fees billed to the agency, absorbed into client retainers. Clean unit economics. No procurement haggling with end-clients.

## The Canadian agency landscape (initial target list)

- **Earnscliffe Strategies** — large Ottawa GR firm, dozens of registered clients
- **McMillan Vantage** — public affairs / GR consulting
- **Crestview Strategy** — bipartisan GR
- **Hill+Knowlton Strategies** — global comms with strong Ottawa GR practice
- **Sussex Strategy Group** — Ontario GR, climate-active
- **StrategyCorp** — Toronto/Ottawa GR
- **Major law firms with GR practices:** Norton Rose, McCarthy Tétrault, Gowling WLG, Borden Ladner Gervais, Dentons, Davies, Stikeman Elliott, Bennett Jones
- **Boutique compliance shops** — smaller firms specializing in Lobbying Act work; lower deal size but faster sales cycles

## The product becomes three-tier

| Tier | Who | Scope | Pays |
|------|-----|-------|------|
| Agency | Earnscliffe, McMillan Vantage, etc. | Multiple client tenants | Yes — via retainer rollup |
| Client tenant | Deep Sky, Shell Canada, university | Their own registrations + calendars | Bundled with agency, or direct |
| Persona | Registrant / Lobbyist / Coordinator | Within their client tenant | n/a — seat-level |

The Calendar-Confirm-UX (parked) and Monthly Certification (Phase 3) workflows already operate at the persona level. Adding the agency tier doesn't disturb either — it sits above.

## What's already true in the architecture

- **Multi-tenant from day one.** `tenantId` everywhere, RLS-backed, per-tenant data isolation. The agency tier is just an optional parent.
- **Clerk Organizations** map 1:1 to Tenants today. Agency-managed tenants would have an additional "agency org" relationship — Clerk supports custom org metadata + parent/child relationships.
- **Per-tenant classifier tuning.** Already a non-negotiable. Agencies can't see across their clients' classifier behavior — each tenant remains isolated.

## What needs to be true (encoded in CLAUDE.md, built lazily)

1. **`agencyId` (nullable) on Tenant.** Future-proofs the data model. Empty for direct customers (Deep Sky), populated when an agency lands. Don't build agency-aware UI yet, but stop the future schema migration.
2. **Tenant-level branding hooks.** `logoUrl`, `brandColor`, `productName`, `supportEmail` — all nullable, populated for white-label tenants. Don't theme the UI yet, but render through the variables so theming is one config flip later.
3. **AuditEvent attribution must support "actor on behalf of tenant."** Every state change records: actor user, actor role, target tenant. Important for legal defensibility ("Earnscliffe consultant Sarah filed this on behalf of Deep Sky") and for agency invoicing reports.
4. **Cross-tenant queries are gated by agency membership.** An agency user sees aggregated data across their managed clients; a direct user never sees other tenants. Permission model needs both shapes.
5. **Onboarding flow must support agency-led.** Today: client signs up themselves. Future: agency creates the tenant, invites the client's CEO to certify. Different flow, same data model.

## What we explicitly do NOT do yet

- Agency dashboard UI (mockup exists at `prototypes/Agency-Dashboard.html` for shape, no production build)
- White-label theming engine
- Agency-level billing / invoice rollup
- Cross-tenant analytics views
- Bulk operations across client tenants

These are real Phase 4–5 builds. The point of the parked doc is to make sure we don't *foreclose* them with bad architectural choices today.

## Connection to the gov-platform parked motion

Both big strategic moves use the same playbook: build the platform, let someone else own the customer relationship, capture the underlying technical value.

- **Gov-side white-label:** sell to commissioner's offices who run it as their own administrative system.
- **Agency white-label:** sell to GR firms who run it as their own client-service tool.

The skill of "operating a white-label / licensed SaaS" is transferable across both motions. That's not coincidence — that's a coherent company shape. Auto Lobby is, structurally, a *protocol layer* for Canadian lobbying compliance, with multiple distribution surfaces above it.

## Triggers for activating the agency motion

- Phase 3 ships and ≥1 direct-customer design partner is live
- A GR firm approaches us unprompted (asking about bulk client onboarding, white-label, or multi-client management)
- Direct-sales acquisition cost climbs above what an agency deal would yield in tenants
- A competitor announces an agency motion and we need to respond
- We hit organic referrals from one client to another's firm — early signal that firms are noticing

## Open questions

- **Pricing model:** flat per-tenant fee to the agency, or per-named-lobbyist seat with agency volume discount?
- **Direct-vs-agency conflict:** if a client signed up direct and later their GR firm signs on, who owns the relationship?
- **White-label depth:** logo + colors only, or full re-skin including custom domain (`compliance.earnscliffe.ca`) and zero Auto Lobby attribution?
- **Sales motion:** founder-led for the first 3 firms? Channel-partner program later? GR-firm advisory board to validate features?
- **Compliance liability:** when an agency consultant files on behalf of a client, who carries the legal liability if a draft was wrong? (Probably the registrant/CEO who certified — but contracts and ToS need to reflect this.)

## Context for whoever resumes

- Idea logged 2026-04-30 by Jason (jason@deepskyclimate.com), founder of Deep Sky Climate, late in Phase 1 build day after the calendar-confirm-UX parked-doc conversation surfaced the multi-persona model.
- Jason's framing: "make this a tool for a law firm or GR firm that manages registrations on behalf of clients. They could whitelabel or just offer it as branded and still bill their clients as part of their retainer."
- Strategic insight: this doesn't compete with the direct GTM — it extends it. The same platform serves both.
- See `prototypes/Agency-Dashboard.html` for the visual mockup of an agency portfolio view.
- The architectural notes in this doc are *not* parked — they're live constraints in CLAUDE.md and govern Phase 2+ decisions.
