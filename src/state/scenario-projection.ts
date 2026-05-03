/**
 * Scenario projection (Section 11, Phase B1).
 *
 * Two pure-ish functions over an `IRDocument`:
 *
 *   - `projectScenarios(ir)` — DETERMINISTIC. Walks the IR's state graph and
 *     emits a `ScenarioProjection` describing every state and its outbound
 *     transitions, with stable sort order at every level. Same `IRDocument`
 *     input → byte-identical JSON output. Gated by the 10× determinism test.
 *
 *   - `projectCurrentScenario(ir, registry, opts?)` — RUNTIME-AWARE.
 *     Combines the static projection with live registry data: tags states as
 *     "currently active" by running each state's required-element queries
 *     through `findFirst` (via `StateDetector`-equivalent logic), and
 *     classifies each transition as available / blocked based on whether its
 *     action targets resolve in the live registry. Non-deterministic by
 *     design: the result depends on transient DOM state. The output schema
 *     carries `deterministic: false` as a load-bearing marker so consumers
 *     don't accidentally treat a runtime projection as a stable artifact.
 *
 * Determinism rules for `projectScenarios` (non-negotiable):
 *   - No `Date.now()`, no `Math.random()`, no I/O.
 *   - Sort states by `stateId` ascending.
 *   - Sort each state's `outboundTransitions` by `transitionId` ascending.
 *   - Sort each transition's `targetStateIds` ascending.
 *   - Never mutate caller-supplied arrays — always sort a fresh copy.
 *
 * `projectCurrentScenario` reuses the same sorting discipline for the static
 * `states` field and for `availableTransitions` / `blockedTransitions`. The
 * registry queries themselves are non-deterministic (different DOM state →
 * different output), but the assembly + ordering is.
 */

import type {
  IRDocument,
  IRElementCriteria,
  IRTransition,
} from "@qontinui/shared-types/ui-bridge-ir";

import type { ElementQuery, QueryableElement } from "../core/element-query";
import { findFirst, matchesQuery } from "../core/element-query";
import type { RegistryLike } from "./state-detector";

// ---------------------------------------------------------------------------
// Public types — static projection
// ---------------------------------------------------------------------------

/**
 * One projected transition emanating from a state. Carries the IR transition
 * id, the human-readable label (when present), the set of states the
 * transition activates, and a count of how many actions the transition fires.
 *
 * Action *content* is deliberately omitted — clients that need it should
 * resolve it against the IR; including it here would duplicate IR data and
 * make the projection larger than necessary.
 */
export interface ProjectedTransition {
  transitionId: string;
  label?: string;
  /** `IRTransition.activateStates`, sorted ascending. */
  targetStateIds: string[];
  /** `IRTransition.actions.length`. */
  actionCount: number;
}

/**
 * One projected state. `requiredElementCount` is `IRState.requiredElements.length`
 * — useful for clients that want to surface "this state has N required
 * elements" without touching the IR.
 */
export interface ProjectedState {
  stateId: string;
  label?: string;
  requiredElementCount: number;
  /** Outbound transitions, sorted by `transitionId` ascending. */
  outboundTransitions: ProjectedTransition[];
}

/**
 * Static, deterministic projection. Same `IRDocument` input → byte-identical
 * JSON output via canonical-json serialization.
 */
export interface ScenarioProjection {
  /** All states, sorted by `stateId` ascending. */
  states: ProjectedState[];
  /** Always `true`. Marker so a `Projection` discriminated union is possible. */
  deterministic: true;
}

// ---------------------------------------------------------------------------
// Public types — runtime-aware projection
// ---------------------------------------------------------------------------

export interface AvailableTransition {
  transitionId: string;
  fromStateId: string;
  /** `IRTransition.activateStates`, sorted ascending. */
  targetStateIds: string[];
}

/**
 * Reason a transition can't fire right now:
 *   - `no-match`        — `findFirst` returned no chosen match.
 *   - `ambiguous`       — `findFirst` returned a match, but at least one
 *                         near-miss ambiguity above threshold also resolved
 *                         (the live DOM has multiple candidates).
 *   - `predicate-failed`— transition has no actions (degenerate transition);
 *                         the cause is reserved for future predicate-style
 *                         transition guards. We surface it instead of
 *                         silently treating no-action transitions as
 *                         available, because consumers should know.
 */
export interface BlockedTransition {
  transitionId: string;
  fromStateId: string;
  cause: "no-match" | "ambiguous" | "predicate-failed";
  detail?: string;
}

export interface ProjectCurrentScenarioOptions {
  /**
   * Maximum number of blocked-transition entries returned per state.
   * Default: 50. Not a hard cap on assembly cost — just on output size.
   */
  maxBlockedPerState?: number;
}

/**
 * Runtime-aware projection. Carries the same `states` shape as
 * `ScenarioProjection` (so clients that want both can read both off one
 * call), plus three runtime fields keyed against the live registry.
 *
 * `deterministic: false` is the marker that distinguishes this from
 * `ScenarioProjection`. Consumers that cache scenarios should refuse to
 * persist a `CurrentScenarioProjection` (or only persist its `states` field).
 */
export interface CurrentScenarioProjection {
  /** Same shape as `ScenarioProjection.states` — deterministic, sorted. */
  states: ProjectedState[];
  /**
   * State ids whose required elements resolve in the live registry right now.
   * Sorted ascending.
   *
   * Activation rule mirrors `StateDetector.isStateActive`: a state is
   * "active" if ANY of its `requiredElements` matches at least one element
   * in the registry. We do not consult `excludedElements` or `conditions`
   * here — those live on `IRStateCondition` which is not part of the
   * projection's surface; a richer activeness check is the runtime engine's
   * job, not the projection's.
   */
  currentStateIds: string[];
  /**
   * Transitions whose action targets all resolve in the live registry.
   * Sorted by `(fromStateId, transitionId)` ascending.
   *
   * "Available" requires every action target to find a chosen match — partial
   * resolution is treated as blocked because firing the transition would
   * fail at the unresolved action.
   */
  availableTransitions: AvailableTransition[];
  /**
   * Transitions where at least one action target failed to resolve.
   * Sorted by `(fromStateId, transitionId)` ascending; capped per-state at
   * `options.maxBlockedPerState`.
   */
  blockedTransitions: BlockedTransition[];
  /** Always `false` — see field-level docs above. */
  deterministic: false;
}

/**
 * Discriminated union for clients that accept either projection shape. The
 * `deterministic` field is the discriminator — `true` for static, `false`
 * for runtime.
 */
export type Projection = ScenarioProjection | CurrentScenarioProjection;

// ---------------------------------------------------------------------------
// Sort comparators — single point of determinism truth (mirrors regression-generator)
// ---------------------------------------------------------------------------

function byString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Defensive sorted copy — never mutate caller-owned arrays. */
function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort(byString);
}

// ---------------------------------------------------------------------------
// IR helpers
// ---------------------------------------------------------------------------

/**
 * Index transitions by their first `fromStates` entry. We bucket each
 * transition under EVERY fromState so a transition with multiple
 * preconditions appears as outbound from each of them — which matches the
 * semantic intent of "what can I do from state X".
 */
function indexTransitionsByFromState(
  ir: IRDocument,
): Map<string, IRTransition[]> {
  const out = new Map<string, IRTransition[]>();
  // Iterate as supplied — we re-sort per-state buckets below, so insertion
  // order does not affect deterministic output.
  for (const t of ir.transitions) {
    for (const from of t.fromStates) {
      let bucket = out.get(from);
      if (!bucket) {
        bucket = [];
        out.set(from, bucket);
      }
      bucket.push(t);
    }
  }
  return out;
}

function projectTransition(t: IRTransition): ProjectedTransition {
  const out: ProjectedTransition = {
    transitionId: t.id,
    targetStateIds: sortedCopy(t.activateStates),
    actionCount: t.actions.length,
  };
  // `name` is the IR's human-readable label. Only emit when distinct from
  // the id so callers don't see redundant `label === transitionId` everywhere
  // (the IR convention is to default `name = id` when no label is supplied).
  if (typeof t.name === "string" && t.name !== "" && t.name !== t.id) {
    out.label = t.name;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API — static projection
// ---------------------------------------------------------------------------

/**
 * Walk the IR and emit a deterministic projection of every state with its
 * outbound transitions. Same `IRDocument` input → byte-identical output.
 *
 * Cost is `O(|states| log |states| + |transitions| log |transitions|)` for
 * the sorts plus `O(|transitions|)` for the from-state bucketing.
 */
export function projectScenarios(ir: IRDocument): ScenarioProjection {
  const byFromState = indexTransitionsByFromState(ir);

  // Sort states defensively — callers may build IRs in arbitrary order.
  const sortedStates = [...ir.states].sort((a, b) => byString(a.id, b.id));

  const states: ProjectedState[] = sortedStates.map((s) => {
    const transitions = byFromState.get(s.id) ?? [];
    const projected: ProjectedTransition[] = transitions
      // Sort the bucket by transition id ascending (deterministic).
      .slice()
      .sort((a, b) => byString(a.id, b.id))
      .map(projectTransition);

    const out: ProjectedState = {
      stateId: s.id,
      requiredElementCount: s.requiredElements.length,
      outboundTransitions: projected,
    };
    if (typeof s.name === "string" && s.name !== "" && s.name !== s.id) {
      out.label = s.name;
    }
    return out;
  });

  return {
    states,
    deterministic: true,
  };
}

// ---------------------------------------------------------------------------
// Runtime-aware helpers
// ---------------------------------------------------------------------------

/**
 * `IRElementCriteria` is structurally a subset of `ElementQuery` (every field
 * on the IR shape — `role`, `tagName`, `text`, `textContains`, `ariaLabel`,
 * `id`, `attributes` — exists on `ElementQuery` with a compatible value
 * shape). We expose a typed cast helper rather than a deep clone because the
 * query engine is read-only; aliasing through the interface boundary is
 * safe and avoids unnecessary allocation per transition.
 *
 * `accessibleName` is the one IR-only field the runtime engine doesn't
 * understand; we degrade it to `ariaLabel` (the runtime synonym per the
 * IR adapter convention).
 */
function criteriaToQuery(c: IRElementCriteria): ElementQuery {
  const q: ElementQuery = {};
  if (c.role !== undefined) q.role = c.role;
  if (c.tagName !== undefined) q.tagName = c.tagName;
  if (c.text !== undefined) q.text = c.text;
  if (c.textContains !== undefined) q.textContains = c.textContains;
  if (c.id !== undefined) q.id = c.id;
  // `accessibleName` and `ariaLabel` are synonyms per the adapter convention;
  // the runtime engine only understands `ariaLabel`. Prefer the explicit
  // `ariaLabel` field when both are present.
  if (c.ariaLabel !== undefined) q.ariaLabel = c.ariaLabel;
  else if (c.accessibleName !== undefined) q.ariaLabel = c.accessibleName;
  if (c.attributes !== undefined) q.attributes = { ...c.attributes };
  return q;
}

/**
 * Mirror of `StateDetector.isStateActive`'s required-element check: a state
 * is currently active if ANY of its `requiredElements` matches an element in
 * the registry. We deliberately re-implement the predicate (rather than
 * importing `StateDetector`) because:
 *   - StateDetector takes a `StateMachine` (runtime engine), which we don't
 *     have at projection time.
 *   - The projection's notion of "active" is intentionally narrower than
 *     the engine's — we don't consult `excludedElements`, `conditions`, or
 *     element computed-style deltas. Those are runtime concerns.
 */
function isStateCurrentlyActive(
  required: IRElementCriteria[],
  elements: QueryableElement[],
): boolean {
  if (required.length === 0) {
    // A state with no required elements is degenerate — neither true nor
    // false makes sense. We return `false` so the `currentStateIds` list
    // doesn't get filled with synthetic always-active states.
    return false;
  }
  for (const c of required) {
    const q = criteriaToQuery(c);
    for (const el of elements) {
      if (matchesQuery(el, q).matches) return true;
    }
  }
  return false;
}

/**
 * Resolve a single action target against the registry, returning a
 * three-way verdict:
 *   - `"matched"` — `findFirst` returned a chosen match with no above-threshold
 *     ambiguities.
 *   - `"ambiguous"` — `findFirst` returned a match AND at least one ambiguity.
 *   - `"no-match"` — `findFirst` returned no chosen match.
 *
 * The detail string carries the chosen match's id (when present) for
 * "matched"/"ambiguous" or stays undefined for "no-match" — we keep it
 * concise so blocked-transition output stays bounded.
 */
function resolveActionTarget(
  target: IRElementCriteria,
  elements: QueryableElement[],
): { verdict: "matched" | "ambiguous" | "no-match"; detail?: string } {
  const q = criteriaToQuery(target);
  // `findFirst` returns `{ match, score, ambiguities }`. We don't tune the
  // ambiguity threshold here — the caller's threshold tuning would muddy
  // the projection's contract. Defaults are fine for a status snapshot.
  const result = findFirst(elements, q);
  if (result.match === null) return { verdict: "no-match" };
  if (result.ambiguities.length > 0) {
    return { verdict: "ambiguous", detail: result.match.id };
  }
  return { verdict: "matched", detail: result.match.id };
}

// ---------------------------------------------------------------------------
// Public API — runtime-aware projection
// ---------------------------------------------------------------------------

/**
 * Combine the static projection with live registry signal. Walks the IR's
 * states + transitions; for each transition, runs `findFirst` against every
 * action target's resolved query and classifies the transition as available
 * (all targets matched) or blocked (at least one target missing or ambiguous).
 *
 * Non-deterministic by design — the output depends on `registry.getAllElements()`
 * at call time. The `deterministic: false` field on the result is the
 * load-bearing marker for consumers.
 *
 * Cost is `O(|transitions| × |actions| × |elements|)` in the worst case (the
 * inner `matchesQuery` walk is linear in the registry size). For realistic
 * IRs (~50 transitions × ~3 actions × ~hundreds of elements) this is
 * comfortably below a millisecond on modern hardware.
 */
export function projectCurrentScenario(
  ir: IRDocument,
  registry: RegistryLike,
  options?: ProjectCurrentScenarioOptions,
): CurrentScenarioProjection {
  const maxBlockedPerState = Math.max(0, options?.maxBlockedPerState ?? 50);
  const elements = registry.getAllElements();

  // Reuse the static projection so `states` is byte-identical to what
  // `projectScenarios(ir)` would produce — clients can compare or merge
  // without re-walking.
  const staticProjection = projectScenarios(ir);

  // Active-state classification: any required-element match flips the state
  // active. Sorted output for stability.
  const currentStateIds: string[] = [];
  for (const s of [...ir.states].sort((a, b) => byString(a.id, b.id))) {
    if (isStateCurrentlyActive(s.requiredElements, elements)) {
      currentStateIds.push(s.id);
    }
  }

  // Transition classification. We iterate by fromState bucket so the
  // per-state cap on blocked entries is enforced cleanly. The output arrays
  // are flat — sorted at the end so the per-state grouping is invisible to
  // consumers.
  const byFromState = indexTransitionsByFromState(ir);
  const available: AvailableTransition[] = [];
  const blocked: BlockedTransition[] = [];

  // Sort fromState ids so per-state cap eviction is deterministic.
  const sortedFromStateIds = [...byFromState.keys()].sort(byString);
  for (const fromStateId of sortedFromStateIds) {
    const transitions = byFromState.get(fromStateId)!;
    // Sort transitions by id within each from-state bucket.
    const sortedTransitions = [...transitions].sort((a, b) =>
      byString(a.id, b.id),
    );

    let blockedThisState = 0;
    for (const t of sortedTransitions) {
      if (t.actions.length === 0) {
        // Degenerate transition — see `BlockedTransition.cause` doc.
        if (blockedThisState < maxBlockedPerState) {
          blocked.push({
            transitionId: t.id,
            fromStateId,
            cause: "predicate-failed",
            detail: "transition has no actions",
          });
          blockedThisState++;
        }
        continue;
      }

      // Resolve every action target. Track the FIRST blocking verdict so
      // the cause + detail point to a single, stable action.
      let blockingCause: "no-match" | "ambiguous" | null = null;
      let blockingDetail: string | undefined;
      for (let i = 0; i < t.actions.length; i++) {
        const a = t.actions[i]!;
        const resolved = resolveActionTarget(a.target, elements);
        if (resolved.verdict !== "matched") {
          blockingCause = resolved.verdict;
          // Include action index in detail so consumers can pinpoint which
          // step of a multi-step transition is the problem.
          blockingDetail =
            resolved.detail !== undefined
              ? `action[${i}] ${resolved.verdict}: ${resolved.detail}`
              : `action[${i}] ${resolved.verdict}`;
          break;
        }
      }

      if (blockingCause === null) {
        available.push({
          transitionId: t.id,
          fromStateId,
          targetStateIds: sortedCopy(t.activateStates),
        });
      } else if (blockedThisState < maxBlockedPerState) {
        blocked.push({
          transitionId: t.id,
          fromStateId,
          cause: blockingCause,
          ...(blockingDetail !== undefined ? { detail: blockingDetail } : {}),
        });
        blockedThisState++;
      }
    }
  }

  // Final sort — flatten the per-state grouping so consumers see one
  // (fromStateId, transitionId)-sorted list each.
  available.sort((a, b) => {
    const fs = byString(a.fromStateId, b.fromStateId);
    if (fs !== 0) return fs;
    return byString(a.transitionId, b.transitionId);
  });
  blocked.sort((a, b) => {
    const fs = byString(a.fromStateId, b.fromStateId);
    if (fs !== 0) return fs;
    return byString(a.transitionId, b.transitionId);
  });

  return {
    states: staticProjection.states,
    currentStateIds,
    availableTransitions: available,
    blockedTransitions: blocked,
    deterministic: false,
  };
}
