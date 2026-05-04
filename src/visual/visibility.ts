/**
 * Visibility scoring (Section 8 — visual + semantic fusion).
 *
 * Pure function over a registry snapshot + viewport rect. Classifies an
 * element as visible, off-screen, occluded, or clipped by an ancestor,
 * and (when occluded) names which other registered element(s) sit on top
 * of it and whether the topmost of those is a known overlay.
 *
 * Determinism: every internal collection is sorted before iteration; no
 * `Date.now()`, no `Math.random()`, no DOM-traversal-order leaks. Same
 * registry + same viewport + same overlay state → byte-identical
 * `VisibilityReport` 10× back-to-back. The `__tests__/visual/
 * visibility-determinism.test.ts` gate enforces this.
 */

import type { QueryableElement } from "../core/element-query";
import type { OverlayDetector } from "../discovery/overlay-detector";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A 2D rect in viewport coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pluggable hook for asking "is `el` a known overlay?" V1 accepts a function
 * so callers can wire it to an `OverlayDetector.isKnownOverlay` bound method
 * (the recommended adapter) OR substitute a stub in tests without spinning
 * up a real detector + MutationObserver. Returning `false` always (no hook)
 * is a valid degraded mode.
 */
export type OverlayPredicate = (el: HTMLElement) => boolean;

/**
 * One element occluding the target. `ratio` is the fraction of the target's
 * area covered by this occluder (0..1). `isExpectedOverlay` distinguishes
 * "covered by a tracked modal/dropdown" (expected) from "covered by a
 * sibling that probably shouldn't be there" (likely layout bug).
 */
export interface VisibilityOccluder {
  id: string;
  ratio: number;
  isExpectedOverlay: boolean;
}

/**
 * Output of `computeVisibility`. The boolean `visible` is `true` only when
 * `visibleRatio >= 1.0 - epsilon` AND no occluder covers the element AND
 * the element is not clipped by an ancestor. Callers wanting a softer
 * threshold should consult `visibleRatio` directly.
 */
export interface VisibilityReport {
  visible: boolean;
  /**
   * Visible fraction (0..1). 1.0 = fully visible inside the viewport with
   * no occluders. 0 = fully off-screen or fully covered.
   */
  visibleRatio: number;
  /** True when the element's rect lies entirely outside the viewport. */
  offscreen: boolean;
  /**
   * Elements covering the target, sorted ascending by id (NOT by ratio).
   * Sorting by id keeps the report byte-deterministic; consumers that want
   * "the biggest occluder" should max-by-ratio in their own code.
   */
  occludedBy: VisibilityOccluder[];
  /**
   * True when the target's rect is clipped by an ancestor's `overflow:
   * hidden` / `overflow: clip` / `clip-path`. Detected by walking parents
   * and checking computed styles.
   */
  clippedByAncestor: boolean;
}

/** Optional inputs to `computeVisibility`. */
export interface ComputeVisibilityOptions {
  /**
   * Caller-supplied opaque cache key. If two `computeVisibility` calls pass
   * the same `cacheKey` AND the same `target.id`, the result is reused from
   * an internal LRU. The function does NOT inspect the registry to decide
   * cache validity — that responsibility lies with the caller, who must
   * change the key whenever the registry / viewport / overlay state changes
   * in a way that would alter the report.
   *
   * Resolved per Section 8 vet finding #3 (no registry-revision counter
   * exists today). Passing `undefined` skips the cache.
   */
  cacheKey?: string;

  /** Hook letting the caller supply known-overlay classification. */
  isKnownOverlay?: OverlayPredicate;

  /**
   * Rendering bounds for clipping detection. When omitted, the function
   * uses `target.element.getBoundingClientRect()` for ancestor traversal
   * and DOM-walks the parent chain.
   */
  documentRoot?: HTMLElement;
}

// ---------------------------------------------------------------------------
// Internal cache (caller-supplied key)
// ---------------------------------------------------------------------------

/**
 * Cache entries are keyed on `(cacheKey, elementId)`. The cache is intentionally
 * small (LRU, fixed capacity) — visibility reports are cheap to compute, the
 * cache exists only to amortize repeated `findFirst` calls inside the same
 * query batch.
 */
const CACHE_CAPACITY = 256;
const visibilityCache = new Map<string, VisibilityReport>();

function cacheKeyFor(cacheKey: string, elementId: string): string {
  return `${cacheKey}::${elementId}`;
}

function getCached(key: string): VisibilityReport | undefined {
  const hit = visibilityCache.get(key);
  if (hit !== undefined) {
    // LRU touch.
    visibilityCache.delete(key);
    visibilityCache.set(key, hit);
  }
  return hit;
}

function setCached(key: string, report: VisibilityReport): void {
  if (visibilityCache.size >= CACHE_CAPACITY) {
    const first = visibilityCache.keys().next().value;
    if (first !== undefined) visibilityCache.delete(first);
  }
  visibilityCache.set(key, report);
}

/** Drop all cache entries. Test helper; not part of the public surface. */
export function _resetVisibilityCache(): void {
  visibilityCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a visibility report for `target` against `registry` + `viewport`.
 *
 * @param target - The element being asked about. Must have a non-null rect
 *   in its `getState()` for meaningful output.
 * @param registry - All elements known to the registry. Used to attribute
 *   occlusion to a specific id/element. Targets are excluded from the
 *   occluder set automatically.
 * @param viewport - The viewport rect (typically `{x: 0, y: 0,
 *   width: window.innerWidth, height: window.innerHeight}`).
 * @param options - Optional cache key, overlay predicate, document root.
 */
export function computeVisibility(
  target: QueryableElement,
  registry: QueryableElement[],
  viewport: Rect,
  options?: ComputeVisibilityOptions,
): VisibilityReport {
  // Cache lookup
  if (options?.cacheKey !== undefined) {
    const key = cacheKeyFor(options.cacheKey, target.id);
    const hit = getCached(key);
    if (hit !== undefined) return hit;
  }

  const targetState = target.getState();
  const targetRect = targetState.rect;
  if (!targetRect || targetRect.width === 0 || targetRect.height === 0) {
    const report: VisibilityReport = {
      visible: false,
      visibleRatio: 0,
      offscreen: false,
      occludedBy: [],
      clippedByAncestor: false,
    };
    cacheStore(options?.cacheKey, target.id, report);
    return report;
  }

  // 1. Off-screen check
  const visibleArea = intersectionArea(targetRect, viewport);
  const totalArea = targetRect.width * targetRect.height;
  const offscreen = visibleArea === 0;

  // 2. Ancestor clipping
  const clippedByAncestor = isClippedByAncestor(target.element);

  // 3. Occlusion: which other registered elements overlap?
  const isKnownOverlay = options?.isKnownOverlay ?? (() => false);
  const occluders: VisibilityOccluder[] = [];
  let occludedArea = 0;

  // Sort the registry deterministically by id so the occluder list (and
  // any `occludedArea` sum derived from it) is independent of the input
  // ordering.
  const sorted = [...registry].sort(byElementId);
  for (const candidate of sorted) {
    if (candidate.id === target.id) continue;
    const candidateState = candidate.getState();
    const candidateRect = candidateState.rect;
    if (!candidateRect) continue;
    if (candidateRect.width === 0 || candidateRect.height === 0) continue;

    // Only consider candidates that paint *above* the target. We use DOM
    // order + computed z-index as the heuristic — the same ordering rule
    // browsers fall back to in the absence of explicit stacking contexts.
    if (!paintsAbove(candidate.element, target.element)) continue;

    const overlap = intersectionArea(candidateRect, targetRect);
    if (overlap === 0) continue;

    occluders.push({
      id: candidate.id,
      ratio: overlap / totalArea,
      isExpectedOverlay: isKnownOverlay(candidate.element),
    });
    occludedArea += overlap;
  }

  // The visible fraction is the intersection-with-viewport area, minus any
  // occluded area, divided by the total target area. Clamp to [0, 1] —
  // overlapping occluders may double-count and push the raw value below 0.
  const occludedAndOffscreen = Math.min(
    totalArea,
    occludedArea + (totalArea - visibleArea),
  );
  const visibleRatio = clamp01(
    (totalArea - occludedAndOffscreen) / totalArea,
  );

  // Sort occluders by id for byte-deterministic output.
  occluders.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const epsilon = 1e-6;
  const visible =
    !offscreen &&
    !clippedByAncestor &&
    occluders.length === 0 &&
    visibleRatio >= 1 - epsilon;

  const report: VisibilityReport = {
    visible,
    visibleRatio,
    offscreen,
    occludedBy: occluders,
    clippedByAncestor,
  };

  cacheStore(options?.cacheKey, target.id, report);
  return report;
}

/**
 * Convenience adapter: bind an `OverlayDetector` instance into the
 * `OverlayPredicate` shape expected by `computeVisibility.options.isKnownOverlay`.
 *
 * Intentionally a tiny helper — keeps the public predicate decoupled from
 * the detector class so consumers can substitute test stubs without
 * reaching into `OverlayDetector`'s API.
 */
export function overlayDetectorPredicate(
  detector: OverlayDetector,
): OverlayPredicate {
  return (el) => detector.isKnownOverlay(el);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function intersectionArea(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function byElementId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Z-order: does `a` paint above `b`?
// ---------------------------------------------------------------------------

/**
 * Approximate z-order: returns `true` when `a` paints above `b`.
 *
 * Uses computed z-index when both elements have a positioned parent and
 * the z-index values differ. Falls back to DOM order — later-in-document
 * elements paint on top of earlier ones (the spec default for
 * non-positioned content). This is the same heuristic used by browsers
 * when there is no explicit stacking context.
 *
 * Known limitation: ignores 3D transforms. Documented in ADR-008 as a v1
 * scope cut.
 */
function paintsAbove(a: HTMLElement, b: HTMLElement): boolean {
  const za = numericZIndex(a);
  const zb = numericZIndex(b);
  if (za !== zb) return za > zb;
  // Equal z-index → DOM order. `compareDocumentPosition` returns a bitmask;
  // `DOCUMENT_POSITION_FOLLOWING` is set when `a` follows `b`.
  return (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function numericZIndex(el: HTMLElement): number {
  const style = window.getComputedStyle(el);
  const z = parseInt(style.zIndex, 10);
  return Number.isNaN(z) ? 0 : z;
}

// ---------------------------------------------------------------------------
// Ancestor clipping
// ---------------------------------------------------------------------------

function isClippedByAncestor(el: HTMLElement): boolean {
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.overflow === "hidden" || style.overflow === "clip") {
      const targetRect = el.getBoundingClientRect();
      const ancestorRect = current.getBoundingClientRect();
      // Clip detected when any side of the target lies outside the ancestor
      // box. Use a tolerance to avoid false positives on sub-pixel rounding.
      const tol = 0.5;
      if (
        targetRect.left < ancestorRect.left - tol ||
        targetRect.top < ancestorRect.top - tol ||
        targetRect.right > ancestorRect.right + tol ||
        targetRect.bottom > ancestorRect.bottom + tol
      ) {
        return true;
      }
    }
    if (style.clipPath && style.clipPath !== "none") {
      // We don't try to evaluate the clip-path geometry; presence of a
      // non-trivial clip-path on an ancestor is treated as "potentially
      // clipped" — the cross-check classifier will refine this for text.
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cache plumbing helper
// ---------------------------------------------------------------------------

function cacheStore(
  cacheKey: string | undefined,
  elementId: string,
  report: VisibilityReport,
): void {
  if (cacheKey === undefined) return;
  setCached(cacheKeyFor(cacheKey, elementId), report);
}
