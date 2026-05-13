/**
 * Round-trip integration test for the auto-regression generator
 * (Section 9, Phase 3).
 *
 * Builds a small but feature-rich IR (3 states, 4 transitions, with
 * provenance, assertions, conditions, and action targets carrying
 * text/role/attributes), generates a suite with all three built-in
 * overlays + a `baselineStore` + a `baselineNamespace`, then asserts:
 *   1. `serializeSuite -> deserializeSuite -> serializeSuite` is byte-identical.
 *   2. `coverageOf` reports the expected counts and reachability.
 *   3. The deserialized suite carries the expected per-case assertions
 *      (state-active pre/post, action-target-resolves, visual-gate, plus
 *      overlay assertions from each built-in overlay).
 *   4. `deserializeSuite` rejects malformed / under-shaped inputs.
 */

import { describe, it, expect } from "vitest";
import type {
  IRDocument,
  IRState,
  IRTransition,
  IRTransitionAction,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  generateRegressionSuite,
  serializeSuite,
  deserializeSuite,
  coverageOf,
  type ActionTargetResolvesAssertion,
  type RegressionAssertion,
  type StateActiveAssertion,
  type VisualGateAssertion,
} from "../../state/regression-generator";
import {
  visibilityOverlay,
  tokenOverlay,
  crossCheckOverlay,
} from "../../state/regression-overlays";
import type { DesignTokenRegistry } from "../../visual/token-check";
import { makeTestAssertion } from "../test-helpers";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function mkState(
  id: string,
  requiredCount: number,
  name = id,
  extras?: Partial<IRState>,
): IRState {
  const assertions = [];
  for (let i = 0; i < requiredCount; i++) {
    assertions.push(makeTestAssertion(id, i, { id: `${id}-el-${i}` }));
  }
  return {
    id,
    name,
    assertions,
    provenance: { source: "build-plugin", file: `src/${id}.tsx` },
    ...extras,
  };
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
  exitStates?: string[],
): IRTransition {
  return {
    id,
    name: id,
    fromStates,
    activateStates,
    exitStates,
    actions,
    provenance: { source: "build-plugin", file: `src/${id}.tsx` },
  };
}

function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "rt-doc",
    name: "Round-Trip Doc",
    states: [
      mkState("a", 2, "A", {
        conditions: [
          {
            element: { id: "a-el-0" },
            property: "visible",
            expected: true,
          },
        ],
      }),
      mkState("b", 1, "B"),
      mkState("c", 0, "C"),
    ],
    transitions: [
      mkTransition(
        "t-a-to-b",
        ["a"],
        ["b"],
        [
          mkAction("click", {
            role: "button",
            text: "Go",
            attributes: { "data-testid": "go", "data-x": "1" },
          }),
          mkAction("type", { id: "input-name", textContains: "name" }),
        ],
        ["a"],
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [mkAction("click", { role: "button", text: "Next" })],
        ["b"],
      ),
      mkTransition(
        "t-c-to-a",
        ["c"],
        ["a"],
        [mkAction("click", { role: "link", ariaLabel: "Restart" })],
        ["c"],
      ),
      mkTransition(
        "t-a-to-c",
        ["a"],
        ["c"],
        [mkAction("hover", { id: "shortcut" })],
        // exitStates omitted on purpose.
      ),
    ],
    initialState: "a",
    provenance: { source: "build-plugin" },
  };
}

function makeStubRegistry(): DesignTokenRegistry {
  return {
    allowedValuesFor(_property: string): ReadonlySet<string> | null {
      return null;
    },
    properties(): readonly string[] {
      return ["color", "fontSize"];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateRegressionSuite — round-trip integration", () => {
  it("serialize -> deserialize -> serialize is byte-identical", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const suite = generateRegressionSuite(ir, {
      overlays: [
        visibilityOverlay(),
        tokenOverlay(registry),
        crossCheckOverlay(),
      ],
      baselineStore: {},
      baselineNamespace: "test-namespace",
    });

    const json = serializeSuite(suite);
    const parsed = deserializeSuite(json);
    const json2 = serializeSuite(parsed);

    expect(json2).toBe(json);
  });

  it("coverageOf reports correct counts + full reachability from initialState", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const suite = generateRegressionSuite(ir, {
      overlays: [
        visibilityOverlay(),
        tokenOverlay(registry),
        crossCheckOverlay(),
      ],
      baselineStore: {},
      baselineNamespace: "test-namespace",
    });
    const parsed = deserializeSuite(serializeSuite(suite));
    const cov = coverageOf(ir, parsed);

    expect(cov.totalStates).toBe(3);
    expect(cov.totalTransitions).toBe(4);
    expect(cov.transitionsCovered).toBe(4);
    expect(cov.statesCovered).toBe(3);
    expect(cov.reachableStates).toEqual(["a", "b", "c"]);
    expect(cov.unreachableStates).toEqual([]);
  });

  it("emits 4 cases (one per transition), each carrying the expected assertions", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const suite = generateRegressionSuite(ir, {
      overlays: [
        visibilityOverlay(),
        tokenOverlay(registry),
        crossCheckOverlay(),
      ],
      baselineStore: {},
      baselineNamespace: "test-namespace",
    });
    const parsed = deserializeSuite(serializeSuite(suite));

    expect(parsed.cases.length).toBe(4);

    const stateById = new Map(ir.states.map((s) => [s.id, s] as const));
    const transitionById = new Map(
      ir.transitions.map((t) => [t.id, t] as const),
    );

    for (const c of parsed.cases) {
      const transition = transitionById.get(c.transitionId);
      expect(transition).toBeDefined();
      const t = transition!;

      // (a) one state-active(pre) per fromStates entry.
      const preAsserts = c.assertions.filter(
        (a: RegressionAssertion): a is StateActiveAssertion =>
          a.kind === "state-active" && a.phase === "pre",
      );
      expect(preAsserts.length).toBe(t.fromStates.length);
      const preStateIds = preAsserts.map((a) => a.stateId).sort();
      expect(preStateIds).toEqual([...t.fromStates].sort());

      // (b) one state-active(post) per activateStates entry.
      const postAsserts = c.assertions.filter(
        (a: RegressionAssertion): a is StateActiveAssertion =>
          a.kind === "state-active" && a.phase === "post",
      );
      expect(postAsserts.length).toBe(t.activateStates.length);
      const postStateIds = postAsserts.map((a) => a.stateId).sort();
      expect(postStateIds).toEqual([...t.activateStates].sort());

      // (c) one action-target-resolves per action.
      const actionAsserts = c.assertions.filter(
        (a: RegressionAssertion): a is ActionTargetResolvesAssertion =>
          a.kind === "action-target-resolves",
      );
      expect(actionAsserts.length).toBe(t.actions.length);
      expect(actionAsserts.map((a) => a.actionIndex)).toEqual(
        t.actions.map((_, i) => i),
      );

      // (d) one visual-gate per activateStates entry (baselineStore set).
      const visualGates = c.assertions.filter(
        (a: RegressionAssertion): a is VisualGateAssertion =>
          a.kind === "visual-gate",
      );
      expect(visualGates.length).toBe(t.activateStates.length);
      for (const gate of visualGates) {
        expect(gate.baselineKey.startsWith("test-namespace/rt-doc/state-")).toBe(
          true,
        );
      }

      // Overlay assertions:
      const overlayAsserts = c.assertions.filter(
        (a) => a.kind === "overlay",
      );
      const overlayIds = new Set(
        overlayAsserts.map((a) => (a as { overlayId: string }).overlayId),
      );

      // visibility + token: one per (activateState x state.assertions).
      let expectedVisCount = 0;
      for (const sid of t.activateStates) {
        const s = stateById.get(sid);
        expectedVisCount += s?.assertions.length ?? 0;
      }
      const visCount = overlayAsserts.filter(
        (a) => (a as { overlayId: string }).overlayId === "visibility",
      ).length;
      const tokCount = overlayAsserts.filter(
        (a) => (a as { overlayId: string }).overlayId === "token",
      ).length;
      expect(visCount).toBe(expectedVisCount);
      expect(tokCount).toBe(expectedVisCount);

      // cross-check: one per click/type action OR text-bearing target.
      const expectedCrossCheck = t.actions.filter((a) => {
        if (a.type === "click" || a.type === "type") return true;
        const tgt = a.target;
        return Boolean(
          (tgt.text !== undefined && tgt.text !== "") ||
            (tgt.textContains !== undefined && tgt.textContains !== "") ||
            (tgt.ariaLabel !== undefined && tgt.ariaLabel !== "") ||
            (tgt.accessibleName !== undefined && tgt.accessibleName !== ""),
        );
      }).length;
      const crossCount = overlayAsserts.filter(
        (a) => (a as { overlayId: string }).overlayId === "cross-check",
      ).length;
      expect(crossCount).toBe(expectedCrossCheck);

      // Sanity: visibility/token presence tracks `expectedVisCount > 0`;
      // cross-check presence tracks `expectedCrossCheck > 0`. We assert
      // structural consistency rather than "always present" so cases with
      // zero post-state requiredElements (e.g., t-a-to-c into state c)
      // or with only non-text-bearing hover actions don't trip.
      expect(overlayIds.has("visibility")).toBe(expectedVisCount > 0);
      expect(overlayIds.has("token")).toBe(expectedVisCount > 0);
      expect(overlayIds.has("cross-check")).toBe(expectedCrossCheck > 0);
    }

    // Across all 4 cases, each overlay should fire at least somewhere —
    // otherwise the test isn't actually exercising round-trip preservation
    // of overlay assertions.
    const allOverlayIds = new Set<string>();
    for (const c of parsed.cases) {
      for (const a of c.assertions) {
        if (a.kind === "overlay") {
          allOverlayIds.add((a as { overlayId: string }).overlayId);
        }
      }
    }
    expect(allOverlayIds.has("visibility")).toBe(true);
    expect(allOverlayIds.has("token")).toBe(true);
    expect(allOverlayIds.has("cross-check")).toBe(true);
  });

  it("deserializeSuite rejects malformed JSON", () => {
    expect(() => deserializeSuite("not json")).toThrow(/invalid JSON/);
  });

  it("deserializeSuite rejects under-shaped objects (missing required fields)", () => {
    expect(() => deserializeSuite('{"id":"x"}')).toThrow();
  });
});
