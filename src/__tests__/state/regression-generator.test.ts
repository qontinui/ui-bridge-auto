import { describe, it, expect } from "vitest";
import type {
  IRDocument,
  IRState,
  IRTransition,
} from "@qontinui/shared-types/ui-bridge-ir";
import {
  generateRegressionSuite,
  serializeSuite,
  deserializeSuite,
  coverageOf,
  deriveBaselineKey,
  type RegressionSuite,
  type RegressionAssertion,
  type StateActiveAssertion,
  type ActionTargetResolvesAssertion,
  type VisualGateAssertion,
  type AssertionOverlay,
  type GeneratorOptions,
} from "../../state/regression-generator";
import { makeTestAssertion } from "../test-helpers";

// ---------------------------------------------------------------------------
// Fixtures — small IR with 3 states + 4 transitions, intentionally authored
// out-of-id-order to exercise the determinism contract.
// ---------------------------------------------------------------------------

function mkState(id: string, requiredCount: number, name = id): IRState {
  const assertions = [];
  for (let i = 0; i < requiredCount; i++) {
    assertions.push(makeTestAssertion(id, i, { id: `${id}-el-${i}` }));
  }
  return { id, name, assertions };
}

function mkTransition(
  id: string,
  fromStates: string[],
  activateStates: string[],
  options?: { exitStates?: string[]; actions?: number },
): IRTransition {
  const actionCount = options?.actions ?? 1;
  const actions = [];
  for (let i = 0; i < actionCount; i++) {
    actions.push({
      type: "click",
      target: { id: `${id}-target-${i}` },
    });
  }
  return {
    id,
    name: id,
    fromStates,
    activateStates,
    exitStates: options?.exitStates,
    actions,
  };
}

function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "test-doc",
    name: "Test Doc",
    // Authored out of order to verify the generator sorts by id.
    states: [
      mkState("c", 0),
      mkState("a", 2),
      mkState("b", 1),
    ],
    transitions: [
      // Out of id-order on purpose:
      mkTransition("t-b-to-c", ["b"], ["c"], { exitStates: ["b"] }),
      mkTransition("t-a-to-b", ["a"], ["b"], { exitStates: ["a"], actions: 2 }),
      mkTransition("t-c-to-a", ["c"], ["a"], { exitStates: ["c"] }),
      mkTransition("t-a-to-c", ["a"], ["c"]), // no exitStates field
    ],
    initialState: "a",
  };
}

// ---------------------------------------------------------------------------
// Case assembly
// ---------------------------------------------------------------------------

describe("generateRegressionSuite — case assembly", () => {
  it("emits exactly one case per transition", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    expect(suite.cases.length).toBe(ir.transitions.length);
  });

  it("uses the transition id as the case id", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    for (const c of suite.cases) {
      expect(c.id).toBe(c.transitionId);
    }
  });

  it("emits a state-active(pre) assertion per fromState with all required-element indices", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const tab = suite.cases.find((c) => c.id === "t-a-to-b")!;
    const pre = tab.assertions.filter(
      (a): a is StateActiveAssertion =>
        a.kind === "state-active" && a.phase === "pre",
    );
    expect(pre.length).toBe(1);
    expect(pre[0]!.stateId).toBe("a");
    // state "a" was authored with 2 required elements
    expect(pre[0]!.requiredElementIds).toEqual([0, 1]);
  });

  it("emits a state-active(post) assertion per activateState", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const tac = suite.cases.find((c) => c.id === "t-a-to-c")!;
    const post = tac.assertions.filter(
      (a): a is StateActiveAssertion =>
        a.kind === "state-active" && a.phase === "post",
    );
    expect(post.length).toBe(1);
    expect(post[0]!.stateId).toBe("c");
    expect(post[0]!.requiredElementIds).toEqual([]); // c has 0 required elements
  });

  it("emits one action-target-resolves assertion per action with cloned criteria", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const tab = suite.cases.find((c) => c.id === "t-a-to-b")!;
    const actAsserts = tab.assertions.filter(
      (a): a is ActionTargetResolvesAssertion =>
        a.kind === "action-target-resolves",
    );
    // t-a-to-b had 2 actions
    expect(actAsserts.length).toBe(2);
    expect(actAsserts.map((a) => a.actionIndex)).toEqual([0, 1]);
    expect(actAsserts[0]!.targetCriteria).toEqual({ id: "t-a-to-b-target-0" });
    expect(actAsserts[1]!.targetCriteria).toEqual({ id: "t-a-to-b-target-1" });
  });

  it("does NOT emit visual-gate assertions when baselineStore is absent", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    for (const c of suite.cases) {
      const visualGates = c.assertions.filter((a) => a.kind === "visual-gate");
      expect(visualGates.length).toBe(0);
    }
  });

  it("emits a visual-gate per activateState when baselineStore is provided", () => {
    const ir = makeFixtureIR();
    const opts: GeneratorOptions = { baselineStore: {} };
    const suite = generateRegressionSuite(ir, opts);
    const tab = suite.cases.find((c) => c.id === "t-a-to-b")!;
    const gates = tab.assertions.filter(
      (a): a is VisualGateAssertion => a.kind === "visual-gate",
    );
    // t-a-to-b activates only "b"
    expect(gates.length).toBe(1);
    expect(gates[0]!.stateId).toBe("b");
    expect(gates[0]!.baselineKey).toBe("test-doc/state-b");
  });

  it("normalizes missing exitStates to []", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const tac = suite.cases.find((c) => c.id === "t-a-to-c")!;
    expect(tac.exitStates).toEqual([]);
  });

  it("does not mutate the caller-supplied IR's transition arrays", () => {
    const ir = makeFixtureIR();
    const originalIds = ir.transitions.map((t) => t.id);
    generateRegressionSuite(ir);
    const afterIds = ir.transitions.map((t) => t.id);
    expect(afterIds).toEqual(originalIds);
  });

  it("invokes overlays in supplied order with the case under construction", () => {
    const calls: string[] = [];
    const overlayA: AssertionOverlay = {
      id: "alpha",
      apply(ctx) {
        calls.push(`alpha:${ctx.case.id}`);
        return [
          {
            kind: "overlay",
            overlayId: "alpha",
            assertionId: `assert-${ctx.case.id}`,
            payload: {},
          },
        ];
      },
    };
    const overlayB: AssertionOverlay = {
      id: "beta",
      apply(ctx) {
        calls.push(`beta:${ctx.case.id}`);
        return [];
      },
    };
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir, { overlays: [overlayA, overlayB] });
    // For each case, alpha should fire before beta. With 4 transitions = 8 calls.
    expect(calls.length).toBe(8);
    for (let i = 0; i < calls.length; i += 2) {
      expect(calls[i]!.startsWith("alpha:")).toBe(true);
      expect(calls[i + 1]!.startsWith("beta:")).toBe(true);
    }
    // And every case should have an overlay assertion attached.
    for (const c of suite.cases) {
      const overlayAsserts = c.assertions.filter((a) => a.kind === "overlay");
      expect(overlayAsserts.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Baseline-key derivation
// ---------------------------------------------------------------------------

describe("deriveBaselineKey", () => {
  it("produces `${doc.id}/state-${stateId}` without a namespace", () => {
    const ir = makeFixtureIR();
    expect(deriveBaselineKey(ir, "a")).toBe("test-doc/state-a");
  });

  it("prefixes with namespace when provided", () => {
    const ir = makeFixtureIR();
    expect(deriveBaselineKey(ir, "a", "abc123")).toBe("abc123/test-doc/state-a");
  });

  it("treats empty-string namespace as absent (no leading slash)", () => {
    const ir = makeFixtureIR();
    expect(deriveBaselineKey(ir, "a", "")).toBe("test-doc/state-a");
  });

  it("does not encode IRDocument.version into the key", () => {
    const ir = makeFixtureIR();
    const key = deriveBaselineKey(ir, "a");
    expect(key).not.toContain("1.0");
    expect(key).not.toContain(ir.version);
  });
});

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe("serializeSuite / deserializeSuite", () => {
  it("round-trips byte-identically", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir, {
      baselineStore: {},
      baselineNamespace: "abc",
    });
    const json1 = serializeSuite(suite);
    const parsed = deserializeSuite(json1);
    const json2 = serializeSuite(parsed);
    expect(json2).toBe(json1);
  });

  it("preserves structural equality of the parsed result", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const parsed = deserializeSuite(serializeSuite(suite));
    expect(parsed).toEqual(suite);
  });

  it("emits sorted top-level object keys (cases, id, ir)", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const json = serializeSuite(suite);
    const idxCases = json.indexOf('"cases"');
    const idxId = json.indexOf('"id"');
    const idxIr = json.indexOf('"ir"');
    // Alphabetical order: cases < id < ir
    expect(idxCases).toBeGreaterThanOrEqual(0);
    expect(idxId).toBeGreaterThan(idxCases);
    expect(idxIr).toBeGreaterThan(idxId);
  });

  it("rejects malformed JSON with a clear error", () => {
    expect(() => deserializeSuite("not json")).toThrow(/invalid JSON/);
  });

  it("rejects a top-level array", () => {
    expect(() => deserializeSuite("[]")).toThrow(/expected a JSON object/);
  });

  it("rejects missing id", () => {
    expect(() =>
      deserializeSuite(JSON.stringify({ ir: { id: "x", version: "1.0" }, cases: [] })),
    ).toThrow(/`id`/);
  });

  it("rejects missing ir.id", () => {
    expect(() =>
      deserializeSuite(
        JSON.stringify({ id: "x@suite", ir: { version: "1.0" }, cases: [] }),
      ),
    ).toThrow(/`ir.id`/);
  });

  it("rejects unsupported ir.version", () => {
    expect(() =>
      deserializeSuite(
        JSON.stringify({
          id: "x@suite",
          ir: { id: "x", version: "2.0" },
          cases: [],
        }),
      ),
    ).toThrow(/ir\.version/);
  });

  it("rejects non-array cases", () => {
    expect(() =>
      deserializeSuite(
        JSON.stringify({
          id: "x@suite",
          ir: { id: "x", version: "1.0" },
          cases: {},
        }),
      ),
    ).toThrow(/`cases`/);
  });

  it("repeated calls produce byte-identical output", () => {
    const ir = makeFixtureIR();
    const opts: GeneratorOptions = { baselineStore: {} };
    const json1 = serializeSuite(generateRegressionSuite(ir, opts));
    const json2 = serializeSuite(generateRegressionSuite(ir, opts));
    expect(json1).toBe(json2);
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("coverageOf", () => {
  it("reports total counts directly from the IR", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const cov = coverageOf(ir, suite);
    expect(cov.totalStates).toBe(3);
    expect(cov.totalTransitions).toBe(4);
  });

  it("counts transitionsCovered as case count", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const cov = coverageOf(ir, suite);
    expect(cov.transitionsCovered).toBe(suite.cases.length);
  });

  it("counts states touched by from/activate/exit across cases", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const cov = coverageOf(ir, suite);
    // Fixture transitions touch a, b, c collectively.
    expect(cov.statesCovered).toBe(3);
  });

  it("computes reachability from initialState when present", () => {
    const ir = makeFixtureIR(); // initialState = "a"
    const suite = generateRegressionSuite(ir);
    const cov = coverageOf(ir, suite);
    // From a: t-a-to-b → b, t-a-to-c → c. All reachable.
    expect(cov.reachableStates).toEqual(["a", "b", "c"]);
    expect(cov.unreachableStates).toEqual([]);
  });

  it("falls back to per-state seeds when initialState is absent", () => {
    const ir = makeFixtureIR();
    const noInitial: IRDocument = { ...ir };
    delete noInitial.initialState;
    const suite = generateRegressionSuite(noInitial);
    const cov = coverageOf(noInitial, suite);
    expect(cov.reachableStates).toEqual(["a", "b", "c"]);
  });

  it("flags unreachable states", () => {
    // Add an isolated state "z" with no incoming transitions, initialState=a.
    const ir = makeFixtureIR();
    const isolated: IRDocument = {
      ...ir,
      states: [...ir.states, mkState("z", 0)],
    };
    const suite = generateRegressionSuite(isolated);
    const cov = coverageOf(isolated, suite);
    expect(cov.unreachableStates).toEqual(["z"]);
    expect(cov.reachableStates).toEqual(["a", "b", "c"]);
  });

  it("returns reachableStates and unreachableStates sorted ascending", () => {
    const ir = makeFixtureIR();
    const isolated: IRDocument = {
      ...ir,
      states: [
        ...ir.states,
        mkState("zeta", 0),
        mkState("alpha-island", 0),
      ],
    };
    const suite = generateRegressionSuite(isolated);
    const cov = coverageOf(isolated, suite);
    const sortedReach = [...cov.reachableStates].sort();
    const sortedUnreach = [...cov.unreachableStates].sort();
    expect(cov.reachableStates).toEqual(sortedReach);
    expect(cov.unreachableStates).toEqual(sortedUnreach);
  });
});

// ---------------------------------------------------------------------------
// Sort determinism
// ---------------------------------------------------------------------------

describe("generateRegressionSuite — sort determinism", () => {
  it("sorts cases by id ascending regardless of IR transition order", () => {
    const ir = makeFixtureIR();
    const suite = generateRegressionSuite(ir);
    const ids = suite.cases.map((c) => c.id);
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    expect(ids).toEqual(["t-a-to-b", "t-a-to-c", "t-b-to-c", "t-c-to-a"]);
  });

  it("sorts case fromStates / activateStates / exitStates ascending", () => {
    // Build a transition with deliberately out-of-order multi-state arrays.
    const ir: IRDocument = {
      version: "1.0",
      id: "multi",
      name: "Multi",
      states: [mkState("x", 0), mkState("y", 0), mkState("z", 0), mkState("w", 0)],
      transitions: [
        {
          id: "multi-t",
          name: "multi-t",
          fromStates: ["z", "x", "y"],
          activateStates: ["w", "x"],
          exitStates: ["z", "y"],
          actions: [{ type: "click", target: { id: "btn" } }],
        },
      ],
    };
    const suite = generateRegressionSuite(ir);
    const c = suite.cases[0]!;
    expect(c.fromStates).toEqual(["x", "y", "z"]);
    expect(c.activateStates).toEqual(["w", "x"]);
    expect(c.exitStates).toEqual(["y", "z"]);
  });

  it("sorts assertions by (kind, secondary) within each case", () => {
    const ir = makeFixtureIR();
    const opts: GeneratorOptions = { baselineStore: {} };
    const suite = generateRegressionSuite(ir, opts);
    for (const c of suite.cases) {
      const kinds = c.assertions.map((a) => a.kind);
      const sorted = [...kinds].sort();
      expect(kinds).toEqual(sorted);

      // Within state-active, pre comes before post; within action-target,
      // actionIndex is ascending.
      const stateActive = c.assertions.filter(
        (a): a is StateActiveAssertion => a.kind === "state-active",
      );
      const phases = stateActive.map((a) => a.phase);
      const sortedPhases = [...phases].sort();
      expect(phases).toEqual(sortedPhases);

      const actionAsserts = c.assertions.filter(
        (a): a is ActionTargetResolvesAssertion =>
          a.kind === "action-target-resolves",
      );
      const indices = actionAsserts.map((a) => a.actionIndex);
      const sortedIndices = [...indices].sort((a, b) => a - b);
      expect(indices).toEqual(sortedIndices);
    }
  });

  it("produces byte-identical JSON across 10 back-to-back runs", () => {
    const ir = makeFixtureIR();
    const opts: GeneratorOptions = {
      baselineStore: {},
      baselineNamespace: "ns",
      overlays: [
        {
          id: "noop",
          apply(): RegressionAssertion[] {
            return [];
          },
        },
      ],
    };
    const baseline = serializeSuite(generateRegressionSuite(ir, opts));
    for (let i = 0; i < 9; i++) {
      const next = serializeSuite(generateRegressionSuite(ir, opts));
      expect(next).toBe(baseline);
    }
  });

  it("yields the same suite structure when input transitions are reordered", () => {
    const ir1 = makeFixtureIR();
    const ir2: IRDocument = {
      ...ir1,
      transitions: [...ir1.transitions].reverse(),
      states: [...ir1.states].reverse(),
    };
    const s1: RegressionSuite = generateRegressionSuite(ir1);
    const s2: RegressionSuite = generateRegressionSuite(ir2);
    expect(serializeSuite(s1)).toBe(serializeSuite(s2));
  });
});
