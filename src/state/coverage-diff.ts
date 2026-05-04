/**
 * Coverage diff (Section 11, Phase C1).
 *
 * Pure deterministic function: given a `RegressionSuite` and an ordered log
 * of `AssertionExecution` entries, compute which assertions in the suite
 * have NOT executed and which transitions have ZERO covering assertions in
 * the log. The result is stable — same `(suite, log)` input → byte-identical
 * JSON output.
 *
 * Determinism rules:
 *   - No `Date.now()`, no `Math.random()`, no I/O.
 *   - Sort `unexercisedAssertions` by `(caseId, assertionId)` ascending.
 *   - Sort `uncoveredTransitions` by `(caseId, transitionId)` ascending.
 *   - `stats.uncoveredRatio` is `0` when `totalAssertions === 0` (avoid NaN);
 *     otherwise `unexercised / total` (NOT rounded — JSON serializes it
 *     exactly).
 *   - Never mutate caller-supplied arrays.
 *
 * "Covering assertion" semantics:
 *   - A transition `T` (referenced by a case `C` whose `transitionId === T`)
 *     is considered "covered" if at least one assertion belonging to that
 *     case has executed. We do not require ALL assertions to execute — a
 *     single executed assertion proves the transition was reached at runtime.
 *   - Assertion identity in the suite is `(caseId, assertionIdOf(assertion))`
 *     — see `assertionIdOf` for the derivation rule. The exercise log keys
 *     by the same pair.
 */

import type {
  RegressionAssertion,
  RegressionCase,
  RegressionSuite,
} from "./regression-generator";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One execution record. Produced by the runner adapter (or test integrator)
 * when an assertion fires — pass or fail. The `executedAt` ISO timestamp is
 * informational only; it is NOT consulted by `coverageDiff`. We keep the
 * field on the input contract so callers can persist the same shape they
 * pass to us, but the diff computation is order-/time-independent.
 */
export interface AssertionExecution {
  caseId: string;
  assertionId: string;
  /** ISO 8601 timestamp. Informational; not consulted by `coverageDiff`. */
  executedAt: string;
}

export interface AssertionRef {
  caseId: string;
  assertionId: string;
}

export interface TransitionRef {
  caseId: string;
  transitionId: string;
}

export interface CoverageDiffReport {
  /**
   * Assertions in the suite that have NOT executed in the supplied log.
   * Sorted by `(caseId, assertionId)` ascending.
   */
  unexercisedAssertions: AssertionRef[];
  /**
   * Cases in the suite where ZERO assertions have executed. Sorted by
   * `(caseId, transitionId)` ascending. `transitionId` always equals
   * `caseId` for current generator output (one case per transition); the
   * field is kept distinct so future generators that emit multiple cases
   * per transition still produce a meaningful diff.
   */
  uncoveredTransitions: TransitionRef[];
  /** Aggregate statistics — useful for dashboards / threshold gates. */
  stats: {
    totalAssertions: number;
    exercisedAssertions: number;
    totalTransitions: number;
    coveredTransitions: number;
    /**
     * `unexercisedAssertions.length / stats.totalAssertions`, in `[0, 1]`.
     * `0` when `totalAssertions === 0` (avoid NaN).
     */
    uncoveredRatio: number;
  };
}

// ---------------------------------------------------------------------------
// Sort comparators — single point of determinism truth
// ---------------------------------------------------------------------------

function byString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function byAssertionRef(a: AssertionRef, b: AssertionRef): number {
  const c = byString(a.caseId, b.caseId);
  if (c !== 0) return c;
  return byString(a.assertionId, b.assertionId);
}

function byTransitionRef(a: TransitionRef, b: TransitionRef): number {
  const c = byString(a.caseId, b.caseId);
  if (c !== 0) return c;
  return byString(a.transitionId, b.transitionId);
}

// ---------------------------------------------------------------------------
// Assertion id derivation
// ---------------------------------------------------------------------------

/**
 * Derive a stable assertion id from a `RegressionAssertion`. Mirrors the
 * convention `self-diagnosis.ts` uses for matching against an exercise log:
 *
 *   - `state-active`            → `state-active:${phase}:${stateId}`
 *   - `action-target-resolves`  → `action-target-resolves:${transitionId}#${actionIndex}`
 *   - `visual-gate`             → `visual-gate:${stateId}`
 *   - `overlay`                 → the overlay-supplied `assertionId` verbatim.
 *
 * The function lives next to `coverageDiff` (rather than being shared from
 * `regression-generator.ts`) because the suite data structure does not
 * carry a per-assertion id field — assertion identity is derived from the
 * assertion's content. Callers that already have ids in hand (e.g. from
 * `RegressionFailure.assertionId`) can simply key the log directly.
 */
function assertionIdOf(a: RegressionAssertion): string {
  switch (a.kind) {
    case "state-active":
      return `state-active:${a.phase}:${a.stateId}`;
    case "action-target-resolves":
      return `action-target-resolves:${a.transitionId}#${a.actionIndex}`;
    case "visual-gate":
      return `visual-gate:${a.stateId}`;
    case "overlay":
      return a.assertionId;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Diff a `RegressionSuite` against an `AssertionExecution[]` log and emit a
 * deterministic coverage report.
 *
 * Cost is `O(|cases| × max(|case.assertions|, 1) + |log|)` — one walk over
 * suite assertions to build an executed/unexecuted ledger keyed by
 * `(caseId, assertionId)`, plus one walk over the log to populate that
 * ledger. The output is sorted at the end so the per-case grouping does
 * not leak into consumer-visible order.
 */
export function coverageDiff(
  suite: RegressionSuite,
  exerciseLog: AssertionExecution[],
): CoverageDiffReport {
  // Build a `caseId -> Set<assertionId>` index of the log so per-assertion
  // membership checks are O(1). Keying nestedly (rather than by a single
  // string like `${caseId}|${assertionId}`) lets us answer the per-case
  // "was anything in this case exercised?" question without re-scanning.
  const exercisedByCase = new Map<string, Set<string>>();
  for (const entry of exerciseLog) {
    let bucket = exercisedByCase.get(entry.caseId);
    if (!bucket) {
      bucket = new Set<string>();
      exercisedByCase.set(entry.caseId, bucket);
    }
    bucket.add(entry.assertionId);
  }

  let totalAssertions = 0;
  let exercisedAssertions = 0;
  const unexercised: AssertionRef[] = [];
  const uncoveredTransitions: TransitionRef[] = [];

  // Iterate cases in suite order. The suite generator already emits cases
  // sorted by id, so we don't re-sort here — but we DO sort the output
  // arrays at the end as a defensive contract guarantee.
  for (const c of suite.cases) {
    const caseExecuted = exercisedByCase.get(c.id);
    let caseHasAnyExecution = false;

    for (const a of c.assertions) {
      totalAssertions++;
      const id = assertionIdOf(a);
      if (caseExecuted !== undefined && caseExecuted.has(id)) {
        exercisedAssertions++;
        caseHasAnyExecution = true;
      } else {
        unexercised.push({ caseId: c.id, assertionId: id });
      }
    }

    if (!caseHasAnyExecution) {
      uncoveredTransitions.push({
        caseId: c.id,
        transitionId: c.transitionId,
      });
    }
  }

  // Final sort — guarantees stable output regardless of input order.
  unexercised.sort(byAssertionRef);
  uncoveredTransitions.sort(byTransitionRef);

  const totalTransitions = suite.cases.length;
  const coveredTransitions = totalTransitions - uncoveredTransitions.length;
  const uncoveredRatio =
    totalAssertions === 0 ? 0 : unexercised.length / totalAssertions;

  return {
    unexercisedAssertions: unexercised,
    uncoveredTransitions,
    stats: {
      totalAssertions,
      exercisedAssertions,
      totalTransitions,
      coveredTransitions,
      uncoveredRatio,
    },
  };
}

/**
 * Re-export for tests that want to verify the assertion-id derivation
 * convention without reaching into a private helper. Kept on the file so
 * the convention has one home.
 */
export { assertionIdOf as _assertionIdOfForTesting };

// `RegressionCase` is referenced in JSDoc above; importing it as a type
// keeps the link checker happy without leaking a runtime dep.
export type { RegressionCase };
