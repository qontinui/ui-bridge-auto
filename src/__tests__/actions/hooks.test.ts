import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker } from "../../actions/hooks";
import type { ChainHooks } from "../../actions/hooks";
import { ActionChain, type ChainStep } from "../../actions/action-chain";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { resetIdCounter } from "../../test-utils/mock-elements";

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe("CircuitBreaker", () => {
  it("is closed initially", () => {
    const cb = new CircuitBreaker({ threshold: 3, resetAfterMs: 1000 });
    expect(cb.isOpen("click")).toBe(false);
  });

  it("opens after threshold consecutive failures", () => {
    const cb = new CircuitBreaker({ threshold: 3, resetAfterMs: 10000 });
    cb.recordFailure("click");
    cb.recordFailure("click");
    expect(cb.isOpen("click")).toBe(false);
    cb.recordFailure("click");
    expect(cb.isOpen("click")).toBe(true);
  });

  it("resets on success", () => {
    const cb = new CircuitBreaker({ threshold: 3, resetAfterMs: 10000 });
    cb.recordFailure("click");
    cb.recordFailure("click");
    cb.recordSuccess("click");
    cb.recordFailure("click");
    expect(cb.isOpen("click")).toBe(false);
  });

  it("auto-resets after resetAfterMs", () => {
    const cb = new CircuitBreaker({ threshold: 1, resetAfterMs: 50 });
    cb.recordFailure("click");
    expect(cb.isOpen("click")).toBe(true);

    // Simulate time passing by manipulating the internal state
    const state = (cb as unknown as { state: Map<string, { failures: number; openedAt?: number }> }).state;
    const entry = state.get("click")!;
    entry.openedAt = Date.now() - 100; // pretend it opened 100ms ago
    expect(cb.isOpen("click")).toBe(false);
  });

  it("manual reset clears the circuit", () => {
    const cb = new CircuitBreaker({ threshold: 1, resetAfterMs: 100000 });
    cb.recordFailure("click");
    expect(cb.isOpen("click")).toBe(true);
    cb.reset("click");
    expect(cb.isOpen("click")).toBe(false);
  });

  it("tracks different keys independently", () => {
    const cb = new CircuitBreaker({ threshold: 2, resetAfterMs: 10000 });
    cb.recordFailure("click");
    cb.recordFailure("click");
    cb.recordFailure("type");
    expect(cb.isOpen("click")).toBe(true);
    expect(cb.isOpen("type")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hooks integration with ActionChain
// ---------------------------------------------------------------------------

describe("ChainHooks integration", () => {
  let executor: MockActionExecutor;

  beforeEach(() => {
    resetIdCounter();
    document.body.innerHTML = "";
    executor = new MockActionExecutor();
    executor.registerElement("*", "default-el");
  });

  it("calls beforeStep and afterStep hooks", async () => {
    const calls: string[] = [];
    const hooks: ChainHooks = {
      beforeStep: () => { calls.push("before"); },
      afterStep: () => { calls.push("after"); },
    };

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Go" }, action: "click" },
    ];

    const chain = new ActionChain(executor);
    await chain.execute(steps, { hooks });

    expect(calls).toEqual(["before", "after"]);
  });

  it("calls onError hook on failure", async () => {
    const errors: string[] = [];
    const hooks: ChainHooks = {
      onError: (_step, error) => { errors.push(error.message); },
    };

    executor.setNextError(new Error("boom"));

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Fail" }, action: "click" },
    ];

    const chain = new ActionChain(executor);
    await chain.execute(steps, { hooks });

    expect(errors.length).toBeGreaterThan(0);
  });

  it("circuit breaker skips action when open", async () => {
    const cb = new CircuitBreaker({ threshold: 1, resetAfterMs: 100000 });
    cb.recordFailure("click"); // Open the circuit

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Go" }, action: "click" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps, { circuitBreaker: cb });

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("Circuit breaker open");
    expect(executor.executedActions).toHaveLength(0);
  });
});
