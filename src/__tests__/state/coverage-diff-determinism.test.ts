/**
 * Determinism gate for `coverageDiff` (Section 11, Phase C1).
 *
 * Same `(suite, log)` input run 10x must produce byte-identical canonical-JSON
 * output. If this test ever fails, the diff has acquired a non-determinism
 * leak — Map iteration order escaping into output, an unstable sort, etc.
 * Fix the leak. Do NOT relax this test.
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
  type RegressionAssertion,
  type RegressionSuite,
} from "../../state/regression-generator";
import {
  coverageDiff,
  type AssertionExecution,
} from "../../state/coverage-diff";
import { canonicalJSON } from "../../state/canonical-json";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RUNS = 10;
const FIXED_TS = "2026-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixture builders (rebuilt fresh on every call)
// ---------------------------------------------------------------------------

function mkState(id: string, requiredCount: number): IRState {
  const requiredElements = [];
  for (let i = 0; i < requiredCount; i++) {
    requiredElements.push({ id: `${id}-el-${i}` });
  }
  return { id, name: id, requiredElements };
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

function makeFixtureIR(): IRDocument {
  return {
    version: "1.0",
    id: "doc",
    name: "Doc",
    states: [mkState("a", 2), mkState("b", 1), mkState("c", 1)],
    transitions: [
      mkTransition(
        "t-a-to-b",
        ["a"],
        ["b"],
        [mkAction("click", { id: "btn-1" })],
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [
          mkAction("click", { id: "btn-2" }),
          mkAction("type", { id: "input-2" }),
        ],
      ),
      mkTransition(
        "t-c-to-a",
        ["c"],
        ["a"],
        [mkAction("click", { id: "btn-3" })],
      ),
    ],
  };
}

function makeFixtureSuite(): RegressionSuite {
  return generateRegressionSuite(makeFixtureIR());
}

function idOf(a: RegressionAssertion): string {
  switch (a.kind) {
    case "state-active":
      return `state-active:${a.phase}:${a.stateId}`;
    case "action-target-resolves":
      return `action-target-resolves:${a.transitionId}#${a.actionIndex}`;
    case "visual-gate":
      return `visual-gate:${a.stateId}`;
    case "overlay":
      return a.assertionId;
  }
}

/**
 * Build a partially-covering log — every other assertion of every case
 * executes. Authored deliberately out-of-order (across cases + within case)
 * to exercise the diff's internal sort.
 */
function buildPartialLog(): AssertionExecution[] {
  const suite = makeFixtureSuite();
  const log: AssertionExecution[] = [];
  for (const c of [...suite.cases].reverse()) {
    for (let i = c.assertions.length - 1; i >= 0; i--) {
      if (i % 2 === 0) {
        log.push({
          caseId: c.id,
          assertionId: idOf(c.assertions[i]!),
          executedAt: FIXED_TS,
        });
      }
    }
  }
  return log;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coverageDiff — determinism gate", () => {
  it("produces byte-identical report across 10 runs (empty log)", () => {
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const report = coverageDiff(makeFixtureSuite(), []);
      serialized.push(canonicalJSON(report));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical report across 10 runs (partial log)", () => {
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const report = coverageDiff(makeFixtureSuite(), buildPartialLog());
      serialized.push(canonicalJSON(report));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output regardless of log entry order", () => {
    const baseline = canonicalJSON(
      coverageDiff(makeFixtureSuite(), buildPartialLog()),
    );
    const reshuffled = canonicalJSON(
      coverageDiff(makeFixtureSuite(), buildPartialLog().reverse()),
    );
    expect(reshuffled).toBe(baseline);
  });

  it("produces byte-identical report across 10 runs (full log)", () => {
    const buildFullLog = (): AssertionExecution[] => {
      const suite = makeFixtureSuite();
      const log: AssertionExecution[] = [];
      for (const c of suite.cases) {
        for (const a of c.assertions) {
          log.push({
            caseId: c.id,
            assertionId: idOf(a),
            executedAt: FIXED_TS,
          });
        }
      }
      return log;
    };
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const report = coverageDiff(makeFixtureSuite(), buildFullLog());
      serialized.push(canonicalJSON(report));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });
});
