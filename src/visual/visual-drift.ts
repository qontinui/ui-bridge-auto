/**
 * Visual drift adapter (Section 8 — visual + semantic fusion).
 *
 * Adapts the existing `ScreenshotAssertionManager` (visual/screenshot-
 * assertion.ts) into the same `DriftEntry` / `DriftReport` plumbing used
 * by structural drift (`ir-builder/drift.ts`). Each off-baseline element
 * becomes a `DriftEntry` with `kind: "visual-drift"`.
 *
 * Decision (Open #3 in Section 8 plan): **extend `DriftEntry.kind`** with
 * `"visual-drift"` rather than introducing a sibling type. Keeps the
 * consumer surface (one entry type, one rendering path) simple. Diff
 * stats are encoded in `detail`; structured numerics live on the parallel
 * `VisualDriftDetail[]` array returned alongside.
 *
 * Determinism: entries are sorted by `id` ascending, then by `kind` lex —
 * matching the comparator's sort order so a `DriftReport.transitions`
 * array containing visual-drift entries stays byte-deterministic when
 * the input set is held constant.
 */

import type { DriftEntry, DriftReport } from "../ir-builder/drift";
import type { QueryableElement } from "../core/element-query";
import type { ScreenshotAssertionManager } from "./screenshot-assertion";
import type { ScreenshotAssertionOptions } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Numeric detail for a single visual-drift entry. Kept in a parallel
 * structure rather than packed into `DriftEntry.detail` (which is a
 * human-readable string) so consumers can sort, filter, and threshold
 * on the structured fields.
 */
export interface VisualDriftDetail {
  /** Element id this detail is about. */
  id: string;
  /** Percentage of pixels that differed (0..100). */
  diffPercentage: number;
  /** Absolute count of differing pixels. */
  diffPixelCount: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Bounding rect of the diff region, when available. */
  diffRegion?: { x: number; y: number; width: number; height: number };
  /** Baseline storage key used. */
  baselineKey?: string;
  /** Capture/load error if present (entry is omitted from `entries` when set). */
  error?: string;
}

/** Output of `runVisualDrift`. */
export interface VisualDriftReport {
  /** Drift entries, one per off-baseline element. Conforms to `DriftEntry`. */
  entries: DriftEntry[];
  /** Per-entry numeric detail, in the same order as `entries`. */
  details: VisualDriftDetail[];
}

/** Options for `runVisualDrift`. */
export interface RunVisualDriftOptions {
  /** Forwarded to `assertMatchesBaseline`. Defaults are fine for most paths. */
  assertion?: ScreenshotAssertionOptions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run visual drift for a list of registered elements against the
 * provided baseline store. Each off-baseline element becomes one
 * `DriftEntry` with `kind: "visual-drift"`.
 *
 * @param elements - Elements to compare. Each must have `element` (the raw
 *   HTMLElement) so the screenshot manager can capture it.
 * @param manager - Pre-configured `ScreenshotAssertionManager` (the caller
 *   builds this with their preferred `BaselineStore`). Sharing one
 *   instance across all elements amortises the store's open cost.
 * @param options - Forwarded assertion options.
 */
export async function runVisualDrift(
  elements: readonly QueryableElement[],
  manager: ScreenshotAssertionManager,
  options?: RunVisualDriftOptions,
): Promise<VisualDriftReport> {
  const entries: DriftEntry[] = [];
  const details: VisualDriftDetail[] = [];

  // Sort elements by id for deterministic output. Assertion calls run
  // sequentially so the caller doesn't have to worry about overlapping
  // captures touching the same DOM nodes.
  const sorted = [...elements].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  for (const el of sorted) {
    const result = await manager.assertMatchesBaseline(
      el.id,
      el.element,
      options?.assertion,
    );

    // Drop entries that errored on capture/load — surface them in details
    // for visibility but don't pollute the DriftEntry list (a missing
    // baseline isn't drift; it's a fresh element). The hypothesis engine
    // will skip details that don't have a corresponding entry.
    if (result.error) {
      details.push({
        id: el.id,
        diffPercentage: result.diffPercentage,
        diffPixelCount: result.diffPixelCount,
        totalPixels: result.totalPixels,
        diffRegion: result.diffRegion,
        baselineKey: result.baselineKey,
        error: result.error,
      });
      continue;
    }

    if (result.pass) continue;

    const entry: DriftEntry = {
      id: el.id,
      kind: "visual-drift",
      detail: formatDetail(el.id, result.diffPercentage, result.diffPixelCount),
    };
    entries.push(entry);
    details.push({
      id: el.id,
      diffPercentage: result.diffPercentage,
      diffPixelCount: result.diffPixelCount,
      totalPixels: result.totalPixels,
      diffRegion: result.diffRegion,
      baselineKey: result.baselineKey,
    });
  }

  // Sort entries deterministically (matches the structural comparator's
  // byIdThenKind comparator at ir-builder/drift.ts:257). Details follow
  // entry order — re-sort details to match.
  entries.sort(byIdThenKind);
  details.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { entries, details };
}

/**
 * Wrap a `VisualDriftReport.entries` array in a `DriftReport` shape so it
 * can be passed to `buildDriftHypotheses` via `DriftContext.visualDrift`.
 * Visual drift is reported on the `transitions` slot rather than `states`
 * — pixel-level drift is closer to "this transition's visual outcome
 * changed" than "this state has structural drift", and it keeps clusters
 * from accidentally merging with structural state-clusters in the
 * hypothesis engine.
 */
export function asDriftReport(report: VisualDriftReport): DriftReport {
  return {
    states: [],
    transitions: report.entries,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDetail(
  id: string,
  diffPercentage: number,
  diffPixelCount: number,
): string {
  // Round to one decimal for stable output across runs (the screenshot
  // diff is in floats — a stable rendering keeps determinism gates green).
  const pct = Math.round(diffPercentage * 10) / 10;
  return `visual drift on ${id}: ${pct}% pixels (${diffPixelCount}px) differ from baseline`;
}

function byIdThenKind(a: DriftEntry, b: DriftEntry): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}
