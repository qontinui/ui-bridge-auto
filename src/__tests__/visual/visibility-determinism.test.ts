/**
 * Determinism gate for `computeVisibility` (Section 8).
 *
 * Same registry + same viewport + same overlay state → byte-identical
 * `VisibilityReport` 10× back-to-back. Mirrors the structure of the
 * Section 7 hypothesis-engine determinism gate
 * (`__tests__/drift/hypothesis-determinism.test.ts`). If this ever
 * fails, the visibility module has acquired a non-determinism leak
 * (Map iteration order, unstable sort, `Date.now()`, transient DOM
 * read order, etc.). Fix the leak — do NOT relax the test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetVisibilityCache,
  computeVisibility,
} from "../../visual/visibility";
import type { QueryableElement } from "../../core/element-query";

const RUNS = 10;

beforeEach(() => {
  document.body.innerHTML = "";
  _resetVisibilityCache();
});

function makeElement(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
): QueryableElement {
  const el = document.createElement("div");
  el.setAttribute("data-id", id);
  document.body.appendChild(el);
  return {
    id,
    element: el,
    type: "div",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: "",
      rect,
    }),
  };
}

describe("computeVisibility determinism", () => {
  it("produces byte-identical output across 10 runs (no occlusion)", () => {
    const target = makeElement("target", { x: 0, y: 0, width: 100, height: 100 });
    const registry = [target];
    const viewport = { x: 0, y: 0, width: 1000, height: 1000 };

    const first = JSON.stringify(computeVisibility(target, registry, viewport));
    for (let i = 0; i < RUNS - 1; i++) {
      const next = JSON.stringify(
        computeVisibility(target, registry, viewport),
      );
      expect(next).toBe(first);
    }
  });

  it("produces byte-identical output across 10 runs (with two occluders)", () => {
    const target = makeElement("target", { x: 0, y: 0, width: 100, height: 100 });
    const overA = makeElement("over-a", { x: 0, y: 0, width: 60, height: 100 });
    const overB = makeElement("over-b", { x: 50, y: 0, width: 60, height: 100 });
    const registry = [target, overA, overB];
    const viewport = { x: 0, y: 0, width: 1000, height: 1000 };

    const first = JSON.stringify(computeVisibility(target, registry, viewport));
    for (let i = 0; i < RUNS - 1; i++) {
      const next = JSON.stringify(
        computeVisibility(target, registry, viewport),
      );
      expect(next).toBe(first);
    }
  });

  it("ignores registry input ordering (occluders sorted by id, not insertion)", () => {
    const target = makeElement("target", { x: 0, y: 0, width: 100, height: 100 });
    const overA = makeElement("z-over", { x: 0, y: 0, width: 50, height: 100 });
    const overB = makeElement("a-over", { x: 50, y: 0, width: 50, height: 100 });
    const viewport = { x: 0, y: 0, width: 1000, height: 1000 };

    const ascending = JSON.stringify(
      computeVisibility(target, [target, overA, overB], viewport),
    );
    const descending = JSON.stringify(
      computeVisibility(target, [overB, overA, target], viewport),
    );
    expect(ascending).toBe(descending);
  });
});
