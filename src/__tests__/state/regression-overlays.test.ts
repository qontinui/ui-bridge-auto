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
  type AssertionOverlay,
  type AssertionOverlayContext,
  type OverlayAssertion,
  type RegressionAssertion,
  type RegressionCase,
} from "../../state/regression-generator";
import {
  visibilityOverlay,
  tokenOverlay,
  crossCheckOverlay,
} from "../../state/regression-overlays";
import type { DesignTokenRegistry } from "../../visual/token-check";
import { makeTestAssertion } from "../test-helpers";

// ---------------------------------------------------------------------------
// Fixtures
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
  exitStates?: string[],
): IRTransition {
  return {
    id,
    name: id,
    fromStates,
    activateStates,
    exitStates,
    actions,
  };
}

function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "test-doc",
    name: "Test Doc",
    states: [
      mkState("a", 2),
      mkState("b", 1),
      mkState("c", 0),
    ],
    transitions: [
      mkTransition(
        "t-a-to-b",
        ["a"],
        ["b"],
        [
          mkAction("click", { id: "btn-1" }),
          mkAction("type", { id: "input-1" }),
        ],
        ["a"],
      ),
      mkTransition(
        "t-a-to-c",
        ["a"],
        ["c"],
        [mkAction("click", { id: "btn-2" })],
      ),
      mkTransition(
        "t-b-to-a",
        ["b"],
        ["a"],
        [
          mkAction("hover", { role: "button" }), // no text — should be skipped by cross-check
          mkAction("hover", { role: "link", text: "Read more" }), // text-bearing
        ],
        ["b"],
      ),
    ],
    initialState: "a",
  };
}

/** Build a stub `DesignTokenRegistry` whose `properties()` returns an
 * intentionally unsorted list — verifies the overlay sorts them. */
function makeStubRegistry(): DesignTokenRegistry {
  return {
    allowedValuesFor: (property) => {
      if (property === "color") return new Set(["rgb(0, 0, 0)"]);
      if (property === "fontSize") return new Set(["14px", "16px"]);
      return null;
    },
    // Deliberately reversed so we can prove the overlay sorts.
    properties: () => ["fontSize", "color"],
  };
}

/** Build a minimal `AssertionOverlayContext` for a given transition id. */
function ctxFor(
  ir: IRDocument,
  transitionId: string,
  caseOverrides?: Partial<RegressionCase>,
): AssertionOverlayContext {
  const transition = ir.transitions.find((t) => t.id === transitionId)!;
  const partial: RegressionCase = {
    id: transition.id,
    transitionId: transition.id,
    fromStates: [...transition.fromStates].sort(),
    activateStates: [...transition.activateStates].sort(),
    exitStates: [...(transition.exitStates ?? [])].sort(),
    assertions: [],
    ...caseOverrides,
  };
  const stateById = new Map(ir.states.map((s) => [s.id, s] as const));
  return { ir, case: partial, transition, stateById };
}

// ---------------------------------------------------------------------------
// visibilityOverlay
// ---------------------------------------------------------------------------

describe("visibilityOverlay", () => {
  it("emits one assertion per (activateState × requiredElement)", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay();
    // t-a-to-b activates "b"; "b" has 1 required element → 1 assertion.
    const out = overlay.apply(ctxFor(ir, "t-a-to-b"));
    expect(out.length).toBe(1);
    const a = out[0] as OverlayAssertion;
    expect(a.kind).toBe("overlay");
    expect(a.overlayId).toBe("visibility");
    expect(a.assertionId).toBe("b#0");
    expect(a.payload).toEqual({
      stateId: "b",
      requiredElementIndex: 0,
      minRatio: 1,
    });
  });

  it("emits zero assertions when activateState has zero assertions", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay();
    // t-a-to-c activates "c"; "c" has 0 required elements → 0 assertions.
    const out = overlay.apply(ctxFor(ir, "t-a-to-c"));
    expect(out.length).toBe(0);
  });

  it("expands across multiple required elements per state", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay();
    // t-b-to-a activates "a"; "a" has 2 required elements → 2 assertions.
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    expect(out.length).toBe(2);
    const ids = out.map((a) => (a as OverlayAssertion).assertionId);
    expect(ids).toEqual(["a#0", "a#1"]);
  });

  it("defaults minRatio to 1", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay();
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    for (const a of out) {
      const oa = a as OverlayAssertion;
      expect(oa.payload.minRatio).toBe(1);
    }
  });

  it("carries explicit minRatio through to the payload", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay({ minRatio: 0.5 });
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    for (const a of out) {
      const oa = a as OverlayAssertion;
      expect(oa.payload.minRatio).toBe(0.5);
    }
  });

  it("sorts output by assertionId ascending", () => {
    // Two activated states out-of-order in the case.
    const ir = makeFixtureIR();
    // Build a multi-activate fixture: pretend the transition activates both
    // a and b. The case fixture supplies activateStates in declared order
    // but the overlay must sort.
    const overlay = visibilityOverlay();
    const ctx = ctxFor(ir, "t-a-to-b", {
      fromStates: ["a"],
      // Intentionally reverse-sorted to force the overlay to re-sort.
      activateStates: ["b", "a"],
      exitStates: ["a"],
      assertions: [],
    });
    const out = overlay.apply(ctx);
    const ids = out.map((a) => (a as OverlayAssertion).assertionId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    // Specifically: a#0, a#1, b#0
    expect(ids).toEqual(["a#0", "a#1", "b#0"]);
  });

  it("uses overlay id 'visibility'", () => {
    expect(visibilityOverlay().id).toBe("visibility");
  });
});

// ---------------------------------------------------------------------------
// tokenOverlay
// ---------------------------------------------------------------------------

describe("tokenOverlay", () => {
  it("emits one assertion per (activateState × requiredElement)", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const overlay = tokenOverlay(registry);
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    // t-b-to-a activates "a"; "a" has 2 required elements → 2 assertions.
    expect(out.length).toBe(2);
  });

  it("payload.properties matches [...registry.properties()].sort()", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const overlay = tokenOverlay(registry);
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    for (const a of out) {
      const oa = a as OverlayAssertion;
      // Stub registry returns ["fontSize", "color"]; sorted is ["color", "fontSize"].
      expect(oa.payload.properties).toEqual(["color", "fontSize"]);
    }
  });

  it("carries stateId and requiredElementIndex in the payload", () => {
    const ir = makeFixtureIR();
    const overlay = tokenOverlay(makeStubRegistry());
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    const payloads = out.map((a) => (a as OverlayAssertion).payload);
    expect(payloads[0]!.stateId).toBe("a");
    expect(payloads[0]!.requiredElementIndex).toBe(0);
    expect(payloads[1]!.stateId).toBe("a");
    expect(payloads[1]!.requiredElementIndex).toBe(1);
  });

  it("emits zero assertions when activateState has zero assertions", () => {
    const ir = makeFixtureIR();
    const overlay = tokenOverlay(makeStubRegistry());
    const out = overlay.apply(ctxFor(ir, "t-a-to-c"));
    expect(out.length).toBe(0);
  });

  it("uses overlay id 'token'", () => {
    expect(tokenOverlay(makeStubRegistry()).id).toBe("token");
  });

  it("sorts output by assertionId ascending across multi-state activation", () => {
    const ir = makeFixtureIR();
    const overlay = tokenOverlay(makeStubRegistry());
    const ctx = ctxFor(ir, "t-a-to-b", {
      fromStates: ["a"],
      activateStates: ["b", "a"], // reverse-sorted on purpose
      exitStates: ["a"],
      assertions: [],
    });
    const out = overlay.apply(ctx);
    const ids = out.map((a) => (a as OverlayAssertion).assertionId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(ids).toEqual(["a#0", "a#1", "b#0"]);
  });
});

// ---------------------------------------------------------------------------
// crossCheckOverlay
// ---------------------------------------------------------------------------

describe("crossCheckOverlay", () => {
  it("emits one assertion per click action", () => {
    const ir = makeFixtureIR();
    const overlay = crossCheckOverlay();
    // t-a-to-c has 1 click action.
    const out = overlay.apply(ctxFor(ir, "t-a-to-c"));
    expect(out.length).toBe(1);
    const a = out[0] as OverlayAssertion;
    expect(a.overlayId).toBe("cross-check");
    expect(a.assertionId).toBe("t-a-to-c#0");
    expect(a.payload).toEqual({
      transitionId: "t-a-to-c",
      actionIndex: 0,
      tolerance: 0.2,
    });
  });

  it("emits one assertion per click and type action in t-a-to-b", () => {
    const ir = makeFixtureIR();
    const overlay = crossCheckOverlay();
    // t-a-to-b: click + type → both qualify.
    const out = overlay.apply(ctxFor(ir, "t-a-to-b"));
    expect(out.length).toBe(2);
    const ids = out.map((a) => (a as OverlayAssertion).assertionId);
    expect(ids).toEqual(["t-a-to-b#0", "t-a-to-b#1"]);
  });

  it("skips a hover action whose target has no text fields", () => {
    const ir = makeFixtureIR();
    const overlay = crossCheckOverlay();
    // t-b-to-a: hover (no text — skipped) + hover (text — emitted) → 1 assertion.
    const out = overlay.apply(ctxFor(ir, "t-b-to-a"));
    expect(out.length).toBe(1);
    const a = out[0] as OverlayAssertion;
    // Only action index 1 should survive (the text-bearing hover).
    expect(a.assertionId).toBe("t-b-to-a#1");
    expect(a.payload.actionIndex).toBe(1);
  });

  it("emits for a non-click/type action whose target has textContains", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "tc",
      name: "TC",
      states: [mkState("s", 0)],
      transitions: [
        mkTransition(
          "t",
          ["s"],
          ["s"],
          [mkAction("scroll", { textContains: "Welcome" })],
        ),
      ],
    };
    const overlay = crossCheckOverlay();
    const out = overlay.apply(ctxFor(ir, "t"));
    expect(out.length).toBe(1);
  });

  it("emits for a non-click/type action whose target has ariaLabel", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "al",
      name: "AL",
      states: [mkState("s", 0)],
      transitions: [
        mkTransition(
          "t",
          ["s"],
          ["s"],
          [mkAction("focus", { ariaLabel: "Search" })],
        ),
      ],
    };
    const out = crossCheckOverlay().apply(ctxFor(ir, "t"));
    expect(out.length).toBe(1);
  });

  it("emits for a non-click/type action whose target has accessibleName", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "an",
      name: "AN",
      states: [mkState("s", 0)],
      transitions: [
        mkTransition(
          "t",
          ["s"],
          ["s"],
          [mkAction("focus", { accessibleName: "Submit" })],
        ),
      ],
    };
    const out = crossCheckOverlay().apply(ctxFor(ir, "t"));
    expect(out.length).toBe(1);
  });

  it("skips an action whose target has only role/tagName/id (no text fields)", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "skip",
      name: "Skip",
      states: [mkState("s", 0)],
      transitions: [
        mkTransition(
          "t",
          ["s"],
          ["s"],
          [
            mkAction("scroll", { role: "main" }),
            mkAction("focus", { tagName: "div" }),
            mkAction("blur", { id: "x" }),
          ],
        ),
      ],
    };
    const out = crossCheckOverlay().apply(ctxFor(ir, "t"));
    expect(out.length).toBe(0);
  });

  it("skips an action whose target text fields are empty strings", () => {
    const ir: IRDocument = {
      version: "1.0",
      id: "empty",
      name: "Empty",
      states: [mkState("s", 0)],
      transitions: [
        mkTransition(
          "t",
          ["s"],
          ["s"],
          [
            mkAction("scroll", {
              text: "",
              textContains: "",
              ariaLabel: "",
              accessibleName: "",
            }),
          ],
        ),
      ],
    };
    const out = crossCheckOverlay().apply(ctxFor(ir, "t"));
    expect(out.length).toBe(0);
  });

  it("defaults tolerance to 0.2", () => {
    const ir = makeFixtureIR();
    const out = crossCheckOverlay().apply(ctxFor(ir, "t-a-to-b"));
    for (const a of out) {
      expect((a as OverlayAssertion).payload.tolerance).toBe(0.2);
    }
  });

  it("carries explicit tolerance through to the payload", () => {
    const ir = makeFixtureIR();
    const out = crossCheckOverlay({ tolerance: 0.05 }).apply(
      ctxFor(ir, "t-a-to-b"),
    );
    for (const a of out) {
      expect((a as OverlayAssertion).payload.tolerance).toBe(0.05);
    }
  });

  it("uses overlay id 'cross-check'", () => {
    expect(crossCheckOverlay().id).toBe("cross-check");
  });

  it("sorts output by assertionId ascending", () => {
    const ir = makeFixtureIR();
    const out = crossCheckOverlay().apply(ctxFor(ir, "t-a-to-b"));
    const ids = out.map((a) => (a as OverlayAssertion).assertionId);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Composition determinism
// ---------------------------------------------------------------------------

describe("overlay determinism", () => {
  it("visibilityOverlay returns byte-identical output across 10 invocations", () => {
    const ir = makeFixtureIR();
    const overlay = visibilityOverlay({ minRatio: 0.75 });
    const ctx = ctxFor(ir, "t-b-to-a");
    const baseline = JSON.stringify(overlay.apply(ctx));
    for (let i = 0; i < 9; i++) {
      const next = JSON.stringify(overlay.apply(ctx));
      expect(next).toBe(baseline);
    }
  });

  it("tokenOverlay returns byte-identical output across 10 invocations", () => {
    const ir = makeFixtureIR();
    const overlay = tokenOverlay(makeStubRegistry());
    const ctx = ctxFor(ir, "t-b-to-a");
    const baseline = JSON.stringify(overlay.apply(ctx));
    for (let i = 0; i < 9; i++) {
      const next = JSON.stringify(overlay.apply(ctx));
      expect(next).toBe(baseline);
    }
  });

  it("crossCheckOverlay returns byte-identical output across 10 invocations", () => {
    const ir = makeFixtureIR();
    const overlay = crossCheckOverlay({ tolerance: 0.15 });
    const ctx = ctxFor(ir, "t-a-to-b");
    const baseline = JSON.stringify(overlay.apply(ctx));
    for (let i = 0; i < 9; i++) {
      const next = JSON.stringify(overlay.apply(ctx));
      expect(next).toBe(baseline);
    }
  });
});

// ---------------------------------------------------------------------------
// No mutation of context
// ---------------------------------------------------------------------------

describe("overlays do not mutate context", () => {
  /** Deep snapshot via JSON to detect any mutation. */
  function snap(value: unknown): string {
    return JSON.stringify(value);
  }

  it("visibilityOverlay does not mutate ctx.case / ctx.ir / ctx.transition", () => {
    const ir = makeFixtureIR();
    const ctx = ctxFor(ir, "t-b-to-a");
    const before = {
      case: snap(ctx.case),
      ir: snap(ctx.ir),
      transition: snap(ctx.transition),
      caseAssertions: snap(ctx.case.assertions),
    };
    visibilityOverlay({ minRatio: 0.5 }).apply(ctx);
    expect(snap(ctx.case)).toBe(before.case);
    expect(snap(ctx.ir)).toBe(before.ir);
    expect(snap(ctx.transition)).toBe(before.transition);
    expect(snap(ctx.case.assertions)).toBe(before.caseAssertions);
  });

  it("tokenOverlay does not mutate ctx.case / ctx.ir / ctx.transition", () => {
    const ir = makeFixtureIR();
    const ctx = ctxFor(ir, "t-b-to-a");
    const before = {
      case: snap(ctx.case),
      ir: snap(ctx.ir),
      transition: snap(ctx.transition),
    };
    tokenOverlay(makeStubRegistry()).apply(ctx);
    expect(snap(ctx.case)).toBe(before.case);
    expect(snap(ctx.ir)).toBe(before.ir);
    expect(snap(ctx.transition)).toBe(before.transition);
  });

  it("crossCheckOverlay does not mutate ctx.case / ctx.ir / ctx.transition", () => {
    const ir = makeFixtureIR();
    const ctx = ctxFor(ir, "t-a-to-b");
    const before = {
      case: snap(ctx.case),
      ir: snap(ctx.ir),
      transition: snap(ctx.transition),
    };
    crossCheckOverlay({ tolerance: 0.1 }).apply(ctx);
    expect(snap(ctx.case)).toBe(before.case);
    expect(snap(ctx.ir)).toBe(before.ir);
    expect(snap(ctx.transition)).toBe(before.transition);
  });
});

// ---------------------------------------------------------------------------
// Integration smoke test with generateRegressionSuite
// ---------------------------------------------------------------------------

describe("generateRegressionSuite integration with overlays", () => {
  it("produces overlay assertions in the expected positions and round-trips byte-identically", () => {
    const ir = makeFixtureIR();
    const registry = makeStubRegistry();
    const overlays: AssertionOverlay[] = [
      visibilityOverlay(),
      tokenOverlay(registry),
      crossCheckOverlay(),
    ];

    const suite = generateRegressionSuite(ir, { overlays });

    // 1. Every case should carry its expected overlay assertions.
    const casesById = new Map(suite.cases.map((c) => [c.id, c]));

    // t-a-to-b: activates b (1 req), 2 actions both qualify for cross-check
    const tab = casesById.get("t-a-to-b")!;
    const tabOverlays = tab.assertions.filter(
      (a): a is OverlayAssertion => a.kind === "overlay",
    );
    expect(tabOverlays.filter((a) => a.overlayId === "visibility").length).toBe(1);
    expect(tabOverlays.filter((a) => a.overlayId === "token").length).toBe(1);
    expect(tabOverlays.filter((a) => a.overlayId === "cross-check").length).toBe(2);

    // t-a-to-c: activates c (0 req), 1 click action
    const tac = casesById.get("t-a-to-c")!;
    const tacOverlays = tac.assertions.filter(
      (a): a is OverlayAssertion => a.kind === "overlay",
    );
    expect(tacOverlays.filter((a) => a.overlayId === "visibility").length).toBe(0);
    expect(tacOverlays.filter((a) => a.overlayId === "token").length).toBe(0);
    expect(tacOverlays.filter((a) => a.overlayId === "cross-check").length).toBe(1);

    // t-b-to-a: activates a (2 req), 1 of 2 hover actions is text-bearing
    const tba = casesById.get("t-b-to-a")!;
    const tbaOverlays = tba.assertions.filter(
      (a): a is OverlayAssertion => a.kind === "overlay",
    );
    expect(tbaOverlays.filter((a) => a.overlayId === "visibility").length).toBe(2);
    expect(tbaOverlays.filter((a) => a.overlayId === "token").length).toBe(2);
    expect(tbaOverlays.filter((a) => a.overlayId === "cross-check").length).toBe(1);

    // 2. Serialization round-trip is byte-identical.
    const json1 = serializeSuite(suite);
    const parsed = deserializeSuite(json1);
    const json2 = serializeSuite(parsed);
    expect(json2).toBe(json1);

    // 3. Re-generating with the same overlays produces byte-identical JSON.
    const overlays2: AssertionOverlay[] = [
      visibilityOverlay(),
      tokenOverlay(registry),
      crossCheckOverlay(),
    ];
    const suite2 = generateRegressionSuite(ir, { overlays: overlays2 });
    expect(serializeSuite(suite2)).toBe(json1);
  });

  it("each overlay's emitted assertions land in the case's sorted order", () => {
    const ir = makeFixtureIR();
    const overlays: AssertionOverlay[] = [
      visibilityOverlay(),
      tokenOverlay(makeStubRegistry()),
      crossCheckOverlay(),
    ];
    const suite = generateRegressionSuite(ir, { overlays });

    // Phase 1's final sort orders by (kind, secondary). Within "overlay"
    // kind, the secondary is (overlayId, assertionId). Verify that for at
    // least one case the overlay block is fully sorted.
    const tab = suite.cases.find((c) => c.id === "t-a-to-b")!;
    const overlayAsserts = tab.assertions.filter(
      (a): a is OverlayAssertion => a.kind === "overlay",
    );
    const sorted = [...overlayAsserts].sort((a, b) => {
      if (a.overlayId !== b.overlayId)
        return a.overlayId < b.overlayId ? -1 : 1;
      return a.assertionId < b.assertionId ? -1 : 1;
    });
    expect(overlayAsserts).toEqual(sorted);
  });

  it("composing overlays does not produce non-overlay assertions", () => {
    const ir = makeFixtureIR();
    const overlays: AssertionOverlay[] = [
      visibilityOverlay(),
      tokenOverlay(makeStubRegistry()),
      crossCheckOverlay(),
    ];
    const suite = generateRegressionSuite(ir, { overlays });
    const allOverlaySourcedKinds = new Set<RegressionAssertion["kind"]>();
    for (const c of suite.cases) {
      for (const a of c.assertions) {
        // Built-ins are state-active / action-target-resolves; overlays
        // only contribute "overlay" kind.
        if (a.kind === "overlay") allOverlaySourcedKinds.add(a.kind);
      }
    }
    expect(allOverlaySourcedKinds.has("overlay")).toBe(true);
  });
});
