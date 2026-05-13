/**
 * Unit coverage for the coverage-diff (Section 11, Phase C1).
 *
 * Covers:
 *   - Empty log → every assertion unexercised, every transition uncovered.
 *   - Full log → empty `unexercisedAssertions`, empty `uncoveredTransitions`.
 *   - Partial log → only un-executed assertions / wholly-untouched transitions
 *     surface; partially-touched cases do NOT appear in `uncoveredTransitions`.
 *   - Stats math (totals, ratio) for the standard fixtures + empty edge case.
 *   - Sort discipline on both arrays.
 *   - Pure-input contract — caller arrays never mutated.
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
  type RegressionSuite,
} from "../../state/regression-generator";
import {
  coverageDiff,
  type AssertionExecution,
} from "../../state/coverage-diff";
import { makeTestAssertion } from "../test-helpers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkState(id: string, requiredCount: number): IRState {
  const assertions = [];
  for (let i = 0; i < requiredCount; i++) {
    assertions.push(makeTestAssertion(id, i, { id: `${id}-el-${i}` }));
  }
  return { id, name: id, assertions };
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
        [mkAction("click", { id: "btn-go" })],
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [mkAction("click", { id: "btn-next" })],
      ),
    ],
  };
}

function makeFixtureSuite(): RegressionSuite {
  return generateRegressionSuite(makeFixtureIR());
}

const FIXED_TS = "2026-01-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("coverageDiff", () => {
  it("with an empty log, marks every assertion as unexercised + every case as uncovered", () => {
    const suite = makeFixtureSuite();
    const report = coverageDiff(suite, []);

    expect(report.stats.exercisedAssertions).toBe(0);
    expect(report.stats.coveredTransitions).toBe(0);

    // Every case in the fixture suite has at least one assertion, so every
    // case appears in uncoveredTransitions.
    expect(report.uncoveredTransitions.map((t) => t.caseId).sort()).toEqual([
      "t-a-to-b",
      "t-b-to-c",
    ]);

    // Every assertion is unexercised.
    expect(report.unexercisedAssertions.length).toBe(report.stats.totalAssertions);
  });

  it("with a fully-covering log, returns empty unexercised + uncovered arrays", () => {
    const suite = makeFixtureSuite();
    const log: AssertionExecution[] = [];
    for (const c of suite.cases) {
      for (const a of c.assertions) {
        const id = idOf(a);
        log.push({ caseId: c.id, assertionId: id, executedAt: FIXED_TS });
      }
    }
    const report = coverageDiff(suite, log);
    expect(report.unexercisedAssertions).toEqual([]);
    expect(report.uncoveredTransitions).toEqual([]);
    expect(report.stats.uncoveredRatio).toBe(0);
    expect(report.stats.exercisedAssertions).toBe(report.stats.totalAssertions);
    expect(report.stats.coveredTransitions).toBe(report.stats.totalTransitions);
  });

  it("a case with at least one executed assertion is NOT marked uncovered", () => {
    const suite = makeFixtureSuite();
    const firstCase = suite.cases[0]!;
    const firstAssertionId = idOf(firstCase.assertions[0]!);
    const log: AssertionExecution[] = [
      {
        caseId: firstCase.id,
        assertionId: firstAssertionId,
        executedAt: FIXED_TS,
      },
    ];
    const report = coverageDiff(suite, log);
    expect(
      report.uncoveredTransitions.find((t) => t.caseId === firstCase.id),
    ).toBeUndefined();
    // Other cases are still uncovered.
    const otherCaseIds = suite.cases.slice(1).map((c) => c.id);
    expect(report.uncoveredTransitions.map((t) => t.caseId).sort()).toEqual(
      otherCaseIds.sort(),
    );
  });

  it("only the un-executed assertions surface in unexercisedAssertions for partially-covered cases", () => {
    const suite = makeFixtureSuite();
    const firstCase = suite.cases[0]!;
    const firstAssertion = firstCase.assertions[0]!;
    const log: AssertionExecution[] = [
      {
        caseId: firstCase.id,
        assertionId: idOf(firstAssertion),
        executedAt: FIXED_TS,
      },
    ];
    const report = coverageDiff(suite, log);
    // The executed assertion must NOT appear; the others in that case MUST.
    const fromFirstCase = report.unexercisedAssertions.filter(
      (r) => r.caseId === firstCase.id,
    );
    const expectedRemaining = firstCase.assertions
      .slice(1)
      .map((a) => idOf(a))
      .sort();
    expect(fromFirstCase.map((r) => r.assertionId).sort()).toEqual(
      expectedRemaining,
    );
  });

  it("computes stats correctly for a mid-coverage log", () => {
    const suite = makeFixtureSuite();
    // Execute every assertion of the first case only.
    const firstCase = suite.cases[0]!;
    const log: AssertionExecution[] = firstCase.assertions.map((a) => ({
      caseId: firstCase.id,
      assertionId: idOf(a),
      executedAt: FIXED_TS,
    }));
    const report = coverageDiff(suite, log);
    expect(report.stats.exercisedAssertions).toBe(firstCase.assertions.length);
    expect(report.stats.coveredTransitions).toBe(1);
    expect(report.stats.totalTransitions).toBe(2);
    // Ratio = unexercised / total — must be in [0, 1] and consistent.
    expect(report.stats.uncoveredRatio).toBeGreaterThan(0);
    expect(report.stats.uncoveredRatio).toBeLessThan(1);
    expect(report.stats.uncoveredRatio).toBe(
      report.unexercisedAssertions.length / report.stats.totalAssertions,
    );
  });

  it("uncoveredRatio is 0 when totalAssertions is 0 (no NaN)", () => {
    const emptySuite: RegressionSuite = {
      id: "empty@suite",
      ir: { id: "empty", version: "1.0" },
      cases: [],
    };
    const report = coverageDiff(emptySuite, []);
    expect(report.stats.totalAssertions).toBe(0);
    expect(report.stats.uncoveredRatio).toBe(0);
  });

  it("sorts unexercisedAssertions by (caseId, assertionId) ascending", () => {
    const suite = makeFixtureSuite();
    const report = coverageDiff(suite, []);
    const sortedClone = [...report.unexercisedAssertions].sort((a, b) => {
      if (a.caseId !== b.caseId) return a.caseId < b.caseId ? -1 : 1;
      return a.assertionId < b.assertionId ? -1 : 1;
    });
    expect(report.unexercisedAssertions).toEqual(sortedClone);
  });

  it("sorts uncoveredTransitions by (caseId, transitionId) ascending", () => {
    const suite = makeFixtureSuite();
    const report = coverageDiff(suite, []);
    const sortedClone = [...report.uncoveredTransitions].sort((a, b) => {
      if (a.caseId !== b.caseId) return a.caseId < b.caseId ? -1 : 1;
      return a.transitionId < b.transitionId ? -1 : 1;
    });
    expect(report.uncoveredTransitions).toEqual(sortedClone);
  });

  it("never mutates caller-supplied log", () => {
    const suite = makeFixtureSuite();
    const log: AssertionExecution[] = [
      { caseId: "z", assertionId: "z", executedAt: FIXED_TS },
      { caseId: "a", assertionId: "a", executedAt: FIXED_TS },
    ];
    const before = log.map((l) => ({ ...l }));
    coverageDiff(suite, log);
    expect(log).toEqual(before);
  });

  it("ignores log entries that don't match any suite assertion (no-op)", () => {
    const suite = makeFixtureSuite();
    const log: AssertionExecution[] = [
      {
        caseId: "no-such-case",
        assertionId: "no-such-assertion",
        executedAt: FIXED_TS,
      },
    ];
    const report = coverageDiff(suite, log);
    // Stats should be identical to the empty-log case.
    const baseline = coverageDiff(suite, []);
    expect(report.stats).toEqual(baseline.stats);
  });
});

// ---------------------------------------------------------------------------
// Helper — derive an assertion's id the same way `coverageDiff` does. Kept
// out of the fixture builders so the test reads as "execute THIS assertion"
// rather than "execute the assertion with this opaque id".
// ---------------------------------------------------------------------------

function idOf(a: import("../../state/regression-generator").RegressionAssertion): string {
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
