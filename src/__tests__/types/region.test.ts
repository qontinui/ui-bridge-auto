import { describe, it, expect } from "vitest";
import {
  isInside,
  overlaps,
  distance,
  spatialRelation,
  normalizeRegion,
  type ViewportRegion,
} from "../../types/region";

describe("isInside", () => {
  it("returns true when inner is fully contained", () => {
    const outer: ViewportRegion = { x: 0, y: 0, width: 200, height: 200 };
    const inner: ViewportRegion = { x: 10, y: 10, width: 50, height: 50 };
    expect(isInside(inner, outer)).toBe(true);
  });

  it("returns true when inner equals outer", () => {
    const r: ViewportRegion = { x: 10, y: 10, width: 100, height: 100 };
    expect(isInside(r, r)).toBe(true);
  });

  it("returns false when inner extends beyond outer", () => {
    const outer: ViewportRegion = { x: 0, y: 0, width: 100, height: 100 };
    const inner: ViewportRegion = { x: 50, y: 50, width: 100, height: 100 };
    expect(isInside(inner, outer)).toBe(false);
  });

  it("returns false for non-overlapping regions", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 50, height: 50 };
    const b: ViewportRegion = { x: 200, y: 200, width: 50, height: 50 };
    expect(isInside(a, b)).toBe(false);
  });
});

describe("overlaps", () => {
  it("returns true for partially overlapping regions", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 100, height: 100 };
    const b: ViewportRegion = { x: 50, y: 50, width: 100, height: 100 };
    expect(overlaps(a, b)).toBe(true);
  });

  it("returns false for non-overlapping regions", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 50, height: 50 };
    const b: ViewportRegion = { x: 100, y: 100, width: 50, height: 50 };
    expect(overlaps(a, b)).toBe(false);
  });

  it("returns false for touching edges (no shared area)", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 50, height: 50 };
    const b: ViewportRegion = { x: 50, y: 0, width: 50, height: 50 };
    expect(overlaps(a, b)).toBe(false);
  });
});

describe("distance", () => {
  it("returns 0 for overlapping regions", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 100, height: 100 };
    const b: ViewportRegion = { x: 50, y: 50, width: 100, height: 100 };
    expect(distance(a, b)).toBe(0);
  });

  it("computes horizontal distance", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 50, height: 50 };
    const b: ViewportRegion = { x: 100, y: 0, width: 50, height: 50 };
    expect(distance(a, b)).toBe(50);
  });

  it("computes diagonal distance", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 10, height: 10 };
    const b: ViewportRegion = { x: 40, y: 40, width: 10, height: 10 };
    // gap x = 30, gap y = 30, dist = sqrt(1800) ≈ 42.43
    expect(distance(a, b)).toBeCloseTo(Math.sqrt(1800), 5);
  });
});

describe("spatialRelation", () => {
  it("returns inside for contained region", () => {
    const outer: ViewportRegion = { x: 0, y: 0, width: 200, height: 200 };
    const inner: ViewportRegion = { x: 10, y: 10, width: 50, height: 50 };
    expect(spatialRelation(inner, outer)).toBe("inside");
  });

  it("returns overlaps for partially overlapping", () => {
    const a: ViewportRegion = { x: 0, y: 0, width: 100, height: 100 };
    const b: ViewportRegion = { x: 50, y: 50, width: 100, height: 100 };
    expect(spatialRelation(a, b)).toBe("overlaps");
  });

  it("returns above when a is above b", () => {
    const a: ViewportRegion = { x: 100, y: 0, width: 50, height: 50 };
    const b: ViewportRegion = { x: 100, y: 200, width: 50, height: 50 };
    expect(spatialRelation(a, b)).toBe("above");
  });

  it("returns below when a is below b", () => {
    const a: ViewportRegion = { x: 100, y: 200, width: 50, height: 50 };
    const b: ViewportRegion = { x: 100, y: 0, width: 50, height: 50 };
    expect(spatialRelation(a, b)).toBe("below");
  });

  it("returns leftOf when a is to the left", () => {
    const a: ViewportRegion = { x: 0, y: 100, width: 50, height: 50 };
    const b: ViewportRegion = { x: 200, y: 100, width: 50, height: 50 };
    expect(spatialRelation(a, b)).toBe("leftOf");
  });

  it("returns rightOf when a is to the right", () => {
    const a: ViewportRegion = { x: 200, y: 100, width: 50, height: 50 };
    const b: ViewportRegion = { x: 0, y: 100, width: 50, height: 50 };
    expect(spatialRelation(a, b)).toBe("rightOf");
  });
});

describe("normalizeRegion", () => {
  it("normalizes to 0-1 range", () => {
    const r: ViewportRegion = { x: 100, y: 200, width: 50, height: 100 };
    const n = normalizeRegion(r, { width: 1000, height: 1000 });
    expect(n.x).toBeCloseTo(0.1);
    expect(n.y).toBeCloseTo(0.2);
    expect(n.width).toBeCloseTo(0.05);
    expect(n.height).toBeCloseTo(0.1);
  });

  it("returns zeros for zero-size viewport", () => {
    const r: ViewportRegion = { x: 10, y: 10, width: 50, height: 50 };
    const n = normalizeRegion(r, { width: 0, height: 0 });
    expect(n).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
