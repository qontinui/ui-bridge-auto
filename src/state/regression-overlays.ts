/**
 * Auto-regression assertion overlays (Section 9, Phase 2).
 *
 * Three built-in `AssertionOverlay` implementations that plug into
 * `generateRegressionSuite` via `GeneratorOptions.overlays`:
 *
 *   - `visibilityOverlay()`        — emits one assertion per (post-state ×
 *     required element) telling the executor to call `computeVisibility`
 *     and assert `visibleRatio >= minRatio` (defaults to fully visible).
 *   - `tokenOverlay(registry)`     — emits one assertion per (post-state ×
 *     required element) telling the executor to run `checkDesignTokens`
 *     against the supplied registry. The registry is captured by closure,
 *     NOT serialized; the assertion payload carries the sorted property
 *     names the registry governs so the suite stays self-describing.
 *   - `crossCheckOverlay()`        — emits one assertion per text-bearing
 *     transition action (clicks, types, or any action whose target carries
 *     a text-like criterion) telling the executor to run `crossCheckText`.
 *     The OCR provider is supplied at execute time, not by the overlay.
 *
 * All three are pure functions of their inputs — overlays emit *spec*,
 * not results. The downstream executor (out of scope for this module)
 * dereferences each assertion against live element state, an OCR provider,
 * and a design-token registry passed in alongside the suite.
 *
 * Determinism contract (matches Phase 1):
 *   - No `Date.now()`, no `Math.random()`, no Map iteration without sort.
 *   - Every collection sorted via a copy + comparator before iteration.
 *   - Output assertions sorted by `assertionId` ascending within each
 *     overlay's emit so re-running on the same context is byte-identical.
 *   - No mutation of `ctx` (no writes to `ctx.case`, `ctx.ir`, or
 *     `ctx.transition`).
 */

import type {
  IRElementCriteria,
  IRTransitionAction,
} from "@qontinui/shared-types/ui-bridge-ir";
import type {
  AssertionOverlay,
  AssertionOverlayContext,
  OverlayAssertion,
  RegressionAssertion,
} from "./regression-generator";
import type { DesignTokenRegistry } from "../visual/token-check";

// ---------------------------------------------------------------------------
// Sort helpers — single point of determinism truth for this module
// ---------------------------------------------------------------------------

/** Lexicographic string comparator. */
function byString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Sort a list of `OverlayAssertion`s by `assertionId` ascending (defensive copy). */
function sortByAssertionId(
  assertions: readonly OverlayAssertion[],
): OverlayAssertion[] {
  return [...assertions].sort((a, b) => byString(a.assertionId, b.assertionId));
}

/**
 * True when an `IRElementCriteria` carries a text-like field (text, textContains,
 * ariaLabel, or accessibleName). Used by `crossCheckOverlay` to decide whether
 * an action's target is worth OCR-cross-checking even when the action itself
 * is not a click/type. The check is structural (presence + non-empty) rather
 * than semantic — we don't try to interpret what the criterion *means*; we
 * just gate on "the criterion identifies the element by visible text".
 */
function isTextBearing(target: IRElementCriteria): boolean {
  return (
    (target.text !== undefined && target.text !== "") ||
    (target.textContains !== undefined && target.textContains !== "") ||
    (target.ariaLabel !== undefined && target.ariaLabel !== "") ||
    (target.accessibleName !== undefined && target.accessibleName !== "")
  );
}

// ---------------------------------------------------------------------------
// visibilityOverlay
// ---------------------------------------------------------------------------

/** Options for `visibilityOverlay`. */
export interface VisibilityOverlayOptions {
  /**
   * Minimum visible ratio (0..1) the executor should accept. Defaults to
   * `1` — i.e., the element must be fully visible. The executor evaluates
   * this against the result of `computeVisibility`.
   */
  minRatio?: number;
}

/**
 * Build a `visibility` overlay.
 *
 * For each post-state in `ctx.case.activateStates`, emits one
 * `OverlayAssertion` per assertion index in that state's `assertions`
 * array. The executor (out of scope here) dereferences each assertion
 * against the live IR, calls `computeVisibility(target)` on the resolved
 * element, and asserts `visibleRatio >= minRatio`.
 *
 * The overlay does NOT call `computeVisibility` at generation time —
 * suites are pure spec; execution is downstream.
 *
 * @example
 *   const overlay = visibilityOverlay({ minRatio: 0.5 });
 *   generateRegressionSuite(ir, { overlays: [overlay] });
 */
export function visibilityOverlay(
  opts?: VisibilityOverlayOptions,
): AssertionOverlay {
  const minRatio = opts?.minRatio ?? 1;
  return {
    id: "visibility",
    apply(ctx: AssertionOverlayContext): RegressionAssertion[] {
      const stateById = ctx.stateById;
      const out: OverlayAssertion[] = [];
      // ctx.case.activateStates is already sorted ascending by Phase 1; we
      // copy + sort defensively so this overlay doesn't depend on the
      // generator's pre-sort to remain deterministic on its own.
      const stateIds = [...ctx.case.activateStates].sort(byString);
      for (const stateId of stateIds) {
        const state = stateById.get(stateId);
        const len = state?.assertions.length ?? 0;
        for (let i = 0; i < len; i++) {
          out.push({
            kind: "overlay",
            overlayId: "visibility",
            assertionId: `${stateId}#${i}`,
            payload: {
              stateId,
              requiredElementIndex: i,
              minRatio,
            },
          });
        }
      }
      return sortByAssertionId(out);
    },
  };
}

// ---------------------------------------------------------------------------
// tokenOverlay
// ---------------------------------------------------------------------------

/**
 * Build a `token` overlay.
 *
 * For each post-state in `ctx.case.activateStates`, emits one
 * `OverlayAssertion` per assertion index in that state's `assertions`
 * array. The executor (out of scope here) dereferences each assertion
 * against the live IR, calls `checkDesignTokens(target, registry)` on the
 * resolved element, and fails on any non-empty violation list.
 *
 * The `registry` is captured by closure, NOT serialized into the suite —
 * registries can carry private logic that doesn't survive JSON. Instead,
 * each emitted assertion's payload carries the sorted list of property
 * names the registry currently governs (via `[...registry.properties()].sort()`).
 * Two consequences:
 *   1. The suite is deterministic and self-describing without re-running
 *      the closure — callers can read the JSON and see exactly which CSS
 *      properties are gated.
 *   2. The executor receives the registry separately (passed alongside the
 *      suite at execute time); the assertion's role is to *name what to
 *      check*, not to encode the catalog.
 *
 * @example
 *   const registry = buildDesignTokenRegistry({ color: ["rgb(0, 0, 0)"] });
 *   const overlay = tokenOverlay(registry);
 *   generateRegressionSuite(ir, { overlays: [overlay] });
 */
export function tokenOverlay(
  registry: DesignTokenRegistry,
): AssertionOverlay {
  // Snapshot the registry's property list at construction time. Sorting
  // here (vs. in apply) means the same overlay instance produces identical
  // payloads across cases; if the underlying registry mutates after
  // construction, the overlay still emits the snapshot (intentional —
  // registries are conceptually immutable per suite).
  const properties = [...registry.properties()].sort(byString);
  return {
    id: "token",
    apply(ctx: AssertionOverlayContext): RegressionAssertion[] {
      const stateById = ctx.stateById;
      const out: OverlayAssertion[] = [];
      const stateIds = [...ctx.case.activateStates].sort(byString);
      for (const stateId of stateIds) {
        const state = stateById.get(stateId);
        const len = state?.assertions.length ?? 0;
        for (let i = 0; i < len; i++) {
          out.push({
            kind: "overlay",
            overlayId: "token",
            assertionId: `${stateId}#${i}`,
            payload: {
              stateId,
              requiredElementIndex: i,
              // Defensive copy so a downstream consumer mutating the array
              // can't poison subsequent assertions sharing the closure.
              properties: [...properties],
            },
          });
        }
      }
      return sortByAssertionId(out);
    },
  };
}

// ---------------------------------------------------------------------------
// crossCheckOverlay
// ---------------------------------------------------------------------------

/** Options for `crossCheckOverlay`. */
export interface CrossCheckOverlayOptions {
  /**
   * Mismatch tolerance forwarded to `crossCheckText`. Defaults to `0.2`
   * (matches `text-cross-check.ts:127`'s default). Lower values are stricter
   * — OCR confusion (l vs. 1) becomes a mismatch faster.
   */
  tolerance?: number;
}

/**
 * Build a `cross-check` overlay.
 *
 * For each `IRTransitionAction` in `ctx.transition.actions`, emits one
 * `OverlayAssertion` IF the action is text-bearing — defined as either:
 *   - `action.type === "click"`, OR
 *   - `action.type === "type"`, OR
 *   - the action's target carries a non-empty `text`, `textContains`,
 *     `ariaLabel`, or `accessibleName` field.
 *
 * The executor (out of scope here) dereferences each assertion, runs
 * `crossCheckText(target, { ocr, tolerance })` against the resolved element
 * after action execution, and fails on `pass: false`. The OCR provider is
 * NOT captured by this overlay — the executor supplies it at execute time
 * (different runs may use different OCR backends, e.g. tesseract.js in CI
 * vs. a cloud OCR in production).
 *
 * @example
 *   const overlay = crossCheckOverlay({ tolerance: 0.1 });
 *   generateRegressionSuite(ir, { overlays: [overlay] });
 */
export function crossCheckOverlay(
  opts?: CrossCheckOverlayOptions,
): AssertionOverlay {
  const tolerance = opts?.tolerance ?? 0.2;
  return {
    id: "cross-check",
    apply(ctx: AssertionOverlayContext): RegressionAssertion[] {
      const out: OverlayAssertion[] = [];
      // Iterate actions in declared order — actions are an ordered sequence
      // per the IR contract, so `actionIndex` is meaningful and stable.
      // We don't sort actions before iteration; the index is what carries
      // determinism. Output is sorted by assertionId at the end.
      for (let i = 0; i < ctx.transition.actions.length; i++) {
        const action: IRTransitionAction = ctx.transition.actions[i]!;
        const isClickOrType = action.type === "click" || action.type === "type";
        if (!isClickOrType && !isTextBearing(action.target)) continue;
        out.push({
          kind: "overlay",
          overlayId: "cross-check",
          assertionId: `${ctx.transition.id}#${i}`,
          payload: {
            transitionId: ctx.transition.id,
            actionIndex: i,
            tolerance,
          },
        });
      }
      return sortByAssertionId(out);
    },
  };
}
