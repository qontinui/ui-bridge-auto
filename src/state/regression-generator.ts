/**
 * Auto-regression generator (Section 9, Phase 1).
 *
 * Walks an `IRDocument`'s state graph + transitions and emits a deterministic
 * `RegressionSuite` — one `RegressionCase` per transition, each carrying a set
 * of typed `RegressionAssertion` specs. Suites are *spec artifacts*: cases
 * reference IR nodes by id (states by `state.id`, action targets by
 * `transition.id` + index) and never inline element selectors. The downstream
 * executor (out of scope here) looks up the live IR to dereference each
 * reference at run time.
 *
 * Determinism rules (non-negotiable):
 * - No `Date.now()`, no `Math.random()`, no implicit Map iteration.
 * - Every collection is sorted before iteration via a copy + comparator —
 *   never mutate the caller's input arrays.
 * - `serializeSuite` emits JSON with sorted object keys at every level so
 *   round-trips are byte-identical.
 *
 * Phase 2 (overlays) plugs into this module via `GeneratorOptions.overlays`.
 * The `AssertionOverlay` interface is exported here so Phase 2 can import it
 * without forcing a circular dep — the built-in overlay implementations live
 * in `regression-overlays.ts` (separate file, separate phase).
 */

import type {
  IRDocument,
  IRElementCriteria,
  IRTransition,
  IRVersion,
} from "@qontinui/shared-types/ui-bridge-ir";

// ---------------------------------------------------------------------------
// Public types — assertions
// ---------------------------------------------------------------------------

/**
 * Asserts that a given state is active. References the IR state by id and
 * carries the indices (into `state.requiredElements`) the executor must
 * resolve. Indices are emitted ascending; the executor dereferences each
 * index against the live IR to recover the actual `IRElementCriteria` —
 * keeping the suite in lock-step with the IR.
 */
export interface StateActiveAssertion {
  kind: "state-active";
  /** Phase of the case this assertion gates: pre-execution or post-execution. */
  phase: "pre" | "post";
  /** IR state id (matches `IRState.id`). */
  stateId: string;
  /** Indices into `IRState.requiredElements`, sorted ascending. */
  requiredElementIds: number[];
}

/**
 * Asserts that the action's target element resolves at execution time.
 * References the action by `(transitionId, actionIndex)` plus a copy of
 * the action's `IRElementCriteria` for executor convenience — the criteria
 * is identical to what's at `ir.transitions[t].actions[i].target`, included
 * inline so the executor doesn't need a second IR lookup per assertion.
 */
export interface ActionTargetResolvesAssertion {
  kind: "action-target-resolves";
  /** IR transition id (matches `IRTransition.id`). */
  transitionId: string;
  /** Index into `IRTransition.actions`. */
  actionIndex: number;
  /** Verbatim copy of `IRTransition.actions[actionIndex].target`. */
  targetCriteria: IRElementCriteria;
}

/**
 * Asserts that a stored visual baseline matches the post-state rendering.
 * Emitted only when `GeneratorOptions.baselineStore` is supplied. The
 * `baselineKey` is derived deterministically — see `deriveBaselineKey`.
 */
export interface VisualGateAssertion {
  kind: "visual-gate";
  /** IR state id whose post-execution rendering is being gated. */
  stateId: string;
  /** Stable baseline-store lookup key. */
  baselineKey: string;
}

/**
 * Asserts arbitrary, overlay-supplied conditions. Reserved for Phase 2's
 * pluggable overlays (visibility, design tokens, OCR cross-check). Phase 1
 * never emits this kind directly, but the union must include it so overlay
 * extensions in Phase 2 don't widen the public type.
 */
export interface OverlayAssertion {
  kind: "overlay";
  /** Stable id of the overlay that produced this assertion. */
  overlayId: string;
  /** Human-readable assertion id (overlay-defined; expected to be stable). */
  assertionId: string;
  /** Overlay-specific payload. Opaque to the generator. */
  payload: Record<string, unknown>;
}

/**
 * Discriminated union of every assertion shape a regression case can carry.
 * Add new kinds via this union; the generator's sort order will treat any
 * new `kind` lexicographically against the existing kinds.
 */
export type RegressionAssertion =
  | StateActiveAssertion
  | ActionTargetResolvesAssertion
  | VisualGateAssertion
  | OverlayAssertion;

// ---------------------------------------------------------------------------
// Public types — suite + cases
// ---------------------------------------------------------------------------

/**
 * One regression case per IR transition. Cases reference IR nodes by id;
 * inline element selectors are deliberately absent so the suite stays in
 * lock-step with the IR (rename a state → suite still resolves; change a
 * selector criteria → executor picks up the change next run).
 */
export interface RegressionCase {
  /** Stable case id — equal to the transition id. */
  id: string;
  /** IR transition id. */
  transitionId: string;
  /** `IRTransition.fromStates`, sorted ascending. */
  fromStates: string[];
  /** `IRTransition.activateStates`, sorted ascending. */
  activateStates: string[];
  /** `IRTransition.exitStates ?? []`, sorted ascending. */
  exitStates: string[];
  /** Assertions for this case, sorted by `(kind, secondary)` — see comparator. */
  assertions: RegressionAssertion[];
}

/**
 * Top-level regression suite.
 *
 * A suite is a deterministic, JSON-serializable description of every
 * behavioral assertion the IR implies. Generation is pure: the same IR + opts
 * produce a byte-identical suite, and `(de)serializeSuite` round-trips
 * losslessly.
 */
export interface RegressionSuite {
  /** Suite id — `${ir.id}@suite`. */
  id: string;
  /** IR identity at generation time. */
  ir: { id: string; version: IRVersion };
  /** One case per IR transition, sorted by case id ascending. */
  cases: RegressionCase[];
}

// ---------------------------------------------------------------------------
// Public types — overlays (interface only; impls live in Phase 2)
// ---------------------------------------------------------------------------

/**
 * Read-only context passed to each `AssertionOverlay`. The `case` field is
 * the case under construction *after* built-in assertions have been attached
 * but *before* this overlay (and any subsequent overlays) run. Overlays are
 * applied in the order supplied via `GeneratorOptions.overlays` — the
 * generator does NOT re-sort overlays, so callers control composition.
 */
export interface AssertionOverlayContext {
  /** The full IR document being processed. */
  ir: IRDocument;
  /** The case currently being assembled. */
  case: RegressionCase;
  /** The IR transition this case was built from. */
  transition: IRTransition;
  /** The namespace forwarded from `GeneratorOptions.baselineNamespace`. */
  baselineNamespace?: string;
}

/**
 * Plug-in surface for Phase 2 overlays (visibility, token, cross-check).
 * Each overlay has a stable id (used for telemetry + ordering tests) and
 * returns zero-or-more `RegressionAssertion`s to attach to the case.
 *
 * Implementations live in `regression-overlays.ts` (Phase 2). This interface
 * is intentionally exported here so Phase 2 imports it from one place
 * (no circular dep, no forward declaration).
 */
export interface AssertionOverlay {
  /** Stable, human-readable overlay id (e.g. "visibility", "token"). */
  id: string;
  /** Produce additional assertions for this case. May return `[]`. */
  apply(ctx: AssertionOverlayContext): RegressionAssertion[];
}

// ---------------------------------------------------------------------------
// Public types — generator options + coverage
// ---------------------------------------------------------------------------

/**
 * Opaque marker for the visual baseline store. The generator doesn't read
 * baselines (suites are pure spec); the *presence* of this option is the
 * signal to emit `VisualGateAssertion`s. The actual store interface lives
 * in `visual/types.ts:198` and is consumed by the executor.
 */
export type BaselineStoreMarker = Record<string, unknown>;

/**
 * Generator options.
 *
 * All fields are optional. Order of overlay invocation is preserved exactly
 * as supplied — overlays are NOT re-sorted by id, so the caller controls
 * composition determinism.
 */
export interface GeneratorOptions {
  /**
   * Pluggable overlays invoked in order *after* built-in assertions are
   * attached for each case. Determinism contract: same array (same order,
   * same ids) → same output.
   */
  overlays?: AssertionOverlay[];
  /**
   * When provided, triggers `VisualGateAssertion` emission per `activateState`.
   * The store itself is opaque to the generator.
   */
  baselineStore?: BaselineStoreMarker;
  /**
   * Optional namespace prefix for baseline keys. Recommended values: a
   * content hash, git SHA, or build id — anything callers want to scope
   * baselines by. When absent, keys are `${doc.id}/state-${state.id}`.
   */
  baselineNamespace?: string;
}

/**
 * Coverage report shape — answers "how much of the IR does this suite touch?".
 */
export interface CoverageReport {
  /** Total IR states. */
  totalStates: number;
  /** Total IR transitions. */
  totalTransitions: number;
  /** Distinct states referenced by at least one case (any of from/activate/exit). */
  statesCovered: number;
  /** Transitions covered === number of cases. */
  transitionsCovered: number;
  /** State ids reachable from `ir.initialState` (or any state if absent), sorted. */
  reachableStates: string[];
  /** State ids NOT reachable, sorted. */
  unreachableStates: string[];
}

// ---------------------------------------------------------------------------
// Sort comparators — single point of determinism truth
// ---------------------------------------------------------------------------

/**
 * Lexicographic string comparator. Avoid `arr.sort()` directly — always
 * spread into a fresh array first so we never mutate caller-supplied input.
 */
function byString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Sort comparator over objects with an `id: string` field. */
function byId<T extends { id: string }>(a: T, b: T): number {
  return byString(a.id, b.id);
}

/**
 * Assertion sort comparator. Primary by `kind` (alphabetical), secondary by
 * a kind-specific tiebreaker so two same-kind assertions in one case still
 * land in a stable, IR-driven order.
 *
 * Tiebreakers:
 * - `state-active`: by `(phase, stateId)` — pre before post, then state id.
 * - `action-target-resolves`: by `actionIndex`.
 * - `visual-gate`: by `stateId`.
 * - `overlay`: by `(overlayId, assertionId)`.
 */
function byAssertionOrder(
  a: RegressionAssertion,
  b: RegressionAssertion,
): number {
  if (a.kind !== b.kind) return byString(a.kind, b.kind);
  switch (a.kind) {
    case "state-active": {
      const bb = b as StateActiveAssertion;
      if (a.phase !== bb.phase) return byString(a.phase, bb.phase);
      return byString(a.stateId, bb.stateId);
    }
    case "action-target-resolves": {
      const bb = b as ActionTargetResolvesAssertion;
      if (a.actionIndex !== bb.actionIndex) return a.actionIndex - bb.actionIndex;
      return 0;
    }
    case "visual-gate": {
      const bb = b as VisualGateAssertion;
      return byString(a.stateId, bb.stateId);
    }
    case "overlay": {
      const bb = b as OverlayAssertion;
      const byOverlay = byString(a.overlayId, bb.overlayId);
      if (byOverlay !== 0) return byOverlay;
      return byString(a.assertionId, bb.assertionId);
    }
  }
}

/** Defensive sorted copy — never mutate caller-owned arrays. */
function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort(byString);
}

// ---------------------------------------------------------------------------
// Baseline-key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic baseline lookup key for a given (doc, state).
 *
 * Format:
 * - With namespace: `${baselineNamespace}/${doc.id}/state-${stateId}`
 * - Without:        `${doc.id}/state-${stateId}`
 *
 * `IRDocument.version` is the *schema* version (`"1.0"`) and is intentionally
 * NOT used here — keying on it would yield `@1.0` on every doc and never
 * invalidate on content change. Callers that want content-aware invalidation
 * supply a namespace (a content hash, a git SHA, etc.).
 */
export function deriveBaselineKey(
  doc: IRDocument,
  stateId: string,
  baselineNamespace?: string,
): string {
  const base = `${doc.id}/state-${stateId}`;
  return baselineNamespace !== undefined && baselineNamespace !== ""
    ? `${baselineNamespace}/${base}`
    : base;
}

// ---------------------------------------------------------------------------
// Case assembly
// ---------------------------------------------------------------------------

/** Build the (a) source-state predicates for one case. */
function buildPreStateAssertions(
  ir: IRDocument,
  transition: IRTransition,
): StateActiveAssertion[] {
  const stateById = indexStatesById(ir);
  const out: StateActiveAssertion[] = [];
  for (const stateId of sortedCopy(transition.fromStates)) {
    const state = stateById.get(stateId);
    const len = state?.requiredElements.length ?? 0;
    const indices: number[] = [];
    for (let i = 0; i < len; i++) indices.push(i);
    out.push({
      kind: "state-active",
      phase: "pre",
      stateId,
      requiredElementIds: indices,
    });
  }
  return out;
}

/** Build the (b) target-state predicates for one case. */
function buildPostStateAssertions(
  ir: IRDocument,
  transition: IRTransition,
): StateActiveAssertion[] {
  const stateById = indexStatesById(ir);
  const out: StateActiveAssertion[] = [];
  for (const stateId of sortedCopy(transition.activateStates)) {
    const state = stateById.get(stateId);
    const len = state?.requiredElements.length ?? 0;
    const indices: number[] = [];
    for (let i = 0; i < len; i++) indices.push(i);
    out.push({
      kind: "state-active",
      phase: "post",
      stateId,
      requiredElementIds: indices,
    });
  }
  return out;
}

/** Build the (c) action-target findability assertions for one case. */
function buildActionTargetAssertions(
  transition: IRTransition,
): ActionTargetResolvesAssertion[] {
  const out: ActionTargetResolvesAssertion[] = [];
  // Iterate in declared order; actions are an ordered sequence per IR contract.
  for (let i = 0; i < transition.actions.length; i++) {
    const action = transition.actions[i]!;
    out.push({
      kind: "action-target-resolves",
      transitionId: transition.id,
      actionIndex: i,
      targetCriteria: cloneCriteria(action.target),
    });
  }
  return out;
}

/** Build the (d) optional visual-gate assertions for one case. */
function buildVisualGateAssertions(
  ir: IRDocument,
  transition: IRTransition,
  opts: GeneratorOptions,
): VisualGateAssertion[] {
  if (opts.baselineStore === undefined) return [];
  const out: VisualGateAssertion[] = [];
  for (const stateId of sortedCopy(transition.activateStates)) {
    out.push({
      kind: "visual-gate",
      stateId,
      baselineKey: deriveBaselineKey(ir, stateId, opts.baselineNamespace),
    });
  }
  return out;
}

/**
 * Index IR states by id. Computed once per case for clarity; the work is
 * trivially cheap (a few hundred entries at most in realistic IRs) and
 * keeping it local means the helpers stay pure functions of their inputs.
 */
function indexStatesById(ir: IRDocument): Map<string, IRDocument["states"][number]> {
  const m = new Map<string, IRDocument["states"][number]>();
  // Iterate as supplied — the resulting Map is only used for lookups, so
  // insertion order doesn't affect determinism of downstream output.
  for (const s of ir.states) m.set(s.id, s);
  return m;
}

/**
 * Deep-clone an `IRElementCriteria` so suite serialization is independent of
 * the caller's IR object identity (avoids accidental aliasing across cases).
 */
function cloneCriteria(c: IRElementCriteria): IRElementCriteria {
  const cloned: IRElementCriteria = {};
  if (c.role !== undefined) cloned.role = c.role;
  if (c.tagName !== undefined) cloned.tagName = c.tagName;
  if (c.text !== undefined) cloned.text = c.text;
  if (c.textContains !== undefined) cloned.textContains = c.textContains;
  if (c.ariaLabel !== undefined) cloned.ariaLabel = c.ariaLabel;
  if (c.accessibleName !== undefined) cloned.accessibleName = c.accessibleName;
  if (c.id !== undefined) cloned.id = c.id;
  if (c.attributes !== undefined) {
    const attrs: Record<string, string> = {};
    // Sort attribute keys so serialized output is stable independent of
    // caller-supplied insertion order.
    const keys = Object.keys(c.attributes).sort(byString);
    for (const k of keys) attrs[k] = c.attributes[k]!;
    cloned.attributes = attrs;
  }
  return cloned;
}

/** Compose one case for one transition, including overlay-supplied assertions. */
function buildCase(
  ir: IRDocument,
  transition: IRTransition,
  opts: GeneratorOptions,
): RegressionCase {
  const builtIn: RegressionAssertion[] = [
    ...buildPreStateAssertions(ir, transition),
    ...buildPostStateAssertions(ir, transition),
    ...buildActionTargetAssertions(transition),
    ...buildVisualGateAssertions(ir, transition, opts),
  ];

  const partial: RegressionCase = {
    id: transition.id,
    transitionId: transition.id,
    fromStates: sortedCopy(transition.fromStates),
    activateStates: sortedCopy(transition.activateStates),
    exitStates: sortedCopy(transition.exitStates ?? []),
    assertions: builtIn,
  };

  // Apply overlays in caller-supplied order. Each overlay sees the case as
  // it stands after built-ins + earlier overlays — that's the documented
  // contract so callers can compose dependent overlays.
  const overlays = opts.overlays ?? [];
  for (const overlay of overlays) {
    const extra = overlay.apply({
      ir,
      case: partial,
      transition,
      baselineNamespace: opts.baselineNamespace,
    });
    for (const a of extra) partial.assertions.push(a);
  }

  // Final sort — guarantees determinism even if an overlay produced
  // assertions in arbitrary order.
  partial.assertions.sort(byAssertionOrder);
  return partial;
}

// ---------------------------------------------------------------------------
// Public API — generation
// ---------------------------------------------------------------------------

/**
 * Walk the IR and emit a deterministic regression suite — one case per
 * transition, sorted by transition id ascending. Pure function: same inputs
 * (same IR, same overlay array, same baseline namespace) produce a
 * byte-identical suite.
 *
 * Suite size scales linearly with the number of transitions; per-transition
 * cost is `O(|fromStates| + |activateStates| + |actions|)` plus overlay cost.
 */
export function generateRegressionSuite(
  ir: IRDocument,
  opts: GeneratorOptions = {},
): RegressionSuite {
  // Sort transitions defensively — callers may build IRs in arbitrary order
  // (e.g., insertion order of a Map). We never trust the caller's order.
  const sortedTransitions = [...ir.transitions].sort(byId);
  const cases: RegressionCase[] = sortedTransitions.map((t) =>
    buildCase(ir, t, opts),
  );

  return {
    id: `${ir.id}@suite`,
    ir: { id: ir.id, version: ir.version },
    cases,
  };
}

// ---------------------------------------------------------------------------
// Public API — serialization
// ---------------------------------------------------------------------------

/**
 * Recursively walk a JSON-serializable value and re-emit it with object keys
 * sorted alphabetically at every level. Arrays preserve order — array order
 * is meaningful in the suite (assertion ordering is part of the contract).
 *
 * `unknown` is the right type for the input: we only touch JSON-shape values
 * (string, number, boolean, null, array, plain object). Any other value
 * (function, symbol, undefined-as-property) violates the JSON contract and
 * is excluded by `JSON.stringify` anyway.
 */
function stableStringifyValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stableStringifyValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(byString);
    const sorted: Record<string, unknown> = {};
    for (const k of keys) sorted[k] = stableStringifyValue(obj[k]);
    return sorted;
  }
  return value;
}

/**
 * Serialize a suite to deterministic JSON. Object keys are sorted at every
 * level; array order is preserved (it carries semantic meaning).
 *
 * Round-trip contract: `deserializeSuite(serializeSuite(s))` is structurally
 * equal to `s`, and `serializeSuite(deserializeSuite(serializeSuite(s)))`
 * is byte-identical to `serializeSuite(s)`.
 */
export function serializeSuite(suite: RegressionSuite): string {
  return JSON.stringify(stableStringifyValue(suite));
}

/**
 * Parse and shape-validate a serialized suite.
 *
 * Validation is intentionally shallow: we check the top-level fields
 * (`id`, `ir.id`, `ir.version`, `cases` array). Per-assertion shape drift
 * is caught by the round-trip test, not by paranoid runtime validation.
 *
 * @throws Error with a clear message when the parsed value isn't suite-shaped.
 */
export function deserializeSuite(json: string): RegressionSuite {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `deserializeSuite: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("deserializeSuite: expected a JSON object at top level");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.id !== "string") {
    throw new Error("deserializeSuite: missing or non-string `id`");
  }
  if (
    obj.ir === null ||
    typeof obj.ir !== "object" ||
    Array.isArray(obj.ir)
  ) {
    throw new Error("deserializeSuite: missing or non-object `ir`");
  }
  const irObj = obj.ir as Record<string, unknown>;
  if (typeof irObj.id !== "string") {
    throw new Error("deserializeSuite: missing or non-string `ir.id`");
  }
  if (irObj.version !== "1.0") {
    throw new Error(
      `deserializeSuite: unsupported \`ir.version\` — expected "1.0", got ${JSON.stringify(irObj.version)}`,
    );
  }
  if (!Array.isArray(obj.cases)) {
    throw new Error("deserializeSuite: missing or non-array `cases`");
  }

  // The shallow validation above is enough for the round-trip contract; the
  // structural type cast is safe because byte-identical round-trips are
  // covered by tests that exercise the full shape.
  return parsed as RegressionSuite;
}

// ---------------------------------------------------------------------------
// Public API — coverage
// ---------------------------------------------------------------------------

/**
 * Local BFS over the IR transition graph. Returns the set of state ids
 * reachable from `seeds` by repeatedly firing transitions whose `fromStates`
 * are all already reachable.
 *
 * This is a deliberately small breadth-first walk — distinct from
 * `state/pathfinder.ts`'s `bfs` (which targets the runtime
 * `TransitionDefinition` shape and tracks `(activeStates, targetsReached)`
 * tuples for multi-target search). Coverage doesn't need that machinery;
 * keeping the walk local avoids an adapter layer.
 *
 * Determinism: the `next` queue is processed in sorted-id order; the result
 * set is returned with stable-sorted ids in `reachableStates`.
 */
function reachableFrom(ir: IRDocument, seeds: readonly string[]): Set<string> {
  const reachable = new Set<string>(seeds);
  const transitionsSorted = [...ir.transitions].sort(byId);

  // Iterate to fixpoint — at most O(|transitions|) outer iterations because
  // each iteration either grows `reachable` or terminates the loop.
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of transitionsSorted) {
      // A transition is "available" once all its fromStates are reachable.
      let available = true;
      for (const s of t.fromStates) {
        if (!reachable.has(s)) {
          available = false;
          break;
        }
      }
      if (!available) continue;
      for (const s of t.activateStates) {
        if (!reachable.has(s)) {
          reachable.add(s);
          changed = true;
        }
      }
    }
  }
  return reachable;
}

/**
 * Compute coverage of the IR by the suite. `transitionsCovered` is just
 * `suite.cases.length` (one case per transition). `reachableStates` is
 * computed via a local BFS from `ir.initialState` if present, else from
 * every state in the IR (so coverage isn't gated on a declared start node).
 */
export function coverageOf(
  ir: IRDocument,
  suite: RegressionSuite,
): CoverageReport {
  const allStateIds = new Set<string>();
  for (const s of ir.states) allStateIds.add(s.id);

  // States touched by at least one case (any of from/activate/exit).
  const touched = new Set<string>();
  for (const c of suite.cases) {
    for (const s of c.fromStates) touched.add(s);
    for (const s of c.activateStates) touched.add(s);
    for (const s of c.exitStates) touched.add(s);
  }

  // Reachability seeds: prefer `initialState`, else every declared state.
  const seeds: string[] =
    ir.initialState !== undefined
      ? [ir.initialState]
      : [...allStateIds].sort(byString);
  const reachable = reachableFrom(ir, seeds);

  const reachableStates: string[] = [];
  const unreachableStates: string[] = [];
  for (const id of [...allStateIds].sort(byString)) {
    if (reachable.has(id)) reachableStates.push(id);
    else unreachableStates.push(id);
  }

  return {
    totalStates: ir.states.length,
    totalTransitions: ir.transitions.length,
    statesCovered: touched.size,
    transitionsCovered: suite.cases.length,
    reachableStates,
    unreachableStates,
  };
}
