/**
 * Unit tests for the IR-vs-runtime drift comparator.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";

import type {
  IRDocument,
  IRState,
  IRTransition,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  compareSpecToRuntime,
  type DriftReport,
  type RuntimeSnapshot,
} from "../drift";
import { makeTestAssertion } from "../../__tests__/test-helpers";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeState(id: string, overrides: Partial<IRState> = {}): IRState {
  return {
    id,
    name: id,
    assertions: [],
    ...overrides,
  };
}

function makeTransition(
  id: string,
  overrides: Partial<IRTransition> = {},
): IRTransition {
  return {
    id,
    name: id,
    fromStates: [],
    activateStates: [],
    actions: [],
    ...overrides,
  };
}

function makeDoc(
  states: IRState[] = [],
  transitions: IRTransition[] = [],
): IRDocument {
  return {
    version: "1.0",
    id: "test-doc",
    name: "Test Doc",
    states,
    transitions,
  };
}

const EMPTY_RUNTIME: RuntimeSnapshot = { states: [], transitions: [] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compareSpecToRuntime", () => {
  it("returns an empty report when both IR and runtime are empty", () => {
    const report = compareSpecToRuntime(makeDoc(), EMPTY_RUNTIME);
    expect(report).toEqual<DriftReport>({ states: [], transitions: [] });
  });

  it("flags missing-in-runtime when IR has a state not present at runtime", () => {
    const doc = makeDoc([makeState("login")]);
    const report = compareSpecToRuntime(doc, EMPTY_RUNTIME);
    expect(report.transitions).toEqual([]);
    expect(report.states).toEqual([
      {
        id: "login",
        kind: "missing-in-runtime",
        detail: "state login: declared in IR, not present in runtime registry",
      },
    ]);
  });

  it("flags missing-in-ir when runtime has a state not declared in IR", () => {
    const runtime: RuntimeSnapshot = {
      states: [{ id: "rogue" }],
      transitions: [],
    };
    const report = compareSpecToRuntime(makeDoc(), runtime);
    expect(report.transitions).toEqual([]);
    expect(report.states).toEqual([
      {
        id: "rogue",
        kind: "missing-in-ir",
        detail: "state rogue: registered at runtime, not declared in IR",
      },
    ]);
  });

  it("flags shape-mismatch when state requiredElements length differs", () => {
    const doc = makeDoc([
      makeState("settings", {
        assertions: [
          makeTestAssertion("settings", 0, { role: "heading", text: "Settings" }),
          makeTestAssertion("settings", 1, { role: "button", text: "Save" }),
        ],
      }),
    ]);
    const runtime: RuntimeSnapshot = {
      states: [{ id: "settings", requiredElements: [{ role: "heading" }] }],
      transitions: [],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.transitions).toEqual([]);
    expect(report.states).toEqual([
      {
        id: "settings",
        kind: "shape-mismatch",
        detail: "state settings: requiredElements length differs — IR=2 runtime=1",
      },
    ]);
  });

  it("does not raise a state shape-mismatch when the runtime omits requiredElements", () => {
    const doc = makeDoc([
      makeState("a", {
        assertions: [
          makeTestAssertion("a", 0, { role: "heading" }),
          makeTestAssertion("a", 1, { role: "button" }),
        ],
      }),
    ]);
    const runtime: RuntimeSnapshot = {
      states: [{ id: "a" }], // requiredElements undefined -> skip
      transitions: [],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.states).toEqual([]);
    expect(report.transitions).toEqual([]);
  });

  it("flags shape-mismatch when transition activateStates differ", () => {
    const doc = makeDoc(
      [],
      [
        makeTransition("open-login", {
          fromStates: ["dashboard"],
          activateStates: ["login", "modal"],
          exitStates: ["dashboard"],
        }),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [],
      transitions: [
        {
          id: "open-login",
          fromStates: ["dashboard"],
          activateStates: ["login"], // missing "modal"
          exitStates: ["dashboard"],
        },
      ],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.states).toEqual([]);
    expect(report.transitions).toEqual([
      {
        id: "open-login",
        kind: "shape-mismatch",
        detail:
          "transition open-login: activateStates differ — IR=[login,modal] runtime=[login]",
      },
    ]);
  });

  it("compares activateStates as sorted arrays (order-insensitive)", () => {
    const doc = makeDoc(
      [],
      [
        makeTransition("t1", {
          fromStates: ["a"],
          activateStates: ["b", "a"], // differs from runtime by order only
          exitStates: [],
        }),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [],
      transitions: [
        {
          id: "t1",
          fromStates: ["a"],
          activateStates: ["a", "b"],
          exitStates: [],
        },
      ],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.transitions).toEqual([]);
    expect(report.states).toEqual([]);
  });

  it("emits one DriftEntry per mismatched transition field", () => {
    const doc = makeDoc(
      [],
      [
        makeTransition("multi", {
          fromStates: ["x"],
          activateStates: ["y"],
          exitStates: ["z"],
        }),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [],
      transitions: [
        {
          id: "multi",
          fromStates: ["x", "x2"], // differs
          activateStates: ["y2"], // differs
          exitStates: ["z"], // same
        },
      ],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.states).toEqual([]);
    // Two entries: fromStates + activateStates. exitStates matches.
    expect(report.transitions).toHaveLength(2);
    const fields = report.transitions.map((d) => d.detail);
    expect(fields.some((d) => d.includes("fromStates differ"))).toBe(true);
    expect(fields.some((d) => d.includes("activateStates differ"))).toBe(true);
    expect(fields.some((d) => d.includes("exitStates differ"))).toBe(false);
  });

  it("treats IR exitStates omission as [] when comparing to runtime exitStates", () => {
    const doc = makeDoc(
      [],
      [
        makeTransition("t1", {
          fromStates: ["a"],
          activateStates: ["b"],
          // exitStates omitted in IR — adapter would default to []
        }),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [],
      transitions: [
        {
          id: "t1",
          fromStates: ["a"],
          activateStates: ["b"],
          exitStates: [],
        },
      ],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.transitions).toEqual([]);
  });

  it("does not raise transition shape-mismatch when runtime omits the field entirely", () => {
    const doc = makeDoc(
      [],
      [
        makeTransition("t1", {
          fromStates: ["a"],
          activateStates: ["b"],
          exitStates: ["c"],
        }),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [],
      transitions: [
        {
          id: "t1",
          // every field omitted — should produce no shape-mismatch entries
        },
      ],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.transitions).toEqual([]);
  });

  it("sorts entries by id then kind for determinism", () => {
    const doc = makeDoc(
      [makeState("z-extra"), makeState("a-shared")],
      [makeTransition("t-extra")],
    );
    const runtime: RuntimeSnapshot = {
      states: [{ id: "a-shared" }, { id: "b-runtime-only" }],
      transitions: [{ id: "t-rt-only" }],
    };
    const report = compareSpecToRuntime(doc, runtime);
    expect(report.states.map((d) => d.id)).toEqual([
      "b-runtime-only",
      "z-extra",
    ]);
    expect(report.transitions.map((d) => d.id)).toEqual([
      "t-extra",
      "t-rt-only",
    ]);
  });

  it("produces deep-equal output for the same input on repeated calls", () => {
    const doc = makeDoc(
      [
        makeState("a"),
        makeState("b", {
          assertions: [
            makeTestAssertion("b", 0, { role: "x" }),
            makeTestAssertion("b", 1, { role: "y" }),
          ],
        }),
      ],
      [
        makeTransition("t1", {
          fromStates: ["a"],
          activateStates: ["b"],
          exitStates: ["a"],
        }),
        makeTransition("t-orphan"),
      ],
    );
    const runtime: RuntimeSnapshot = {
      states: [
        { id: "b", requiredElements: [{ role: "x" }] },
        { id: "c-runtime" },
      ],
      transitions: [
        {
          id: "t1",
          fromStates: ["a"],
          activateStates: ["different"],
          exitStates: ["a"],
        },
        { id: "t-rt" },
      ],
    };

    const r1 = compareSpecToRuntime(doc, runtime);
    const r2 = compareSpecToRuntime(doc, runtime);
    expect(r1).toEqual(r2);
    // Stronger check — identical serialization preserves array order.
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
