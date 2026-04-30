/**
 * Drift comparator — compares an authored IR document against a runtime
 * snapshot from the live registry and surfaces the differences.
 *
 * Pure function: no I/O, no globals, no side effects. Used by section 7
 * (drift-hypothesis correlation against git history) and exposed via the
 * Spec API in section 2 for synchronous drift queries.
 *
 * Output is deterministic: entries are sorted by `id`, then by `kind`
 * (alphabetical) so the same input always produces the same report.
 */

import type {
  IRDocument,
  IRState,
  IRTransition,
} from "@qontinui/shared-types/ui-bridge-ir";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal runtime snapshot — the subset of state-machine registry data
 * needed for drift comparison. Designed to be the structural intersection
 * of ui-bridge-auto's runtime `State` / `Transition` shapes
 * (`ui-bridge-auto/src/types/state.ts`, `ui-bridge-auto/src/types/transition.ts`)
 * and the SDK-side runtime types in `ui-bridge`. Callers project from
 * either world into this shape before invoking the comparator.
 */
export interface RuntimeSnapshot {
  states: Array<{
    id: string;
    name?: string;
    requiredElements?: unknown;
  }>;
  transitions: Array<{
    id: string;
    name?: string;
    fromStates?: string[];
    activateStates?: string[];
    exitStates?: string[];
  }>;
}

/**
 * A single drift finding. `id` is the IR or runtime node id (transition
 * shape-mismatch entries reuse the transition id; state shape-mismatches
 * reuse the state id).
 */
export interface DriftEntry {
  id: string;
  kind: "missing-in-runtime" | "missing-in-ir" | "shape-mismatch";
  /** Human-readable summary of the divergence. */
  detail: string;
}

/** Comparator output — drift entries grouped by node kind. */
export interface DriftReport {
  states: DriftEntry[];
  transitions: DriftEntry[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare an authored IR document against a runtime snapshot and return a
 * deterministic diff report.
 *
 * Comparison rules:
 * - **missing-in-runtime**: an IR state/transition with an id not present in
 *   the runtime snapshot.
 * - **missing-in-ir**: a runtime state/transition with an id not present in
 *   the IR document.
 * - **shape-mismatch (states)**: IR `requiredElements.length` differs from
 *   runtime `requiredElements.length` (only when the runtime entry exposes
 *   the field as an array — otherwise the check is skipped).
 * - **shape-mismatch (transitions)**: IR `activateStates`, `fromStates`, or
 *   `exitStates ?? []` differ from the corresponding runtime field
 *   (compared as sorted arrays of strings). Each mismatched field becomes
 *   its own DriftEntry. Skipped when the runtime omits the field.
 */
export function compareSpecToRuntime(
  doc: IRDocument,
  runtime: RuntimeSnapshot,
): DriftReport {
  const states = compareStates(doc.states, runtime.states);
  const transitions = compareTransitions(doc.transitions, runtime.transitions);
  states.sort(byIdThenKind);
  transitions.sort(byIdThenKind);
  return { states, transitions };
}

// ---------------------------------------------------------------------------
// State comparison
// ---------------------------------------------------------------------------

function compareStates(
  irStates: IRState[],
  runtimeStates: RuntimeSnapshot["states"],
): DriftEntry[] {
  const out: DriftEntry[] = [];

  const irById = new Map<string, IRState>();
  for (const s of irStates) irById.set(s.id, s);
  const runtimeById = new Map<string, RuntimeSnapshot["states"][number]>();
  for (const s of runtimeStates) runtimeById.set(s.id, s);

  // missing-in-runtime: IR has it, runtime doesn't.
  for (const ir of irStates) {
    if (!runtimeById.has(ir.id)) {
      out.push({
        id: ir.id,
        kind: "missing-in-runtime",
        detail: `state ${ir.id}: declared in IR, not present in runtime registry`,
      });
    }
  }

  // missing-in-ir: runtime has it, IR doesn't.
  for (const rt of runtimeStates) {
    if (!irById.has(rt.id)) {
      out.push({
        id: rt.id,
        kind: "missing-in-ir",
        detail: `state ${rt.id}: registered at runtime, not declared in IR`,
      });
    }
  }

  // shape-mismatch on requiredElements length when both sides agree on id.
  for (const ir of irStates) {
    const rt = runtimeById.get(ir.id);
    if (!rt) continue;
    if (!Array.isArray(rt.requiredElements)) continue;
    const irLen = ir.requiredElements?.length ?? 0;
    const rtLen = rt.requiredElements.length;
    if (irLen !== rtLen) {
      out.push({
        id: ir.id,
        kind: "shape-mismatch",
        detail: `state ${ir.id}: requiredElements length differs — IR=${irLen} runtime=${rtLen}`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Transition comparison
// ---------------------------------------------------------------------------

function compareTransitions(
  irTransitions: IRTransition[],
  runtimeTransitions: RuntimeSnapshot["transitions"],
): DriftEntry[] {
  const out: DriftEntry[] = [];

  const irById = new Map<string, IRTransition>();
  for (const t of irTransitions) irById.set(t.id, t);
  const runtimeById = new Map<string, RuntimeSnapshot["transitions"][number]>();
  for (const t of runtimeTransitions) runtimeById.set(t.id, t);

  // missing-in-runtime
  for (const ir of irTransitions) {
    if (!runtimeById.has(ir.id)) {
      out.push({
        id: ir.id,
        kind: "missing-in-runtime",
        detail: `transition ${ir.id}: declared in IR, not present in runtime registry`,
      });
    }
  }

  // missing-in-ir
  for (const rt of runtimeTransitions) {
    if (!irById.has(rt.id)) {
      out.push({
        id: rt.id,
        kind: "missing-in-ir",
        detail: `transition ${rt.id}: registered at runtime, not declared in IR`,
      });
    }
  }

  // shape-mismatch per field. Each mismatched field is its own entry.
  for (const ir of irTransitions) {
    const rt = runtimeById.get(ir.id);
    if (!rt) continue;

    addTransitionFieldMismatch(out, ir.id, "fromStates", ir.fromStates, rt.fromStates);
    addTransitionFieldMismatch(
      out,
      ir.id,
      "activateStates",
      ir.activateStates,
      rt.activateStates,
    );
    addTransitionFieldMismatch(
      out,
      ir.id,
      "exitStates",
      ir.exitStates ?? [],
      rt.exitStates,
    );
  }

  return out;
}

/**
 * Push a shape-mismatch DriftEntry for a single transition field if and only
 * if the runtime side defines the field AND the sorted IR/runtime arrays
 * differ.
 */
function addTransitionFieldMismatch(
  out: DriftEntry[],
  id: string,
  field: "fromStates" | "activateStates" | "exitStates",
  ir: string[],
  runtime: string[] | undefined,
): void {
  if (runtime === undefined) return;
  const irSorted = sortStrings(ir);
  const rtSorted = sortStrings(runtime);
  if (arraysEqual(irSorted, rtSorted)) return;
  out.push({
    id,
    kind: "shape-mismatch",
    detail: `transition ${id}: ${field} differ — IR=[${irSorted.join(",")}] runtime=[${rtSorted.join(",")}]`,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortStrings(values: string[]): string[] {
  return [...values].sort();
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Sort comparator: primary by `id`, secondary by `kind` (alphabetical).
 * Determinism guarantee for downstream consumers.
 */
function byIdThenKind(a: DriftEntry, b: DriftEntry): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  if (a.kind < b.kind) return -1;
  if (a.kind > b.kind) return 1;
  return 0;
}
