/**
 * Type definitions for the counterfactual / model-checking engine.
 *
 * Mirrors the divergence shape from `replay-engine.ts` without extending
 * it, so a single shared base (`DivergenceLike`) can describe both real
 * and synthetic divergences for downstream consumers.
 */

import type { RecordedEventId } from "../recording/session-recorder";
import type { ReplayDivergence } from "../recording/replay-engine";

// ---------------------------------------------------------------------------
// Perturbations
// ---------------------------------------------------------------------------

/** A counterfactual mutation applied to a recorded session. */
export type Perturbation =
  | { kind: "flip-predicate-eval"; targetEventId: RecordedEventId }
  | { kind: "fail-action"; targetEventId: RecordedEventId };

// ---------------------------------------------------------------------------
// Divergence shape
// ---------------------------------------------------------------------------

/** Categories of divergence. Reused from ReplayDivergence to keep consumers aligned. */
export type DivergenceKind = ReplayDivergence["kind"];

/**
 * Categories of regression-suite assertion failure (Section 10 self-diagnosis).
 *
 * These describe failures emitted by the regression harness, not the replay
 * engine. Kept as a separate union from `DivergenceKind` so `ReplayDivergence`
 * stays narrowly typed to replay-emitted concepts.
 */
export type RegressionFailureKind =
  | "assertion-failed:state-active"
  | "assertion-failed:action-target-resolves"
  | "assertion-failed:visual-gate"
  | `assertion-failed:overlay:${string}`;

/**
 * Structural base shared by `ReplayDivergence` and `CounterfactualDivergence`,
 * plus Section 10 regression-failure consumers.
 *
 * The `kind` field accepts either replay-engine `DivergenceKind` values or
 * Section 10 `RegressionFailureKind` values. This wider union lets
 * `buildDriftHypotheses` consume regression-suite assertion failures without
 * polluting `ReplayDivergence` (which stays narrowly scoped to replay-emitted
 * divergences). A `ReplayDivergence` is still assignable to `DivergenceLike`
 * because its `kind` is a subtype of the widened union.
 */
export interface DivergenceLike {
  eventIndex: number;
  kind: DivergenceKind | RegressionFailureKind;
  expected: unknown;
  actual: unknown;
  message: string;
  /**
   * Optional IR-resolved source file. When set, takes precedence over the
   * session-events lookup in `resolveDivergence` — useful for divergences
   * with no backing recording-session event (Section 10 regression failures
   * with `eventIndex < 0`). Absent when not resolvable; never the literal
   * string `undefined`.
   */
  sourceFile?: string;
  /**
   * Optional IR-resolved predicate id (an `IRState.id` or `IRTransition.id`).
   * When set, takes precedence over the session-events lookup in
   * `resolveDivergence`. Same use case as `sourceFile`.
   */
  predicateId?: string;
}

/**
 * A synthetic divergence projected from perturbing a recorded trace.
 * Sibling type to `ReplayDivergence`; the `synthetic: true` discriminant
 * distinguishes counterfactual output from real replay output.
 */
export interface CounterfactualDivergence {
  eventIndex: number;
  kind: DivergenceKind;
  expected: unknown;
  actual: unknown;
  message: string;
  synthetic: true;
}

// ---------------------------------------------------------------------------
// Fragility
// ---------------------------------------------------------------------------

/** Per-predicate fragility metric: ratio of forward closure to total trace size. */
export interface FragilityScore {
  eventId: RecordedEventId;
  predicateId: string;
  forwardClosureSize: number;
  traceSize: number;
  /** forwardClosureSize / traceSize. In [0, 1]. */
  score: number;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Summary of one counterfactual exploration. All array fields are sorted
 * deterministically to keep equality checks stable.
 */
export interface CounterfactualReport {
  perturbation: Perturbation;
  /** Sorted by (eventIndex, kind). */
  divergences: CounterfactualDivergence[];
  /** Sorted by eventId lex. */
  fragilityScores: FragilityScore[];
  /** Sorted by eventId lex. */
  unreachableEventIds: RecordedEventId[];
  /** Sorted lex, deduped. */
  deadTransitionStateIds: string[];
  /** Sorted by predicateId lex. */
  irrelevantPredicateIds: string[];
}
