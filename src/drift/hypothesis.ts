/**
 * Drift-hypothesis engine — Section 7 v1.
 *
 * Takes a set of observed/predicted divergences and a `DriftContext`
 * (recording session, recent git history, optional fragility priors,
 * optional IR document, optional spec-drift report) and produces a
 * deterministically ranked list of `DriftHypothesis`.
 *
 * Algorithm: weighted-evidence v1 (Open decision #4 in the section
 * plan). Confidence = sum(evidence_weight) / max_possible_weight, where
 * each unit of evidence contributes up to three weight components:
 *
 *   1. Fragility prior — if the divergence points to a `predicateEval`
 *      event whose `predicateId` is in `context.priors`, contribute
 *      that score (in [0, 1]) to the divergence's weight.
 *   2. Commit recency — newer commits get a higher recency weight,
 *      relative to the newest commit in the window. Recency is in
 *      [0, 1] with the newest commit at 1.0.
 *   3. File-overlap — if the commit's `files[]` intersects the source
 *      file(s) of the divergent IR node (resolved via
 *      `IRState.provenance.file` / `IRTransition.provenance.file`),
 *      contribute 1.0 to the weight; else 0.
 *
 * Per-divergence cap is 3 (one for each component). Hypothesis
 * confidence = sum_over_evidence(weight) / (3 × |evidence|), bounded
 * to [0, 1]. Empty evidence → confidence 0.
 *
 * Determinism: every internal collection is sorted before iteration.
 * No `Date.now()`. No `Math.random()`. No reliance on Map/Set iteration
 * order escaping into output. Same inputs → byte-identical output.
 *
 * Pure function — no I/O, no `child_process` import, no globals.
 */

import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import type { DivergenceLike, FragilityScore } from "../counterfactual/types";
import type { DriftEntry, DriftReport } from "../ir-builder/drift";
import type {
  RecordedEvent,
  RecordedPredicateEval,
  RecordingSession,
} from "../recording/session-recorder";

import type { DriftContext, DriftHypothesis, GitCommitRef } from "./types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a ranked list of drift hypotheses. Sorted descending by confidence;
 * ties broken by `suspectedCommits[0].timestamp` desc then `sha` asc, then
 * by `hypothesis` lex as a final stable tiebreaker.
 *
 * Empty divergences AND empty commits AND empty spec-drift → returns `[]`.
 */
export function buildDriftHypotheses(
  divergences: DivergenceLike[],
  context: DriftContext,
): DriftHypothesis[] {
  const sortedDivergences = sortDivergences(divergences);

  // Resolve every divergence to its (predicateId | null, sourceFile | null)
  // tuple ONCE up front. This is the only place we touch the recording
  // session / IR — everything downstream operates on the resolved shape.
  const resolved = sortedDivergences.map((d) =>
    resolveDivergence(d, context.session, context.ir),
  );

  // Pre-compute fragility lookup (predicateId -> score). Use plain Object
  // with sorted keys later; do NOT iterate Map directly into output.
  const priorById = buildPriorIndex(context.priors ?? []);

  // Pre-compute recency normalization. Newest commit -> 1.0, oldest -> 0.0
  // (or 1.0 if there's only one).
  const recencyOf = buildRecencyIndex(context.commits);

  const hypotheses: DriftHypothesis[] = [];

  // (1) One hypothesis per commit.
  for (const commit of sortedCommits(context.commits)) {
    hypotheses.push(
      buildCommitHypothesis(commit, resolved, priorById, recencyOf),
    );
  }

  // (2) One hypothesis per spec-drift cluster (drift entries grouped by file).
  if (context.specDrift) {
    for (const cluster of clusterSpecDrift(context.specDrift, context.ir)) {
      hypotheses.push(
        buildSpecDriftHypothesis(
          cluster,
          resolved,
          context.commits,
          priorById,
          recencyOf,
        ),
      );
    }
  }

  // (3) One hypothesis per visual-drift cluster. Section 8: visual drift
  // (pixel-level baseline divergence) is folded into the same hypothesis
  // surface as structural drift, but each cluster entry contributes a smaller
  // weight (0.5 per entry vs. 1.0 for structural drift). Pixel shifts are
  // weaker root-cause signals than missing/extra states, but still useful
  // tie-breakers when fragility + commit overlap don't decide things alone.
  if (context.visualDrift) {
    for (const cluster of clusterSpecDrift(context.visualDrift, context.ir)) {
      hypotheses.push(
        buildVisualDriftHypothesis(
          cluster,
          resolved,
          context.commits,
          priorById,
          recencyOf,
        ),
      );
    }
  }

  hypotheses.sort(byConfidenceThenStableTiebreaker);
  return hypotheses;
}

// ---------------------------------------------------------------------------
// Resolution: divergence -> (predicateId | null, sourceFile | null)
// ---------------------------------------------------------------------------

interface ResolvedDivergence {
  divergence: DivergenceLike;
  /** From the corresponding `predicateEval` event, if any. */
  predicateId: string | null;
  /** From IR state/transition `provenance.file`, if resolvable. */
  sourceFile: string | null;
}

function resolveDivergence(
  divergence: DivergenceLike,
  session: RecordingSession,
  ir: IRDocument | undefined,
): ResolvedDivergence {
  const event = session.events[divergence.eventIndex];
  const predicateId = extractPredicateId(event);
  const sourceFile = predicateId !== null
    ? resolveSourceFile(predicateId, ir)
    : null;
  return { divergence, predicateId, sourceFile };
}

function extractPredicateId(event: RecordedEvent | undefined): string | null {
  if (!event) return null;
  if (event.type !== "predicateEval") return null;
  const data = event.data as RecordedPredicateEval;
  return data.predicateId ?? null;
}

/**
 * Resolve a predicate id (which is, by convention, an IR state id or
 * transition id — see `RecordedPredicateEval.predicateId` in the recorder)
 * back to its source file via the IR's `provenance.file`. Falls back
 * gracefully to `null` if the IR is missing or doesn't carry provenance.
 */
function resolveSourceFile(
  predicateId: string,
  ir: IRDocument | undefined,
): string | null {
  if (!ir) return null;
  for (const s of ir.states) {
    if (s.id === predicateId) {
      return s.provenance?.file ?? null;
    }
  }
  for (const t of ir.transitions) {
    if (t.id === predicateId) {
      return t.provenance?.file ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

function buildPriorIndex(priors: FragilityScore[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of priors) {
    // If multiple entries share a predicateId (shouldn't happen with the
    // explorer, but be defensive), keep the maximum — that's the strongest
    // prior available.
    const existing = out.get(p.predicateId);
    if (existing === undefined || p.score > existing) {
      out.set(p.predicateId, p.score);
    }
  }
  return out;
}

function buildRecencyIndex(commits: GitCommitRef[]): (sha: string) => number {
  if (commits.length === 0) return () => 0;
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const c of commits) {
    if (c.timestamp < minTs) minTs = c.timestamp;
    if (c.timestamp > maxTs) maxTs = c.timestamp;
  }
  const bySha = new Map<string, number>();
  // Single-commit window: recency is fully 1.0 (no relative ordering to
  // discount against). Multi-commit: linear interpolation between min and
  // max so newest = 1.0, oldest = 0.0.
  if (minTs === maxTs) {
    for (const c of commits) bySha.set(c.sha, 1);
  } else {
    const span = maxTs - minTs;
    for (const c of commits) {
      bySha.set(c.sha, (c.timestamp - minTs) / span);
    }
  }
  return (sha) => bySha.get(sha) ?? 0;
}

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------

function sortDivergences(divergences: DivergenceLike[]): DivergenceLike[] {
  return [...divergences].sort((a, b) => {
    if (a.eventIndex !== b.eventIndex) return a.eventIndex - b.eventIndex;
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    if (a.message < b.message) return -1;
    if (a.message > b.message) return 1;
    return 0;
  });
}

function sortCommits(commits: GitCommitRef[]): GitCommitRef[] {
  return [...commits].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    if (a.sha < b.sha) return -1;
    if (a.sha > b.sha) return 1;
    return 0;
  });
}

function sortedCommits(commits: GitCommitRef[]): GitCommitRef[] {
  return sortCommits(commits);
}

// ---------------------------------------------------------------------------
// Commit hypothesis
// ---------------------------------------------------------------------------

const PER_DIVERGENCE_MAX_WEIGHT = 3;

function buildCommitHypothesis(
  commit: GitCommitRef,
  resolved: ResolvedDivergence[],
  priorById: Map<string, number>,
  recencyOf: (sha: string) => number,
): DriftHypothesis {
  const evidence: DivergenceLike[] = [];
  const filesTouched = new Set<string>(commit.files);
  let weightSum = 0;

  const recency = recencyOf(commit.sha);

  for (const r of resolved) {
    const fileOverlap = r.sourceFile !== null && filesTouched.has(r.sourceFile)
      ? 1
      : 0;
    const fragility = r.predicateId !== null
      ? priorById.get(r.predicateId) ?? 0
      : 0;
    // Recency only counts toward a divergence's weight if there's at least
    // some other reason to think this commit is implicated — otherwise
    // every commit gets equal recency credit for every divergence and the
    // ranking collapses. Require fileOverlap > 0 OR fragility > 0.
    const hasSignal = fileOverlap > 0 || fragility > 0;
    const recencyContribution = hasSignal ? recency : 0;

    const w = fileOverlap + fragility + recencyContribution;
    if (w > 0) {
      evidence.push(r.divergence);
      weightSum += w;
    }
  }

  const denom = Math.max(1, evidence.length) * PER_DIVERGENCE_MAX_WEIGHT;
  const confidence = evidence.length === 0 ? 0 : clamp01(weightSum / denom);

  // suspectedFiles for a commit hypothesis = the intersection of the commit's
  // files and the divergent source files (the files we actually have evidence
  // about). If no IR-resolved source files matched, fall back to the commit's
  // entire file list — better than empty.
  const overlapFiles = new Set<string>();
  for (const r of resolved) {
    if (r.sourceFile && filesTouched.has(r.sourceFile)) {
      overlapFiles.add(r.sourceFile);
    }
  }
  const suspectedFiles =
    overlapFiles.size > 0
      ? sortStrings([...overlapFiles])
      : sortStrings([...commit.files]);

  return {
    hypothesis: `commit ${shortSha(commit.sha)} (${commit.author}) — ${commit.message}`,
    evidence,
    suspectedCommits: [commit],
    suspectedFiles,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Spec-drift cluster hypothesis
// ---------------------------------------------------------------------------

interface SpecDriftCluster {
  /** File the cluster is anchored to, or "<unknown>" when ids didn't resolve. */
  file: string;
  entries: DriftEntry[];
}

function clusterSpecDrift(
  report: DriftReport,
  ir: IRDocument | undefined,
): SpecDriftCluster[] {
  const byFile = new Map<string, DriftEntry[]>();

  const allEntries = [...report.states, ...report.transitions];
  for (const entry of allEntries) {
    const file = resolveSourceFile(entry.id, ir) ?? "<unknown>";
    const bucket = byFile.get(file);
    if (bucket) {
      bucket.push(entry);
    } else {
      byFile.set(file, [entry]);
    }
  }

  // Materialize clusters in deterministic order: file path lex ascending.
  const files = sortStrings([...byFile.keys()]);
  const clusters: SpecDriftCluster[] = [];
  for (const file of files) {
    const entries = byFile.get(file) ?? [];
    entries.sort(byEntryIdThenKind);
    clusters.push({ file, entries });
  }
  return clusters;
}

function buildSpecDriftHypothesis(
  cluster: SpecDriftCluster,
  resolved: ResolvedDivergence[],
  commits: GitCommitRef[],
  priorById: Map<string, number>,
  recencyOf: (sha: string) => number,
): DriftHypothesis {
  // Evidence for this cluster: divergences whose resolved source file or
  // predicate id matches one of the entries in the cluster.
  const clusterIds = new Set(cluster.entries.map((e) => e.id));
  const evidence: DivergenceLike[] = [];
  let weightSum = 0;

  // Commits that touched this cluster's file are implicated.
  const implicatedCommits = sortCommits(
    cluster.file === "<unknown>"
      ? []
      : commits.filter((c) => c.files.includes(cluster.file)),
  );

  // For each implicated divergence, the weight model mirrors the commit
  // hypothesis — file-overlap and fragility per divergence, with recency
  // averaged across implicated commits (so a cluster supported by recent
  // activity ranks above one with only stale commits).
  const avgRecency = avg(
    implicatedCommits.map((c) => recencyOf(c.sha)),
  );

  for (const r of resolved) {
    const matchesCluster =
      (r.sourceFile !== null && r.sourceFile === cluster.file) ||
      (r.predicateId !== null && clusterIds.has(r.predicateId));
    if (!matchesCluster) continue;

    const fileOverlap = r.sourceFile === cluster.file ? 1 : 0;
    const fragility = r.predicateId !== null
      ? priorById.get(r.predicateId) ?? 0
      : 0;
    const hasSignal = fileOverlap > 0 || fragility > 0;
    const recencyContribution = hasSignal ? avgRecency : 0;

    const w = fileOverlap + fragility + recencyContribution;
    if (w > 0) {
      evidence.push(r.divergence);
      weightSum += w;
    }
  }

  // Each cluster entry itself is a unit of evidence — spec drift is direct
  // proof that the static description has drifted from runtime, with a
  // weight of 1.0 per entry, capped at the per-divergence cap so the
  // confidence stays bounded.
  const entryWeight = Math.min(
    cluster.entries.length,
    PER_DIVERGENCE_MAX_WEIGHT,
  );
  weightSum += entryWeight;

  const totalEvidenceCount = evidence.length + (cluster.entries.length > 0 ? 1 : 0);
  const denom = Math.max(1, totalEvidenceCount) * PER_DIVERGENCE_MAX_WEIGHT;
  const confidence = totalEvidenceCount === 0
    ? 0
    : clamp01(weightSum / denom);

  const suspectedFiles =
    cluster.file === "<unknown>"
      ? []
      : [cluster.file];

  return {
    hypothesis: `spec drift cluster — ${cluster.entries.length} ${pluralize("entry", cluster.entries.length)} on ${cluster.file}`,
    evidence,
    suspectedCommits: implicatedCommits,
    suspectedFiles,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Visual-drift cluster hypothesis
// ---------------------------------------------------------------------------

const VISUAL_DRIFT_ENTRY_WEIGHT = 0.5;

/**
 * Build a hypothesis for a cluster of visual-drift entries (Section 8).
 *
 * Mirrors `buildSpecDriftHypothesis` but with two intentional differences:
 *
 * 1. **Per-entry weight is 0.5**, not 1.0. Pixel-level drift is a weaker
 *    root-cause signal than structural drift — a 5px shift is rarely a real
 *    cause; a missing/extra state usually is.
 * 2. **Hypothesis label is prefixed `visual drift cluster`**, not
 *    `spec drift cluster`, so consumers can distinguish the two on the
 *    rendered list.
 *
 * Everything else — file clustering, recency averaging, fragility lookup,
 * sort order — matches the spec-drift path.
 */
function buildVisualDriftHypothesis(
  cluster: SpecDriftCluster,
  resolved: ResolvedDivergence[],
  commits: GitCommitRef[],
  priorById: Map<string, number>,
  recencyOf: (sha: string) => number,
): DriftHypothesis {
  const clusterIds = new Set(cluster.entries.map((e) => e.id));
  const evidence: DivergenceLike[] = [];
  let weightSum = 0;

  const implicatedCommits = sortCommits(
    cluster.file === "<unknown>"
      ? []
      : commits.filter((c) => c.files.includes(cluster.file)),
  );

  const avgRecency = avg(implicatedCommits.map((c) => recencyOf(c.sha)));

  for (const r of resolved) {
    const matchesCluster =
      (r.sourceFile !== null && r.sourceFile === cluster.file) ||
      (r.predicateId !== null && clusterIds.has(r.predicateId));
    if (!matchesCluster) continue;

    const fileOverlap = r.sourceFile === cluster.file ? 1 : 0;
    const fragility = r.predicateId !== null
      ? priorById.get(r.predicateId) ?? 0
      : 0;
    const hasSignal = fileOverlap > 0 || fragility > 0;
    const recencyContribution = hasSignal ? avgRecency : 0;

    const w = fileOverlap + fragility + recencyContribution;
    if (w > 0) {
      evidence.push(r.divergence);
      weightSum += w;
    }
  }

  // Visual-drift entries are direct evidence too, but at half the weight
  // of structural drift (see VISUAL_DRIFT_ENTRY_WEIGHT). Cap at the
  // per-divergence cap so confidence stays bounded.
  const entryWeight = Math.min(
    cluster.entries.length * VISUAL_DRIFT_ENTRY_WEIGHT,
    PER_DIVERGENCE_MAX_WEIGHT,
  );
  weightSum += entryWeight;

  const totalEvidenceCount =
    evidence.length + (cluster.entries.length > 0 ? 1 : 0);
  const denom = Math.max(1, totalEvidenceCount) * PER_DIVERGENCE_MAX_WEIGHT;
  const confidence = totalEvidenceCount === 0
    ? 0
    : clamp01(weightSum / denom);

  const suspectedFiles = cluster.file === "<unknown>" ? [] : [cluster.file];

  return {
    hypothesis: `visual drift cluster — ${cluster.entries.length} ${pluralize("entry", cluster.entries.length)} on ${cluster.file}`,
    evidence,
    suspectedCommits: implicatedCommits,
    suspectedFiles,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Final ranking
// ---------------------------------------------------------------------------

function byConfidenceThenStableTiebreaker(
  a: DriftHypothesis,
  b: DriftHypothesis,
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;
  // Tie-break: newest implicated commit wins.
  const at = a.suspectedCommits[0]?.timestamp ?? -Infinity;
  const bt = b.suspectedCommits[0]?.timestamp ?? -Infinity;
  if (at !== bt) return bt - at;
  const ash = a.suspectedCommits[0]?.sha ?? "";
  const bsh = b.suspectedCommits[0]?.sha ?? "";
  if (ash < bsh) return -1;
  if (ash > bsh) return 1;
  // Final stable tiebreaker so JSON serialization is byte-identical.
  if (a.hypothesis < b.hypothesis) return -1;
  if (a.hypothesis > b.hypothesis) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

function sortStrings(values: string[]): string[] {
  const copy = [...values];
  copy.sort();
  return copy;
}

function byEntryIdThenKind(a: DriftEntry, b: DriftEntry): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}

function shortSha(sha: string): string {
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}

function pluralize(noun: string, n: number): string {
  if (n === 1) return noun;
  // "entry" -> "entries"; otherwise simple "+s".
  if (noun.endsWith("y")) return noun.slice(0, -1) + "ies";
  return noun + "s";
}
