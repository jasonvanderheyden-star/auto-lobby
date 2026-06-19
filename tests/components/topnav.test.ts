import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { TopNav } from "@/components/TopNav";

/**
 * Same approach as brand.test.ts: the vitest environment is `node` with no jsdom,
 * so we invoke TopNav as the pure function it is and introspect the returned React
 * element tree. We do not render — nested components (Link, BrandLockup) stay as
 * function-typed elements, which is enough to assert the structural nav contract:
 * which links exist, their hrefs, their order, and the active styling.
 */

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function isElement(node: unknown): node is AnyElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in (node as object) &&
    "props" in (node as object)
  );
}

/** Flatten a React node's children into a flat list (depth-first). */
function childrenOf(node: AnyElement): ReactNode[] {
  const kids = node.props.children;
  if (kids === undefined || kids === null) return [];
  return Array.isArray(kids) ? kids.flat(Infinity) : [kids];
}

/** Concatenate all string/number leaves under a node into one string. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  return childrenOf(node).map(textOf).join("");
}

/** Collect every element that carries an `href` prop (i.e. a Link). */
function allHrefLinks(node: ReactNode, acc: AnyElement[] = []): AnyElement[] {
  if (!isElement(node)) return acc;
  if (typeof node.props.href === "string") acc.push(node);
  for (const child of childrenOf(node)) allHrefLinks(child, acc);
  return acc;
}

/** The canonical nav items carry a text label; the brand link wraps BrandLockup. */
function labeledNavItems(el: AnyElement): { label: string; href: string; className: string }[] {
  return allHrefLinks(el)
    .map((link) => ({
      label: textOf(link),
      href: link.props.href as string,
      className: (link.props.className as string) ?? "",
    }))
    // Drop the brand lockup link: it has an href (/dashboard) but no text label
    // (its child is the BrandLockup component, which textOf can't read without a render).
    .filter((item) => item.label.length > 0);
}

const ACTIVE_CLASS = "px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 font-medium";

describe("TopNav — canonical links", () => {
  it("happy path: renders Dashboard, Filings, Registry, Settings in order with correct hrefs", () => {
    const el = TopNav({ active: "dashboard" }) as AnyElement;
    const items = labeledNavItems(el);

    expect(items).toEqual([
      { label: "Dashboard", href: "/dashboard", className: expect.any(String) },
      { label: "Filings", href: "/filings", className: expect.any(String) },
      { label: "Registry", href: "/registry-search", className: expect.any(String) },
      { label: "Settings", href: "/settings/calendars", className: expect.any(String) },
    ]);
  });

  it("always renders exactly the four canonical items when showAgency is absent", () => {
    const el = TopNav({ active: "filings" }) as AnyElement;
    const labels = labeledNavItems(el).map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Filings", "Registry", "Settings"]);
    expect(labels).toHaveLength(4);
  });
});

describe("TopNav — Agency gating (non-negotiable #7)", () => {
  it("edge case: does NOT render the Agency link when showAgency is undefined", () => {
    const el = TopNav({ active: "dashboard" }) as AnyElement;
    const items = labeledNavItems(el);
    expect(items.some((i) => i.label === "Agency")).toBe(false);
    expect(items.some((i) => i.href === "/agency")).toBe(false);
  });

  it("edge case: does NOT render the Agency link when showAgency is explicitly false", () => {
    const el = TopNav({ active: "dashboard", showAgency: false }) as AnyElement;
    const items = labeledNavItems(el);
    expect(items.some((i) => i.label === "Agency")).toBe(false);
    expect(items.some((i) => i.href === "/agency")).toBe(false);
  });

  it("renders the Agency link (last, href /agency) only when showAgency is true", () => {
    const el = TopNav({ active: "agency", showAgency: true }) as AnyElement;
    const items = labeledNavItems(el);
    const agency = items.find((i) => i.label === "Agency");
    expect(agency).toBeDefined();
    expect(agency!.href).toBe("/agency");
    // Appended last, after the four canonical items.
    expect(items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Filings",
      "Registry",
      "Settings",
      "Agency",
    ]);
  });
});

describe("TopNav — active state", () => {
  it("applies the active (periwinkle/emerald) class to the matching link and not the others", () => {
    const el = TopNav({ active: "filings" }) as AnyElement;
    const items = labeledNavItems(el);

    const filings = items.find((i) => i.label === "Filings")!;
    expect(filings.className).toBe(ACTIVE_CLASS);

    // Every other canonical link must NOT carry the active class.
    for (const item of items.filter((i) => i.label !== "Filings")) {
      expect(item.className).not.toBe(ACTIVE_CLASS);
    }
  });

  it("moves the active class when a different link is active", () => {
    const el = TopNav({ active: "registry" }) as AnyElement;
    const items = labeledNavItems(el);
    const registry = items.find((i) => i.label === "Registry")!;
    const dashboard = items.find((i) => i.label === "Dashboard")!;
    expect(registry.className).toBe(ACTIVE_CLASS);
    expect(dashboard.className).not.toBe(ACTIVE_CLASS);
  });
});
