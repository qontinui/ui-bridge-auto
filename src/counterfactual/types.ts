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
 * Structural base shared by `ReplayDivergence` and `CounterfactualDivergence`.
 * Lets Section 7 write `function handle(d: DivergenceLike)` over either.
 */
export interface DivergenceLike {
  eventIndex: number;
  kind: DivergenceKind;
  expected: unknown;
  actual: unknown;
  message: string;
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
