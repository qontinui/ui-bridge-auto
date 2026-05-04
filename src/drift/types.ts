/**
 * Type definitions for the drift-hypothesis engine (Section 7).
 *
 * Surfaces likely root-cause commits + files when observed or predicted
 * divergences appear. Inputs combine: divergences (`DivergenceLike[]`),
 * counterfactual fragility priors, spec drift entries, and recent git
 * history. Output is a deterministic ranked list of `DriftHypothesis`.
 *
 * Strict determinism: all arrays MUST be sorted; no `Date.now()` calls;
 * no random ids. Same inputs → byte-identical output.
 */

import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import type { DivergenceLike, FragilityScore } from "../counterfactual/types";
import type { DriftReport } from "../ir-builder/drift";
import type { RecordingSession } from "../recording/session-recorder";

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

/**
 * Reference to a git commit. The shape is the structural intersection of
 * `git log --format='%H%x09%aI%x09%an%x09%s' --name-only` output: SHA,
 * timestamp (epoch ms — converted from ISO at parse time), author, message,
 * and the list of files the commit touched.
 *
 * `files` is sorted ascending by path so `JSON.stringify` of two equivalent
 * commits is byte-identical.
 */
export interface GitCommitRef {
  sha: string;
  message: string;
  author: string;
  /** Commit timestamp in epoch ms. */
  timestamp: number;
  /** Files touched by the commit. Sorted ascending. */
  files: string[];
}

// ---------------------------------------------------------------------------
// Drift hypothesis
// ---------------------------------------------------------------------------

/**
 * A single ranked drift hypothesis: a candidate root-cause explanation for
 * an observed/predicted divergence set.
 *
 * - `hypothesis` — short human-readable description (e.g. "commit a1b2c3d
 *   modified the file backing transition `submit-form`").
 * - `evidence` — supporting divergences (sorted by `eventIndex` ascending,
 *   then `kind` lex).
 * - `suspectedCommits` — git commits implicated by this hypothesis (sorted
 *   by `timestamp` desc, then `sha` asc tiebreaker).
 * - `suspectedFiles` — file paths implicated (sorted ascending, deduped).
 * - `confidence` — weighted-evidence v1 score in [0, 1]. See
 *   `hypothesis.ts` for the exact formula.
 */
export interface DriftHypothesis {
  hypothesis: string;
  evidence: DivergenceLike[];
  suspectedCommits: GitCommitRef[];
  suspectedFiles: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Drift context
// ---------------------------------------------------------------------------

/**
 * Inputs for `buildDriftHypotheses`. Everything except `session` and
 * `commits` is optional — the engine degrades gracefully when priors,
 * IR, or spec-drift data is unavailable.
 */
export interface DriftContext {
  session: RecordingSession;
  ir?: IRDocument;
  /** Recent git commits. The engine assumes these are already filtered to a
   * relevant time window; it does not re-filter. */
  commits: GitCommitRef[];
  /** Per-predicate fragility scores from `exploreCounterfactual`. */
  priors?: FragilityScore[];
  /** Output of `compareSpecToRuntime`. Becomes additional evidence for
   * hypotheses that name the same id/file. */
  specDrift?: DriftReport;
  /**
   * Visual drift report (Section 8). Same shape as `specDrift` —
   * `DriftReport` with entries of `kind: "visual-drift"`. Kept on a separate
   * field rather than folded into `specDrift` so the hypothesis engine can
   * weight pixel-level drift differently from structural drift (a 5px shift
   * is rarely a root cause; a missing element usually is).
   */
  visualDrift?: DriftReport;
}
