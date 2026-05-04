/**
 * Unit coverage for the scenario projection (Section 11, Phase B1).
 *
 * Two surfaces under test:
 *   - `projectScenarios(ir)`            — pure, deterministic.
 *   - `projectCurrentScenario(ir, reg)` — runtime-aware, marker `deterministic: false`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  IRDocument,
  IRState,
  IRTransition,
  IRTransitionAction,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  projectScenarios,
  projectCurrentScenario,
  type CurrentScenarioProjection,
  type ScenarioProjection,
} from "../../state/scenario-projection";
import { MockRegistry, createMockElement, resetIdCounter } from "../../test-utils";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkState(id: string, requiredCount: number, name = id): IRState {
  const requiredElements = [];
  for (let i = 0; i < requiredCount; i++) {
    requiredElements.push({ id: `${id}-el-${i}` });
  }
  return { id, name, requiredElements };
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
  name?: string,
): IRTransition {
  return {
    id,
    name: name ?? id,
    fromStates,
    activateStates,
    actions,
  };
}

/**
 * 3-state IR with 4 transitions (a->b, a->c, b->c, c->a). Authored
 * out-of-order to exercise the projection's internal sort.
 */
function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "test-doc",
    name: "Test Doc",
    states: [
      mkState("c", 0),
      mkState("a", 2, "Alpha state"),
      mkState("b", 1),
    ],
    transitions: [
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
          mkAction("click", { id: "btn-a-to-b" }),
          mkAction("type", { id: "input-a", textContains: "name" }),
        ],
        "A to B transition",
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [mkAction("click", { role: "button", text: "Next" })],
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
// projectScenarios — static
// ---------------------------------------------------------------------------

describe("projectScenarios", () => {
  it("emits one ProjectedState per IR state, sorted by stateId ascending", () => {
    const proj = projectScenarios(makeFixtureIR());
    expect(proj.states.map((s) => s.stateId)).toEqual(["a", "b", "c"]);
  });

  it("populates requiredElementCount from IRState.requiredElements.length", () => {
    const proj = projectScenarios(makeFixtureIR());
    const byId = new Map(proj.states.map((s) => [s.stateId, s]));
    expect(byId.get("a")?.requiredElementCount).toBe(2);
    expect(byId.get("b")?.requiredElementCount).toBe(1);
    expect(byId.get("c")?.requiredElementCount).toBe(0);
  });

  it("emits a label only when the IR name differs from the id", () => {
    const proj = projectScenarios(makeFixtureIR());
    const byId = new Map(proj.states.map((s) => [s.stateId, s]));
    expect(byId.get("a")?.label).toBe("Alpha state");
    expect(byId.get("b")?.label).toBeUndefined();
    expect(byId.get("c")?.label).toBeUndefined();
  });

  it("buckets transitions under each fromState, sorted by transitionId ascending", () => {
    const proj = projectScenarios(makeFixtureIR());
    const byId = new Map(proj.states.map((s) => [s.stateId, s]));
    expect(byId.get("a")?.outboundTransitions.map((t) => t.transitionId)).toEqual([
      "t-a-to-b",
      "t-a-to-c",
    ]);
    expect(byId.get("b")?.outboundTransitions.map((t) => t.transitionId)).toEqual([
      "t-b-to-c",
    ]);
    expect(byId.get("c")?.outboundTransitions.map((t) => t.transitionId)).toEqual([
      "t-c-to-a",
    ]);
  });

  it("populates targetStateIds + actionCount per transition", () => {
    const proj = projectScenarios(makeFixtureIR());
    const a = proj.states.find((s) => s.stateId === "a")!;
    const tAToB = a.outboundTransitions.find(
      (t) => t.transitionId === "t-a-to-b",
    )!;
    expect(tAToB.targetStateIds).toEqual(["b"]);
    expect(tAToB.actionCount).toBe(2);
    expect(tAToB.label).toBe("A to B transition");
  });

  it("omits transition label when name === id", () => {
    const proj = projectScenarios(makeFixtureIR());
    const a = proj.states.find((s) => s.stateId === "a")!;
    const tAToC = a.outboundTransitions.find(
      (t) => t.transitionId === "t-a-to-c",
    )!;
    expect(tAToC.label).toBeUndefined();
  });

  it("marks the result as deterministic: true", () => {
    const proj: ScenarioProjection = projectScenarios(makeFixtureIR());
    expect(proj.deterministic).toBe(true);
  });

  it("never mutates caller-supplied arrays", () => {
    const ir = makeFixtureIR();
    const stateIdsBefore = ir.states.map((s) => s.id);
    const transitionIdsBefore = ir.transitions.map((t) => t.id);
    projectScenarios(ir);
    expect(ir.states.map((s) => s.id)).toEqual(stateIdsBefore);
    expect(ir.transitions.map((t) => t.id)).toEqual(transitionIdsBefore);
  });

  it("handles an IR with zero transitions", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "empty",
      name: "Empty",
      states: [mkState("only-state", 1)],
      transitions: [],
    };
    const proj = projectScenarios(ir);
    expect(proj.states).toHaveLength(1);
    expect(proj.states[0]!.outboundTransitions).toEqual([]);
  });

  it("handles an IR with zero states", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "stateless",
      name: "Stateless",
      states: [],
      transitions: [],
    };
    const proj = projectScenarios(ir);
    expect(proj.states).toEqual([]);
  });

  it("buckets a multi-precondition transition under every fromState", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "multi",
      name: "Multi",
      states: [mkState("a", 0), mkState("b", 0), mkState("c", 0)],
      transitions: [
        mkTransition(
          "t-ab-to-c",
          ["a", "b"],
          ["c"],
          [mkAction("click", { id: "btn" })],
        ),
      ],
    };
    const proj = projectScenarios(ir);
    const byId = new Map(proj.states.map((s) => [s.stateId, s]));
    expect(byId.get("a")?.outboundTransitions.map((t) => t.transitionId)).toEqual([
      "t-ab-to-c",
    ]);
    expect(byId.get("b")?.outboundTransitions.map((t) => t.transitionId)).toEqual([
      "t-ab-to-c",
    ]);
    expect(byId.get("c")?.outboundTransitions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// projectCurrentScenario — runtime-aware
// ---------------------------------------------------------------------------

describe("projectCurrentScenario", () => {
  let registry: MockRegistry;

  beforeEach(() => {
    resetIdCounter();
    registry = new MockRegistry();
  });

  it("returns the same `states` shape as projectScenarios", () => {
    const ir = makeFixtureIR();
    const staticProj = projectScenarios(ir);
    const runtimeProj = projectCurrentScenario(ir, registry);
    expect(runtimeProj.states).toEqual(staticProj.states);
  });

  it("marks the result as deterministic: false", () => {
    const proj: CurrentScenarioProjection = projectCurrentScenario(
      makeFixtureIR(),
      registry,
    );
    expect(proj.deterministic).toBe(false);
  });

  it("identifies currently-active states via required-element matches", () => {
    // Add the required element for state-a (`a-el-0`). State-a should be
    // active; b + c should not.
    registry.addElement(createMockElement({ id: "a-el-0" }));
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    expect(proj.currentStateIds).toEqual(["a"]);
  });

  it("considers states with zero required elements NOT active (degenerate)", () => {
    // State `c` has 0 required elements. Even if every other element is
    // present, c should not be listed — see `isStateCurrentlyActive` doc.
    registry.addElement(createMockElement({ id: "a-el-0" }));
    registry.addElement(createMockElement({ id: "b-el-0" }));
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    expect(proj.currentStateIds).not.toContain("c");
  });

  it("classifies a transition as available when every action target resolves", () => {
    // Required + action elements for t-a-to-c (single action: btn-a-to-c).
    registry.addElement(createMockElement({ id: "btn-a-to-c" }));
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    const ids = proj.availableTransitions.map((t) => t.transitionId);
    expect(ids).toContain("t-a-to-c");
  });

  it("classifies a transition as blocked (no-match) when an action target is missing", () => {
    // No registry elements at all → every transition should be blocked.
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    expect(proj.availableTransitions).toEqual([]);
    const blockedIds = proj.blockedTransitions.map((t) => t.transitionId);
    expect(blockedIds.sort()).toEqual([
      "t-a-to-b",
      "t-a-to-c",
      "t-b-to-c",
      "t-c-to-a",
    ]);
    for (const b of proj.blockedTransitions) {
      expect(b.cause).toBe("no-match");
    }
  });

  it("attributes blocked-cause to the FIRST failing action in a multi-step transition", () => {
    // t-a-to-b has 2 actions: btn-a-to-b (click) + input-a (type).
    // Provide btn-a-to-b but NOT input-a — block should cite action[1].
    registry.addElement(createMockElement({ id: "btn-a-to-b" }));
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    const blocked = proj.blockedTransitions.find(
      (t) => t.transitionId === "t-a-to-b",
    );
    expect(blocked).toBeDefined();
    expect(blocked!.cause).toBe("no-match");
    expect(blocked!.detail).toContain("action[1]");
  });

  it("classifies a transition with no actions as predicate-failed", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "no-action",
      name: "NoAction",
      states: [mkState("a", 1), mkState("b", 0)],
      transitions: [
        // No actions at all — degenerate.
        mkTransition("t-empty", ["a"], ["b"], []),
      ],
    };
    const proj = projectCurrentScenario(ir, registry);
    expect(proj.availableTransitions).toEqual([]);
    expect(proj.blockedTransitions).toHaveLength(1);
    expect(proj.blockedTransitions[0]!.cause).toBe("predicate-failed");
  });

  it("respects maxBlockedPerState when many transitions are blocked from one state", () => {
    // Build an IR with 5 transitions all from state-a, all unresolvable.
    const states: IRState[] = [mkState("a", 0)];
    const transitions: IRTransition[] = [];
    for (let i = 0; i < 5; i++) {
      transitions.push(
        mkTransition(
          `t-${i}`,
          ["a"],
          ["a"],
          [mkAction("click", { id: `missing-${i}` })],
        ),
      );
    }
    const ir: IRDocument = {
      version: "1.0",
      id: "many",
      name: "Many",
      states,
      transitions,
    };
    const proj = projectCurrentScenario(ir, registry, {
      maxBlockedPerState: 2,
    });
    // Only 2 of the 5 transitions should appear in `blockedTransitions`.
    expect(proj.blockedTransitions).toHaveLength(2);
  });

  it("sorts availableTransitions and blockedTransitions by (fromStateId, transitionId)", () => {
    // Multi-state IR — register one matching element so we get a mix of
    // available + blocked, then verify both arrays are sorted.
    const ir = makeFixtureIR();
    registry.addElement(createMockElement({ id: "btn-a-to-c" }));
    registry.addElement(createMockElement({ id: "btn-c-to-a" }));
    const proj = projectCurrentScenario(ir, registry);

    const sortedClone = (
      arr: { fromStateId: string; transitionId: string }[],
    ): { fromStateId: string; transitionId: string }[] =>
      [...arr].sort((a, b) => {
        if (a.fromStateId !== b.fromStateId)
          return a.fromStateId < b.fromStateId ? -1 : 1;
        return a.transitionId < b.transitionId ? -1 : 1;
      });

    expect(proj.availableTransitions).toEqual(
      sortedClone(proj.availableTransitions),
    );
    expect(proj.blockedTransitions).toEqual(sortedClone(proj.blockedTransitions));
  });

  it("returns currentStateIds in sorted order", () => {
    // Force activation of state-a + state-b (out-of-order intent).
    registry.addElement(createMockElement({ id: "b-el-0" }));
    registry.addElement(createMockElement({ id: "a-el-0" }));
    const proj = projectCurrentScenario(makeFixtureIR(), registry);
    expect(proj.currentStateIds).toEqual(["a", "b"]);
  });
});
