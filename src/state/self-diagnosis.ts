/**
 * Self-diagnosis composer (Section 10).
 *
 * Pure function over typed inputs: given a `RegressionRunResult` describing
 * the pass/fail outcome of executing a `RegressionSuite`, plus a
 * `DriftContext` carrying recent git history + optional IR + optional
 * fragility priors + optional spec/visual drift, produce a deterministic,
 * JSON-serializable `SelfDiagnosis` memo that ranks candidate root causes
 * for the failures.
 *
 * Section 10 does NOT execute suites — that's the runner adapter's job.
 * It also does NOT introduce a new correlation engine — `buildDriftHypotheses`
 * (Section 7) is reused verbatim. Each `RegressionFailure` is adapted into a
 * `DivergenceLike` (the structural shape `buildDriftHypotheses` already
 * consumes for replay/counterfactual divergences) and fed through the engine.
 *
 * Determinism contract (matches Sections 5–9):
 *   - No `Date.now()`, no `Math.random()`, no I/O.
 *   - Every `Map`/`Set` is converted to a sorted array before iteration.
 *   - Output collections (arrays, object keys) are emitted in stable order.
 *   - Same inputs → byte-identical output across runs (10× gate honored by
 *     Phase-4 tests).
 *
 * Memory layer (`MemorySink`, `surfaceDiagnosis`) is intentionally minimal:
 * a single `record` method the consumer implements however it likes
 * (file-based, SQLite, in-process buffer). The library does not own
 * persistence.
 */

import {
  canonicalJSON,
  stableStringifyValue,
} from "./canonical-json";
import type {
  ActionTargetResolvesAssertion,
  OverlayAssertion,
  RegressionAssertion,
  StateActiveAssertion,
  VisualGateAssertion,
} from "./regression-generator";

import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import type { DivergenceLike } from "../counterfactual/types";
import type { DriftContext, DriftHypothesis } from "../drift/types";
import { buildDriftHypotheses } from "../drift/hypothesis";

// ---------------------------------------------------------------------------
// Public types — run result
// ---------------------------------------------------------------------------

/**
 * One assertion failure produced by executing a regression suite. The
 * `assertionId` is the stable identifier the diagnose function keys
 * `evidenceMap` by — see `assertionIdOf` for the derivation rule.
 *
 * `observed` is opaque to the diagnose function — it's threaded into the
 * adapted `DivergenceLike.actual` slot so consumers can inspect what was
 * actually seen at runtime (e.g. the criteria that failed to resolve, the
 * pixel-diff result, the overlay's payload).
 */
export interface RegressionFailure {
  caseId: string;
  /**
   * Stable assertion identifier. For overlay assertions this matches
   * `OverlayAssertion.assertionId`; for the others it is derived from
   * `(caseId, kind, secondary-key)` — see `assertionIdOf` for the rule.
   */
  assertionId: string;
  assertion: RegressionAssertion;
  message: string;
  observed?: unknown;
}

/**
 * Run-result shape consumed by `diagnose`. Section 10 only describes the
 * shape; producing it is the runner adapter's responsibility (Section 11)
 * or the app-side test integrator's.
 */
export interface RegressionRunResult {
  suiteId: string;
  /** Opaque caller-supplied identifier for this run (e.g. a UUID, a build id). */
  runId: string;
  passed: number;
  failed: number;
  failures: RegressionFailure[];
}

// ---------------------------------------------------------------------------
// Public types — diagnosis
// ---------------------------------------------------------------------------

/**
 * Output of `diagnose`. JSON-serializable, byte-identical for byte-identical
 * inputs.
 */
export interface SelfDiagnosis {
  suiteId: string;
  runId: string;
  failureCount: number;
  /** Top-N ranked candidate root causes from `buildDriftHypotheses`. */
  candidateCauses: DriftHypothesis[];
  /**
   * Short free-text summary of the strongest hypothesis, ≤280 chars.
   * Truncated with `…` when needed. `"No correlated cause found."` when
   * `candidateCauses` is empty.
   */
  correlationSummary: string;
  /**
   * `assertionId → indices into candidateCauses[]`. Each index points to a
   * hypothesis whose `evidence[]` includes the failure adapted from that
   * assertion.
   */
  evidenceMap: Record<string, number[]>;
  coverage: {
    totalAssertions: number;
    failed: number;
    drift: { specEntries: number; visualEntries: number };
  };
}

/** Tunable knobs for `diagnose`. */
export interface DiagnoseOptions {
  /** Cap on `candidateCauses` length. Default 5. */
  topN?: number;
}

// ---------------------------------------------------------------------------
// Public types — memory layer (minimal)
// ---------------------------------------------------------------------------

/**
 * Consumer-supplied memory persistence. The library does not dictate where
 * memory lives (Claude Code's MEMORY.md, runner SQLite, an in-process
 * buffer) — the consumer implements `record` however suits.
 */
export interface MemorySink {
  record(diagnosis: SelfDiagnosis): void;
}

/** Default no-op sink for callers who don't want persistence. */
export const noopMemorySink: MemorySink = {
  record() {
    /* intentional no-op */
  },
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TOP_N = 5;
const SUMMARY_MAX_CHARS = 280;
const ELLIPSIS = "…"; // single-codepoint ellipsis to keep length deterministic

// ---------------------------------------------------------------------------
// Failure → DivergenceLike adapter
// ---------------------------------------------------------------------------

/**
 * Resolve IR provenance for a regression failure, returning the predicate id
 * (an `IRState.id` or `IRTransition.id`) and the source file the IR node was
 * declared in, when both can be determined from the failure's assertion +
 * the supplied IR document. Either or both fields may be absent in the
 * returned object (the caller must treat absence as "no provenance");
 * absent keys are NOT emitted as `undefined` so the canonical-JSON
 * serialization stays stable.
 *
 * Per assertion kind:
 *   - `state-active`           → predicateId = stateId, sourceFile = state's IR file
 *   - `action-target-resolves` → predicateId = transitionId, sourceFile = transition's IR file
 *   - `visual-gate`            → predicateId = stateId, sourceFile = state's IR file
 *   - `overlay`                → no IR provenance (overlay assertions are loosely
 *                                coupled to IR nodes; the overlay payload could
 *                                carry provenance but that's per-overlay convention)
 */
function resolveFailureProvenance(
  failure: RegressionFailure,
  ir: IRDocument | undefined,
): { predicateId?: string; sourceFile?: string } {
  // Without an IR document we can't validate that the assertion's id
  // refers to a real IR node, so we omit both fields and let the engine
  // fall back to the prior graceful-degradation path. Returning a
  // predicateId without IR would cross-contaminate evidence weighting:
  // the priors map could match (boosting the hypothesis) without our
  // having any IR-level confirmation that the predicate exists.
  if (!ir) return {};
  const a = failure.assertion;
  switch (a.kind) {
    case "state-active":
    case "visual-gate": {
      const stateId = a.stateId;
      const state = ir.states.find((s) => s.id === stateId);
      if (!state) return {};
      const out: { predicateId?: string; sourceFile?: string } = {
        predicateId: stateId,
      };
      const file = state.provenance?.file;
      if (typeof file === "string") {
        out.sourceFile = file;
      }
      return out;
    }
    case "action-target-resolves": {
      const transitionId = a.transitionId;
      const transition = ir.transitions.find((t) => t.id === transitionId);
      if (!transition) return {};
      const out: { predicateId?: string; sourceFile?: string } = {
        predicateId: transitionId,
      };
      const file = transition.provenance?.file;
      if (typeof file === "string") {
        out.sourceFile = file;
      }
      return out;
    }
    case "overlay":
      return {};
  }
}

/**
 * Adapt one `RegressionFailure` into a `DivergenceLike` so it flows through
 * the existing `buildDriftHypotheses` engine without an engine fork.
 *
 * `eventIndex` is set to `-1` as the convention for failures with no backing
 * recording-session event. When `ir` is supplied, this adapter resolves the
 * failure's IR provenance (state file or transition file) and populates the
 * divergence's optional `predicateId` and `sourceFile` fields. Those fields
 * take precedence over the session-events lookup in
 * `drift/hypothesis.ts:resolveDivergence`, so the failure participates in
 * commit/cluster hypotheses' evidence weighting (file-overlap + fragility).
 * When `ir` is undefined, the adapter omits both fields and the engine falls
 * back to the prior graceful-degradation path (no fragility/source-file
 * signal for the divergence).
 *
 * Mapping per assertion kind:
 *   - `state-active`               → `expected = { stateId, requiredElementIds }`
 *   - `action-target-resolves`     → `expected = { transitionId, actionIndex, targetCriteria }`
 *   - `visual-gate`                → `expected = { stateId, baselineKey }`
 *   - `overlay`                    → `expected = { overlayId, assertionId, payload }`
 *
 * `actual = failure.observed ?? null` in every case.
 *
 * Exported for direct unit testing (Phase 4); the diagnose function still
 * owns invocation order. Callers outside the test boundary should prefer
 * `diagnose`.
 */
export function failureToDivergence(
  failure: RegressionFailure,
  ir?: IRDocument,
): DivergenceLike {
  const a = failure.assertion;
  const actual = failure.observed === undefined ? null : failure.observed;
  const provenance = resolveFailureProvenance(failure, ir);
  switch (a.kind) {
    case "state-active": {
      const sa: StateActiveAssertion = a;
      return {
        eventIndex: -1,
        kind: "assertion-failed:state-active",
        expected: {
          stateId: sa.stateId,
          requiredElementIds: [...sa.requiredElementIds],
        },
        actual,
        message: failure.message,
        ...provenance,
      };
    }
    case "action-target-resolves": {
      const at: ActionTargetResolvesAssertion = a;
      return {
        eventIndex: -1,
        kind: "assertion-failed:action-target-resolves",
        expected: {
          transitionId: at.transitionId,
          actionIndex: at.actionIndex,
          targetCriteria: at.targetCriteria,
        },
        actual,
        message: failure.message,
        ...provenance,
      };
    }
    case "visual-gate": {
      const vg: VisualGateAssertion = a;
      return {
        eventIndex: -1,
        kind: "assertion-failed:visual-gate",
        expected: { stateId: vg.stateId, baselineKey: vg.baselineKey },
        actual,
        message: failure.message,
        ...provenance,
      };
    }
    case "overlay": {
      const ov: OverlayAssertion = a;
      return {
        eventIndex: -1,
        kind: `assertion-failed:overlay:${ov.overlayId}`,
        expected: {
          overlayId: ov.overlayId,
          assertionId: ov.assertionId,
          payload: ov.payload,
        },
        actual,
        message: failure.message,
        ...provenance,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

/**
 * Compose a deterministic self-diagnosis memo for a failed run.
 *
 * Steps:
 *   1. Adapt each failure → `DivergenceLike` (sorted by `(assertionId, caseId)`
 *      first so the adapted divergences land in stable order).
 *   2. Call `buildDriftHypotheses(divergences, context)` — engine returns
 *      hypotheses already sorted by `(confidence desc, recency desc, …)`.
 *   3. Slice top-N (default 5).
 *   4. Build `evidenceMap` by structural match of each failure's adapted
 *      divergence against each hypothesis's `evidence[]` (key:
 *      `(eventIndex, kind, message)` — `DivergenceLike` is structural).
 *   5. Format `correlationSummary` from the top hypothesis.
 *   6. Compute `coverage.drift.{specEntries,visualEntries}` from the context.
 *
 * Pure: no `Date.now()`, no `Math.random()`, no I/O. Same inputs →
 * byte-identical output.
 */
export function diagnose(
  failedRun: RegressionRunResult,
  context: DriftContext,
  options?: DiagnoseOptions,
): SelfDiagnosis {
  const topN = Math.max(0, options?.topN ?? DEFAULT_TOP_N);

  // Sort failures defensively so the adapted-divergence order is stable
  // independently of the caller's array order. `assertionId` is the primary
  // key (already designed to be stable + unique within a case); `caseId`
  // breaks ties for the (rare) cross-case shared-id scenario.
  const sortedFailures = sortFailures(failedRun.failures);

  // Adapt each failure into a structurally-equivalent DivergenceLike.
  // Keep the adapter's output in lockstep with the sorted-failure order so
  // the (failure -> divergence) correspondence is index-by-index. Threading
  // `context.ir` through lets the adapter resolve each failure's source
  // file / predicate id from IR provenance, so divergences participate in
  // file-overlap + fragility weighting in `buildDriftHypotheses`.
  const adapted: DivergenceLike[] = sortedFailures.map((f) =>
    failureToDivergence(f, context.ir),
  );

  const allHypotheses = buildDriftHypotheses(adapted, context);
  const candidateCauses = allHypotheses.slice(0, topN);

  const evidenceMap = buildEvidenceMap(
    sortedFailures,
    adapted,
    candidateCauses,
  );

  const correlationSummary = formatCorrelationSummary(candidateCauses);

  const coverage = {
    totalAssertions: failedRun.passed + failedRun.failed,
    failed: failedRun.failed,
    drift: {
      specEntries: countDriftEntries(context.specDrift),
      visualEntries: countDriftEntries(context.visualDrift),
    },
  };

  return {
    suiteId: failedRun.suiteId,
    runId: failedRun.runId,
    failureCount: failedRun.failures.length,
    candidateCauses,
    correlationSummary,
    evidenceMap,
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Helpers — internal
// ---------------------------------------------------------------------------

/** Sort failures by (assertionId asc, caseId asc) — stable, total. */
function sortFailures(failures: RegressionFailure[]): RegressionFailure[] {
  return [...failures].sort((a, b) => {
    if (a.assertionId < b.assertionId) return -1;
    if (a.assertionId > b.assertionId) return 1;
    if (a.caseId < b.caseId) return -1;
    if (a.caseId > b.caseId) return 1;
    return 0;
  });
}

/**
 * Build the `assertionId -> hypothesisIndex[]` map. Output object's keys are
 * emitted in sorted order (alphabetical) so JSON serialization is stable;
 * the index arrays are themselves sorted ascending.
 *
 * Match key for "is this failure's divergence in this hypothesis's evidence?"
 * is the structural triple `(eventIndex, kind, message)` — `DivergenceLike`
 * is structurally equal across `expected/actual` shape changes (which are
 * not reliable identity keys; e.g. two failures of the same kind on the same
 * assertion may carry different `observed` shapes). The triple is the
 * minimal unique key the adapter produces.
 */
function buildEvidenceMap(
  failures: RegressionFailure[],
  adapted: DivergenceLike[],
  hypotheses: DriftHypothesis[],
): Record<string, number[]> {
  // Key each adapted divergence by (eventIndex|kind|message).
  const key = (d: DivergenceLike): string =>
    `${d.eventIndex} ${d.kind} ${d.message}`;

  // Pre-index: for each hypothesis index, the set of evidence keys it carries.
  const hypothesisKeys: Set<string>[] = hypotheses.map((h) => {
    const set = new Set<string>();
    for (const e of h.evidence) set.add(key(e));
    return set;
  });

  // Build the map keyed by assertionId (multiple failures may share an id
  // across cases — collect all matching hypothesis indices).
  const intermediate = new Map<string, Set<number>>();
  for (let i = 0; i < failures.length; i++) {
    const f = failures[i]!;
    const k = key(adapted[i]!);
    let bucket = intermediate.get(f.assertionId);
    if (!bucket) {
      bucket = new Set<number>();
      intermediate.set(f.assertionId, bucket);
    }
    for (let h = 0; h < hypotheses.length; h++) {
      if (hypothesisKeys[h]!.has(k)) bucket.add(h);
    }
  }

  // Materialize with sorted keys + sorted index arrays.
  const out: Record<string, number[]> = {};
  const sortedAssertionIds = Array.from(intermediate.keys()).sort();
  for (const id of sortedAssertionIds) {
    const indices = Array.from(intermediate.get(id) ?? []).sort((a, b) => a - b);
    out[id] = indices;
  }
  return out;
}

/**
 * Format the human-readable correlation summary from the top hypothesis.
 * Format: `Top suspect: <hypothesis> (confidence 0.NN) — <N> failures correlate`
 * — chosen because:
 *   - "Top suspect" is the load-bearing phrase; consumers can grep for it.
 *   - Including the hypothesis text + confidence + correlated-failure count
 *     gives the reader (or an AI consumer) the three numbers that matter
 *     without needing to inspect `candidateCauses`.
 *   - Confidence is fixed at 2 decimal places for stable string length.
 *   - Ellipsis truncation guarantees `length <= SUMMARY_MAX_CHARS`.
 *
 * The "<N> failures correlate" count is the size of the top hypothesis's
 * `evidence[]` — i.e., how many of our adapted failures fed this hypothesis.
 */
function formatCorrelationSummary(causes: DriftHypothesis[]): string {
  if (causes.length === 0) return "No correlated cause found.";
  const top = causes[0]!;
  const confidence = top.confidence.toFixed(2);
  const correlated = top.evidence.length;
  const failuresWord = correlated === 1 ? "failure" : "failures";
  const raw = `Top suspect: ${top.hypothesis} (confidence ${confidence}) — ${correlated} ${failuresWord} correlate`;
  if (raw.length <= SUMMARY_MAX_CHARS) return raw;
  // Truncate to SUMMARY_MAX_CHARS - 1, then append the single-codepoint ellipsis.
  return raw.slice(0, SUMMARY_MAX_CHARS - 1) + ELLIPSIS;
}

/** Count entries in a `DriftReport`-shaped value, defending against undefined. */
function countDriftEntries(
  report: { states: unknown[]; transitions: unknown[] } | undefined,
): number {
  if (!report) return 0;
  return report.states.length + report.transitions.length;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a diagnosis to canonical JSON (sorted keys at every level).
 * Byte-identical output for byte-identical inputs; round-trips through
 * `deserializeDiagnosis` losslessly.
 */
export function serializeDiagnosis(d: SelfDiagnosis): string {
  return canonicalJSON(d);
}

/**
 * Parse and shape-validate a serialized diagnosis. Validation matches the
 * style of `deserializeSuite` (regression-generator.ts:580): top-level
 * fields only; the structural cast is safe because byte-identical
 * round-trips are covered by Phase-4 tests.
 *
 * @throws Error with a clear message when the parsed value isn't
 * diagnosis-shaped.
 */
export function deserializeDiagnosis(json: string): SelfDiagnosis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `deserializeDiagnosis: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("deserializeDiagnosis: expected a JSON object at top level");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.suiteId !== "string") {
    throw new Error("deserializeDiagnosis: missing or non-string `suiteId`");
  }
  if (typeof obj.runId !== "string") {
    throw new Error("deserializeDiagnosis: missing or non-string `runId`");
  }
  if (typeof obj.failureCount !== "number") {
    throw new Error("deserializeDiagnosis: missing or non-number `failureCount`");
  }
  if (!Array.isArray(obj.candidateCauses)) {
    throw new Error(
      "deserializeDiagnosis: missing or non-array `candidateCauses`",
    );
  }
  if (typeof obj.correlationSummary !== "string") {
    throw new Error(
      "deserializeDiagnosis: missing or non-string `correlationSummary`",
    );
  }
  if (
    obj.evidenceMap === null ||
    typeof obj.evidenceMap !== "object" ||
    Array.isArray(obj.evidenceMap)
  ) {
    throw new Error("deserializeDiagnosis: missing or non-object `evidenceMap`");
  }
  if (
    obj.coverage === null ||
    typeof obj.coverage !== "object" ||
    Array.isArray(obj.coverage)
  ) {
    throw new Error("deserializeDiagnosis: missing or non-object `coverage`");
  }

  return parsed as SelfDiagnosis;
}

// ---------------------------------------------------------------------------
// Memory surface (intentionally minimal)
// ---------------------------------------------------------------------------

/**
 * Surface a diagnosis to a consumer-supplied memory sink. The library does
 * not own persistence — this is a single delegation call so callers can
 * compose richer memory backends without us defining a retrieval contract.
 */
export function surfaceDiagnosis(d: SelfDiagnosis, sink: MemorySink): void {
  sink.record(d);
}

// Re-export helpers that the diagnosis module depends on, so importers don't
// need a second import path. `stableStringifyValue` is exposed in case a
// consumer wants to canonicalize a related artifact (e.g. a memo wrapper)
// using the same encoder.
export { canonicalJSON, stableStringifyValue };
