import { describe, it, expect, beforeEach } from "vitest";
import {
  elementCenter,
  elementDistance,
  findNear,
  computeRelation,
  findByRelation,
} from "../../core/spatial-query";
import { createButton, resetIdCounter } from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

/** Helper: create a button positioned at (x, y) with given size. */
function positionedButton(
  label: string,
  x: number,
  y: number,
  width = 50,
  height = 30,
) {
  const el = createButton(label, {
    state: { rect: { x, y, width, height } },
  });
  return el;
}

// ---------------------------------------------------------------------------
// elementCenter
// ---------------------------------------------------------------------------

describe("elementCenter", () => {
  it("computes correct center point", () => {
    const el = positionedButton("A", 100, 200, 60, 40);
    const center = elementCenter(el);
    expect(center.x).toBe(130); // 100 + 60/2
    expect(center.y).toBe(220); // 200 + 40/2
  });

  it("returns (0,0) when element has no rect", () => {
    const el = createButton("B", { state: { rect: undefined } });
    const center = elementCenter(el);
    expect(center.x).toBe(0);
    expect(center.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// elementDistance
// ---------------------------------------------------------------------------

describe("elementDistance", () => {
  it("returns 0 for adjacent/touching elements", () => {
    const a = positionedButton("A", 0, 0, 50, 30);
    const b = positionedButton("B", 50, 0, 50, 30); // touching right edge
    expect(elementDistance(a, b)).toBe(0);
  });

  it("returns 0 for overlapping elements", () => {
    const a = positionedButton("A", 0, 0, 100, 100);
    const b = positionedButton("B", 50, 50, 100, 100);
    expect(elementDistance(a, b)).toBe(0);
  });

  it("returns positive distance for separated elements", () => {
    const a = positionedButton("A", 0, 0, 50, 30);
    const b = positionedButton("B", 200, 0, 50, 30);
    const dist = elementDistance(a, b);
    expect(dist).toBeGreaterThan(0);
    // Gap is 150 pixels horizontally, 0 vertically
    expect(dist).toBe(150);
  });

  it("returns Infinity when element has no rect", () => {
    const a = positionedButton("A", 0, 0);
    const b = createButton("B", { state: { rect: undefined } });
    expect(elementDistance(a, b)).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// findNear
// ---------------------------------------------------------------------------

describe("findNear", () => {
  it("finds elements within max distance", () => {
    const ref = positionedButton("Ref", 100, 100);
    const near = positionedButton("Near", 160, 100); // 10px gap
    const far = positionedButton("Far", 500, 500);

    const results = findNear([ref, near, far], ref, 50);
    expect(results.map((r) => r.id)).toContain(near.id);
    expect(results.map((r) => r.id)).not.toContain(far.id);
  });

  it("excludes the reference element itself", () => {
    const ref = positionedButton("Ref", 100, 100);
    const results = findNear([ref], ref, 1000);
    expect(results).toHaveLength(0);
  });

  it("returns empty array when no elements are nearby", () => {
    const ref = positionedButton("Ref", 0, 0);
    const far = positionedButton("Far", 1000, 1000);
    const results = findNear([ref, far], ref, 5);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeRelation
// ---------------------------------------------------------------------------

describe("computeRelation", () => {
  it("detects element above reference", () => {
    const ref = positionedButton("Ref", 100, 200, 50, 30);
    const above = positionedButton("Above", 100, 50, 50, 30);
    expect(computeRelation(above, ref)).toBe("above");
  });

  it("detects element below reference", () => {
    const ref = positionedButton("Ref", 100, 100, 50, 30);
    const below = positionedButton("Below", 100, 300, 50, 30);
    expect(computeRelation(below, ref)).toBe("below");
  });

  it("detects element left of reference", () => {
    const ref = positionedButton("Ref", 300, 100, 50, 30);
    const left = positionedButton("Left", 50, 100, 50, 30);
    expect(computeRelation(left, ref)).toBe("leftOf");
  });

  it("detects element right of reference", () => {
    const ref = positionedButton("Ref", 100, 100, 50, 30);
    const right = positionedButton("Right", 400, 100, 50, 30);
    expect(computeRelation(right, ref)).toBe("rightOf");
  });
});

// ---------------------------------------------------------------------------
// findByRelation
// ---------------------------------------------------------------------------

describe("findByRelation", () => {
  it("filters elements by relation", () => {
    const ref = positionedButton("Ref", 200, 200, 50, 30);
    const above = positionedButton("Above", 200, 50, 50, 30);
    const below = positionedButton("Below", 200, 400, 50, 30);
    const left = positionedButton("Left", 10, 200, 50, 30);

    const aboveResults = findByRelation([ref, above, below, left], ref, "above");
    expect(aboveResults.map((r) => r.id)).toContain(above.id);
    expect(aboveResults.map((r) => r.id)).not.toContain(below.id);
  });

  it("excludes reference element from results", () => {
    const ref = positionedButton("Ref", 100, 100);
    const results = findByRelation([ref], ref, "above");
    expect(results).toHaveLength(0);
  });
});
