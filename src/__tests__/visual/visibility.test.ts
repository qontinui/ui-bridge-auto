/**
 * Unit tests for `computeVisibility` (Section 8).
 *
 * Cases: fully visible, off-screen, partially occluded, fully occluded,
 * known-overlay flag, ancestor-clipping, custom cache key reuse.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetVisibilityCache,
  computeVisibility,
} from "../../visual/visibility";
import type { QueryableElement } from "../../core/element-query";

beforeEach(() => {
  document.body.innerHTML = "";
  _resetVisibilityCache();
});

interface MakeOpts {
  rect: { x: number; y: number; width: number; height: number };
  parent?: HTMLElement;
  zIndex?: string;
  textContent?: string;
}

function make(id: string, opts: MakeOpts): QueryableElement {
  const el = document.createElement("div");
  if (opts.zIndex) {
    el.style.position = "absolute";
    el.style.zIndex = opts.zIndex;
  }
  if (opts.textContent) el.textContent = opts.textContent;
  (opts.parent ?? document.body).appendChild(el);
  return {
    id,
    element: el,
    type: "div",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: opts.textContent ?? "",
      rect: opts.rect,
    }),
  };
}

const VIEW = { x: 0, y: 0, width: 1000, height: 1000 };

describe("computeVisibility", () => {
  it("reports a fully-visible element with no occluders as visible=true ratio=1", () => {
    const target = make("t", { rect: { x: 10, y: 10, width: 100, height: 50 } });
    const r = computeVisibility(target, [target], VIEW);
    expect(r.visible).toBe(true);
    expect(r.visibleRatio).toBeCloseTo(1, 5);
    expect(r.offscreen).toBe(false);
    expect(r.occludedBy).toHaveLength(0);
    expect(r.clippedByAncestor).toBe(false);
  });

  it("reports an off-screen element as offscreen=true visible=false", () => {
    const target = make("t", {
      rect: { x: 2000, y: 2000, width: 100, height: 50 },
    });
    const r = computeVisibility(target, [target], VIEW);
    expect(r.offscreen).toBe(true);
    expect(r.visible).toBe(false);
    expect(r.visibleRatio).toBeCloseTo(0, 5);
  });

  it("flags a partial occluder and computes a partial ratio", () => {
    const target = make("t", { rect: { x: 0, y: 0, width: 100, height: 100 } });
    // Later DOM-order paints above; covers half of the target.
    const cover = make("cover", {
      rect: { x: 0, y: 0, width: 50, height: 100 },
    });
    const r = computeVisibility(target, [target, cover], VIEW);
    expect(r.occludedBy).toHaveLength(1);
    expect(r.occludedBy[0]?.id).toBe("cover");
    expect(r.occludedBy[0]?.ratio).toBeCloseTo(0.5, 2);
    expect(r.visibleRatio).toBeCloseTo(0.5, 2);
    expect(r.visible).toBe(false);
  });

  it("respects the isKnownOverlay predicate", () => {
    const target = make("t", { rect: { x: 0, y: 0, width: 100, height: 100 } });
    const cover = make("cover", {
      rect: { x: 0, y: 0, width: 100, height: 100 },
      zIndex: "10",
    });
    const r = computeVisibility(target, [target, cover], VIEW, {
      isKnownOverlay: (el) => el === cover.element,
    });
    expect(r.occludedBy[0]?.isExpectedOverlay).toBe(true);
  });

  it("does not consider an earlier sibling as an occluder when no z-index is set", () => {
    // earlier-in-DOM paints below later-in-DOM by default.
    const earlier = make("earlier", {
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    const target = make("t", {
      rect: { x: 0, y: 0, width: 100, height: 100 },
    });
    const r = computeVisibility(target, [earlier, target], VIEW);
    // `earlier` is in DOM before `target`, so it paints below target.
    expect(r.occludedBy).toHaveLength(0);
    expect(r.visibleRatio).toBeCloseTo(1, 5);
  });

  it("flags ancestor clipping when overflow:hidden parent crops the element", () => {
    const wrapper = document.createElement("div");
    wrapper.style.overflow = "hidden";
    // jsdom's getBoundingClientRect returns zeros — emulate the parent box
    // by using an inline style (jsdom returns the layout-set rect for
    // some properties). We construct the target so it sits visually
    // outside its parent: parent is 50x50 at (0,0), child is at (100, 0)
    // 50x50 — definitely outside the parent box.
    Object.defineProperty(wrapper, "getBoundingClientRect", {
      value: () => ({
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        left: 0,
        top: 0,
        right: 50,
        bottom: 50,
        toJSON: () => ({}),
      }),
    });
    document.body.appendChild(wrapper);

    const targetEl = document.createElement("div");
    Object.defineProperty(targetEl, "getBoundingClientRect", {
      value: () => ({
        x: 100,
        y: 0,
        width: 50,
        height: 50,
        left: 100,
        top: 0,
        right: 150,
        bottom: 50,
        toJSON: () => ({}),
      }),
    });
    wrapper.appendChild(targetEl);

    const target: QueryableElement = {
      id: "t",
      element: targetEl,
      type: "div",
      getState: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: "",
        rect: { x: 100, y: 0, width: 50, height: 50 },
      }),
    };

    const r = computeVisibility(target, [target], VIEW);
    expect(r.clippedByAncestor).toBe(true);
    expect(r.visible).toBe(false);
  });

  it("returns the same report from cache on second call with same key", () => {
    const target = make("t", { rect: { x: 0, y: 0, width: 100, height: 100 } });
    const a = computeVisibility(target, [target], VIEW, { cacheKey: "k1" });
    // Mutate the rect (a getState invocation now returns different data)
    // to prove the cached result is being returned, not recomputed.
    const stale = JSON.stringify(a);
    Object.defineProperty(target, "getState", {
      value: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: "",
        rect: { x: 99999, y: 99999, width: 1, height: 1 },
      }),
    });
    const b = computeVisibility(target, [target], VIEW, { cacheKey: "k1" });
    expect(JSON.stringify(b)).toBe(stale);
  });
});
