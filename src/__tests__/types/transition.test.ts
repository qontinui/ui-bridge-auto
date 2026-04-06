import { describe, it, expect } from "vitest";
import {
  transitionSuccessRate,
  recordTransitionExecution,
  type Transition,
  type TransitionResult,
} from "../../types/transition";

function makeTransition(overrides?: Partial<Transition>): Transition {
  return {
    id: "t1",
    name: "Test transition",
    fromStates: ["a"],
    activateStates: ["b"],
    exitStates: ["a"],
    actions: [],
    successCount: 0,
    failureCount: 0,
    averageDurationMs: 0,
    ...overrides,
  };
}

function makeResult(overrides?: Partial<TransitionResult>): TransitionResult {
  return {
    transitionId: "t1",
    success: true,
    durationMs: 100,
    actionsExecuted: 1,
    statesBefore: new Set(["a"]),
    statesAfter: new Set(["b"]),
    ...overrides,
  };
}

describe("transitionSuccessRate", () => {
  it("returns 0.5 when no executions recorded", () => {
    expect(transitionSuccessRate(makeTransition())).toBe(0.5);
  });

  it("returns 1.0 for all successes", () => {
    expect(transitionSuccessRate(makeTransition({ successCount: 5, failureCount: 0 }))).toBe(1.0);
  });

  it("returns 0.0 for all failures", () => {
    expect(transitionSuccessRate(makeTransition({ successCount: 0, failureCount: 3 }))).toBe(0.0);
  });

  it("computes correct ratio", () => {
    expect(transitionSuccessRate(makeTransition({ successCount: 3, failureCount: 1 }))).toBe(0.75);
  });
});

describe("recordTransitionExecution", () => {
  it("increments successCount on success", () => {
    const t = makeTransition();
    recordTransitionExecution(t, makeResult({ success: true }));
    expect(t.successCount).toBe(1);
    expect(t.failureCount).toBe(0);
  });

  it("increments failureCount on failure", () => {
    const t = makeTransition();
    recordTransitionExecution(t, makeResult({ success: false }));
    expect(t.failureCount).toBe(1);
    expect(t.successCount).toBe(0);
  });

  it("sets averageDurationMs to durationMs on first execution", () => {
    const t = makeTransition();
    recordTransitionExecution(t, makeResult({ durationMs: 200 }));
    expect(t.averageDurationMs).toBe(200);
  });

  it("applies rolling average on subsequent executions", () => {
    const t = makeTransition({ successCount: 1, averageDurationMs: 100 });
    recordTransitionExecution(t, makeResult({ durationMs: 200 }));
    // 100 * 0.9 + 200 * 0.1 = 110
    expect(t.averageDurationMs).toBeCloseTo(110);
  });

  it("sets lastExecutedAt", () => {
    const t = makeTransition();
    const before = Date.now();
    recordTransitionExecution(t, makeResult());
    expect(t.lastExecutedAt).toBeGreaterThanOrEqual(before);
  });
});
