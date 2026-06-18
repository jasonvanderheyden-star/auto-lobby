import { describe, it, expect } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { MaceMark, BrandTile, BrandLockup } from "@/components/Brand";

/**
 * The vitest environment here is `node` with no jsdom/testing-library, so we do
 * not render to the DOM. Instead we invoke each component as the pure function
 * it is and introspect the returned React element tree (type / props / children).
 * That is enough to guard the structural contract of the shared brand mark.
 */

type AnyElement = ReactElement<{ children?: ReactNode } & Record<string, unknown>>;

function isElement(node: unknown): node is AnyElement {
  return typeof node === "object" && node !== null && "type" in (node as object) && "props" in (node as object);
}

/** Flatten a React node's children into a list (depth-first, elements + primitives). */
function childrenOf(node: AnyElement): ReactNode[] {
  const kids = node.props.children;
  if (kids === undefined || kids === null) return [];
  return Array.isArray(kids) ? kids.flat(Infinity) : [kids];
}

/**
 * Recursively collect every element whose `type` matches `target` — either a
 * string DOM tag ("svg") or a component function reference (MaceMark). We do not
 * render, so nested components stay as function-typed elements; to look *inside*
 * them we walk their declared `children` only. That is enough for these structural
 * lockup/tile assertions.
 */
function findByType(node: ReactNode, target: string | unknown, acc: AnyElement[] = []): AnyElement[] {
  if (!isElement(node)) return acc;
  if (node.type === target) acc.push(node);
  for (const child of childrenOf(node)) findByType(child, target, acc);
  return acc;
}

/** Concatenate all string/number leaves under a node into one string. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  return childrenOf(node).map(textOf).join("");
}

describe("MaceMark", () => {
  it("happy path: renders an <svg> without throwing", () => {
    const el = MaceMark({});
    expect(isElement(el)).toBe(true);
    expect((el as AnyElement).type).toBe("svg");
    // The mace is drawn from line/circle/rect primitives — sanity-check it isn't empty.
    expect(childrenOf(el as AnyElement).length).toBeGreaterThan(0);
  });

  it("edge case: respects a custom size prop on width and height", () => {
    const el = MaceMark({ size: 64 }) as AnyElement;
    expect(el.props.width).toBe(64);
    expect(el.props.height).toBe(64);
    // viewBox stays fixed regardless of size (the contract that makes it scalable).
    expect(el.props.viewBox).toBe("0 0 48 48");
  });

  it("defaults to size 28 when no size is given", () => {
    const el = MaceMark({}) as AnyElement;
    expect(el.props.width).toBe(28);
    expect(el.props.height).toBe(28);
  });

  it("forwards a custom className", () => {
    const el = MaceMark({ className: "text-emerald-700" }) as AnyElement;
    expect(el.props.className).toBe("text-emerald-700");
  });
});

describe("BrandTile", () => {
  it("happy path: renders an ink tile wrapping a MaceMark", () => {
    const el = BrandTile({}) as AnyElement;
    expect(isElement(el)).toBe(true);
    expect(el.type).toBe("span");
    // Without a DOM render the nested MaceMark stays a component element.
    const marks = findByType(el, MaceMark);
    expect(marks.length).toBe(1);
    const mark = marks[0]!;
    // ...and its rendered output is an <svg> when invoked.
    expect((MaceMark(mark.props as { size?: number }) as AnyElement).type).toBe("svg");
  });

  it("edge case: tile size flows to its width/height and to a 0.62-scaled mark", () => {
    const el = BrandTile({ size: 50 }) as AnyElement;
    expect(el.props.style).toMatchObject({ width: 50, height: 50 });
    const marks = findByType(el, MaceMark);
    expect(marks.length).toBe(1);
    expect((marks[0]!.props as { size?: number }).size).toBe(50 * 0.62);
  });
});

describe("BrandLockup", () => {
  it("happy path: renders the wordmark and the powered-by tagline", () => {
    const el = BrandLockup() as AnyElement;
    const text = textOf(el);
    expect(text).toContain("Auto Lobby");
    expect(text).toContain("powered by Whiphand");
  });

  it("includes the brand mace mark in the lockup (via BrandTile)", () => {
    const el = BrandLockup() as AnyElement;
    // BrandLockup -> BrandTile -> MaceMark; both nested components are present.
    expect(findByType(el, BrandTile).length).toBe(1);
  });
});
