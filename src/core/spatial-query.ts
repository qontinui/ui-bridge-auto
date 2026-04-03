/**
 * Spatial and proximity-based element queries.
 *
 * Enables finding elements by their spatial relationship to other elements
 * — "near", "above", "below", "leftOf", "rightOf". Operates on bounding
 * rects from the element registry (no DOM measurement needed at query time).
 */

import type { QueryableElement } from "./element-query";
import type { SpatialRelation } from "../types/region";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bounding rect extracted from an element's state. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Re-export for convenience. */
export interface NearQuery {
  /** Reference element to measure from. */
  element: QueryableElement;
  /** Maximum edge-to-edge distance in pixels. */
  maxDistance: number;
}

/**
 * Get the bounding rect from an element, returning `null` if unavailable.
 */
function getRect(el: QueryableElement): Rect | null {
  const state = el.getState();
  return state.rect ?? null;
}

// ---------------------------------------------------------------------------
// Center and distance
// ---------------------------------------------------------------------------

/**
 * Get the center point of an element's bounding rect.
 *
 * @param el - The element whose center to compute.
 * @returns `{ x, y }` at the center of the element's bounding rect.
 *          Returns `{ x: 0, y: 0 }` if the element has no rect.
 */
export function elementCenter(el: QueryableElement): { x: number; y: number } {
  const rect = getRect(el);
  if (!rect) {
    return { x: 0, y: 0 };
  }
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * Compute the minimum edge-to-edge pixel distance between two elements.
 *
 * If the elements overlap, the distance is 0. Unlike center-to-center
 * distance, this measures the gap between the closest edges.
 *
 * @param a - First element.
 * @param b - Second element.
 * @returns The minimum distance in pixels, or `Infinity` if either
 *          element has no bounding rect.
 */
export function elementDistance(a: QueryableElement, b: QueryableElement): number {
  const ra = getRect(a);
  const rb = getRect(b);
  if (!ra || !rb) return Infinity;

  // Gap on each axis (negative means overlap on that axis)
  const gapX = Math.max(0, Math.max(ra.x, rb.x) - Math.min(ra.x + ra.width, rb.x + rb.width));
  const gapY = Math.max(0, Math.max(ra.y, rb.y) - Math.min(ra.y + ra.height, rb.y + rb.height));

  return Math.sqrt(gapX * gapX + gapY * gapY);
}

// ---------------------------------------------------------------------------
// Spatial relation
// ---------------------------------------------------------------------------

/**
 * Compute the spatial relation of element `a` relative to element `b`.
 *
 * Determines whether `a` is above, below, left of, right of, inside,
 * overlapping, or simply near `b`.
 *
 * @param a - The element whose position to describe.
 * @param b - The reference element.
 * @returns The dominant spatial relation.
 */
export function computeRelation(a: QueryableElement, b: QueryableElement): SpatialRelation {
  const ra = getRect(a);
  const rb = getRect(b);
  if (!ra || !rb) return "near";

  // Check containment
  if (
    ra.x >= rb.x &&
    ra.y >= rb.y &&
    ra.x + ra.width <= rb.x + rb.width &&
    ra.y + ra.height <= rb.y + rb.height
  ) {
    return "inside";
  }

  // Check overlap
  const overlapsX = ra.x < rb.x + rb.width && ra.x + ra.width > rb.x;
  const overlapsY = ra.y < rb.y + rb.height && ra.y + ra.height > rb.y;
  if (overlapsX && overlapsY) {
    return "overlaps";
  }

  // Directional: compare centers
  const acx = ra.x + ra.width / 2;
  const acy = ra.y + ra.height / 2;
  const bcx = rb.x + rb.width / 2;
  const bcy = rb.y + rb.height / 2;

  const dx = acx - bcx;
  const dy = acy - bcy;

  if (Math.abs(dy) > Math.abs(dx)) {
    return dy < 0 ? "above" : "below";
  }

  if (dx !== 0) {
    return dx < 0 ? "leftOf" : "rightOf";
  }

  return "near";
}

// ---------------------------------------------------------------------------
// Proximity search
// ---------------------------------------------------------------------------

/**
 * Find elements within a maximum pixel distance of a reference element.
 *
 * Uses edge-to-edge distance (not center-to-center). The reference
 * element itself is excluded from results.
 *
 * @param elements - All elements to search through.
 * @param reference - The reference element.
 * @param maxDistance - Maximum edge-to-edge distance in pixels.
 * @returns Elements within `maxDistance` pixels, sorted by distance
 *          (nearest first).
 */
export function findNear(
  elements: QueryableElement[],
  reference: QueryableElement,
  maxDistance: number,
): QueryableElement[] {
  const results: Array<{ el: QueryableElement; dist: number }> = [];

  for (const el of elements) {
    if (el.id === reference.id) continue;

    const dist = elementDistance(el, reference);
    if (dist <= maxDistance) {
      results.push({ el, dist });
    }
  }

  // Sort by distance ascending
  results.sort((a, b) => a.dist - b.dist);
  return results.map((r) => r.el);
}

// ---------------------------------------------------------------------------
// Relation-based search
// ---------------------------------------------------------------------------

/**
 * Find elements that have a specific spatial relation to a reference element.
 *
 * For directional relations (above, below, leftOf, rightOf), an optional
 * tolerance in pixels allows elements that are slightly off-axis to still
 * match.
 *
 * @param elements - All elements to search through.
 * @param reference - The reference element.
 * @param relation - The desired spatial relation.
 * @param tolerance - Pixel tolerance for directional alignment (default 0).
 * @returns Matching elements (reference excluded).
 */
export function findByRelation(
  elements: QueryableElement[],
  reference: QueryableElement,
  relation: SpatialRelation,
  tolerance: number = 0,
): QueryableElement[] {
  const refRect = getRect(reference);
  if (!refRect) return [];

  const results: QueryableElement[] = [];

  for (const el of elements) {
    if (el.id === reference.id) continue;
    const elRect = getRect(el);
    if (!elRect) continue;

    if (matchesRelation(elRect, refRect, relation, tolerance)) {
      results.push(el);
    }
  }

  return results;
}

/**
 * Check whether element rect `a` has the given spatial relation to
 * reference rect `b`, with optional tolerance for directional checks.
 */
function matchesRelation(
  a: Rect,
  b: Rect,
  relation: SpatialRelation,
  tolerance: number,
): boolean {
  switch (relation) {
    case "above":
      // a's bottom edge is above (or at) b's top edge
      // and a horizontally overlaps b (within tolerance)
      return (
        a.y + a.height <= b.y + tolerance &&
        a.x < b.x + b.width + tolerance &&
        a.x + a.width > b.x - tolerance
      );

    case "below":
      return (
        a.y >= b.y + b.height - tolerance &&
        a.x < b.x + b.width + tolerance &&
        a.x + a.width > b.x - tolerance
      );

    case "leftOf":
      return (
        a.x + a.width <= b.x + tolerance &&
        a.y < b.y + b.height + tolerance &&
        a.y + a.height > b.y - tolerance
      );

    case "rightOf":
      return (
        a.x >= b.x + b.width - tolerance &&
        a.y < b.y + b.height + tolerance &&
        a.y + a.height > b.y - tolerance
      );

    case "inside":
      return (
        a.x >= b.x &&
        a.y >= b.y &&
        a.x + a.width <= b.x + b.width &&
        a.y + a.height <= b.y + b.height
      );

    case "overlaps": {
      const ox = a.x < b.x + b.width && a.x + a.width > b.x;
      const oy = a.y < b.y + b.height && a.y + a.height > b.y;
      return ox && oy;
    }

    case "near":
      // "near" is handled by distance-based checks; accept anything
      return true;

    default:
      return false;
  }
}
