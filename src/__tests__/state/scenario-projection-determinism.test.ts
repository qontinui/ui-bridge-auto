/**
 * Determinism gate for `projectScenarios` (Section 11, Phase B1).
 *
 * Mirrors `regression-generator-determinism.test.ts` and
 * `self-diagnosis-determinism.test.ts`: the SAME `IRDocument` input run 10x
 * must produce byte-identical canonical-JSON output. If this test ever
 * fails, the static projection has acquired a non-determinism leak — Map
 * iteration order escaping into output, an unstable sort, etc. Fix the
 * leak. Do NOT relax this test.
 *
 * Note: `projectCurrentScenario` is intentionally NOT gated here — it is
 * non-deterministic by design (registry state varies). The only invariant
 * we assert about it is `deterministic: false`, which the unit test file
 * already covers.
 */

import { describe, it, expect } from "vitest";
import type {
  IRDocument,
  IRState,
  IRTransition,
  IRTransitionAction,
} from "@qontinui/shared-types/ui-bridge-ir";

import { projectScenarios } from "../../state/scenario-projection";
import { canonicalJSON } from "../../state/canonical-json";
import { makeTestAssertion } from "../test-helpers";

// ---------------------------------------------------------------------------
// Constants — RUNS, fixed strings. Never derived from Date.now() / random.
// ---------------------------------------------------------------------------

const RUNS = 10;

// ---------------------------------------------------------------------------
// Fixture builders — deliberately rebuilt fresh on every call so no shared
// mutable state can leak between runs of the determinism gate.
// ---------------------------------------------------------------------------

function mkState(id: string, requiredCount: number, name = id): IRState {
  const assertions = [];
  for (let i = 0; i < requiredCount; i++) {
    assertions.push(makeTestAssertion(id, i, { id: `${id}-el-${i}` }));
  }
  return { id, name, assertions };
}

function mkAction(
  type: string,
  target: IRTransitionAction["target"],
): IRTransitionAction {
  return { type, target };
}

function mkTransition(
  id: string,
  fromStates: string[],
  activateStates: string[],
  actions: IRTransitionAction[],
): IRTransition {
  return {
    id,
    name: id,
    fromStates,
    activateStates,
    actions,
  };
}

/**
 * Small IR: 4 states + 5 transitions, multi-fromState transition, multiple
 * actions per transition, authored deliberately out-of-id-order to exercise
 * every internal sort.
 */
function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "det-doc",
    name: "Determinism Doc",
    states: [
      mkState("d", 0, "D-named"),
      mkState("a", 2),
      mkState("c", 0),
      mkState("b", 1, "B-named"),
    ],
    transitions: [
      // Out of id-order on purpose.
      mkTransition(
        "t-c-to-a",
        ["c"],
        ["a"],
        [mkAction("click", { id: "btn-c-to-a" })],
      ),
      mkTransition(
        "t-a-to-b",
        ["a"],
        ["b"],
        [
          mkAction("click", { id: "btn-a-to-b", text: "Go" }),
          mkAction("type", { id: "input-a", textContains: "name" }),
        ],
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [mkAction("click", { role: "button", text: "Next" })],
      ),
      // Multi-fromState transition.
      mkTransition(
        "t-ab-to-d",
        ["a", "b"],
        ["d"],
        [mkAction("click", { id: "btn-ab-to-d" })],
      ),
      mkTransition(
        "t-a-to-c",
        ["a"],
        ["c"],
        [mkAction("click", { id: "btn-a-to-c" })],
      ),
    ],
    initialState: "a",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("projectScenarios — determinism gate", () => {
  it("produces byte-identical projection across 10 runs", () => {
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ir = makeFixtureIR();
      const proj = projectScenarios(ir);
      serialized.push(canonicalJSON(proj));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output regardless of input array order", () => {
    // Same content, different state + transition array order. The projection
    // must sort internally, so output should be identical.
    const baseline = canonicalJSON(projectScenarios(makeFixtureIR()));
    const ir = makeFixtureIR();
    ir.states.reverse();
    ir.transitions.reverse();
    const reshuffled = canonicalJSON(projectScenarios(ir));
    expect(reshuffled).toBe(baseline);
  });

  it("produces byte-identical output for an IR with no transitions across 10 runs", () => {
    const buildIR = (): IRDocument => ({
      version: "1.0",
      id: "stateful-no-transitions",
      name: "Stateful, no transitions",
      states: [mkState("z", 1), mkState("a", 0)],
      transitions: [],
    });
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      serialized.push(canonicalJSON(projectScenarios(buildIR())));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output for an empty IR across 10 runs", () => {
    const buildIR = (): IRDocument => ({
      version: "1.0",
      id: "empty",
      name: "Empty",
      states: [],
      transitions: [],
    });
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      serialized.push(canonicalJSON(projectScenarios(buildIR())));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });
});
