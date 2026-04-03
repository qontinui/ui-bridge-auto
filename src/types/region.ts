/**
 * Viewport regions and spatial relationships between elements.
 *
 * Provides geometric primitives for spatial queries — determining whether
 * elements are above, below, left of, right of, inside, or near other
 * elements. All coordinates are in viewport pixels unless normalised.
 */

import type { ElementCriteria } from "./match";

// ---------------------------------------------------------------------------
// Region types
// ---------------------------------------------------------------------------

/** A rectangular region in viewport coordinates (pixels). */
export interface ViewportRegion {
  /** X offset from viewport left edge (px). */
  x: number;
  /** Y offset from viewport top edge (px). */
  y: number;
  /** Region width (px). */
  width: number;
  /** Region height (px). */
  height: number;
}

/**
 * A rectangular region normalised to the viewport dimensions.
 * All values are in the range 0.0-1.0, where (0,0) is the top-left
 * corner and (1,1) is the bottom-right corner of the viewport.
 */
export interface NormalizedRegion {
  /** Normalised X offset (0.0-1.0). */
  x: number;
  /** Normalised Y offset (0.0-1.0). */
  y: number;
  /** Normalised width (0.0-1.0). */
  width: number;
  /** Normalised height (0.0-1.0). */
  height: number;
}

// ---------------------------------------------------------------------------
// Spatial relationships
// ---------------------------------------------------------------------------

/** Named spatial relationships between two regions. */
export type SpatialRelation =
  | "above"
  | "below"
  | "leftOf"
  | "rightOf"
  | "inside"
  | "overlaps"
  | "near";

/**
 * A query that finds elements by their spatial relationship to a reference element.
 */
export interface SpatialQuery {
  /** The spatial relationship to check. */
  relation: SpatialRelation;
  /** Criteria to find the reference element. */
  reference: ElementCriteria;
  /** Maximum pixel distance for the "near" relation. */
  maxDistance?: number;
}

// ---------------------------------------------------------------------------
// Spatial functions
// ---------------------------------------------------------------------------

/**
 * Check whether the inner region is completely contained within the outer region.
 */
export function isInside(inner: ViewportRegion, outer: ViewportRegion): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Check whether two regions overlap (share any area).
 */
export function overlaps(a: ViewportRegion, b: ViewportRegion): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Compute the minimum Euclidean distance between two regions.
 * Returns 0 if the regions overlap.
 */
export function distance(a: ViewportRegion, b: ViewportRegion): number {
  // Compute gap on each axis; negative gap means overlap on that axis
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));

  return Math.sqrt(gapX * gapX + gapY * gapY);
}

/**
 * Determine the dominant spatial relationship between region `a` relative
 * to region `b`. Returns the most descriptive relationship.
 *
 * Priority: inside > overlaps > above/below/leftOf/rightOf > near.
 */
export function spatialRelation(a: ViewportRegion, b: ViewportRegion): SpatialRelation {
  // Check containment first
  if (isInside(a, b)) return "inside";
  if (overlaps(a, b)) return "overlaps";

  // Compute centers for directional comparison
  const aCenterX = a.x + a.width / 2;
  const aCenterY = a.y + a.height / 2;
  const bCenterX = b.x + b.width / 2;
  const bCenterY = b.y + b.height / 2;

  const dx = aCenterX - bCenterX;
  const dy = aCenterY - bCenterY;

  // If the vertical separation is greater than horizontal, use above/below
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? "above" : "below";
  }

  // Otherwise use left/right
  if (dx !== 0) {
    return dx < 0 ? "leftOf" : "rightOf";
  }

  // Fallback: regions are in the exact same position but don't overlap
  return "near";
}

/**
 * Convert a viewport-pixel region to normalised 0.0-1.0 coordinates.
 */
export function normalizeRegion(
  region: ViewportRegion,
  viewport: { width: number; height: number },
): NormalizedRegion {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return {
    x: region.x / viewport.width,
    y: region.y / viewport.height,
    width: region.width / viewport.width,
    height: region.height / viewport.height,
  };
}
