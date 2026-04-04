import { describe, it, expect, beforeEach } from "vitest";
import { loop, tryCatch, switchCase, clickUntil, forEach, retryChain, priorityExecute } from "../../actions/control-flow";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { resetIdCounter } from "../../test-utils/mock-elements";
import type { ChainStep } from "../../actions/action-chain";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let executor: MockActionExecutor;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  executor = new MockActionExecutor();
  executor.registerElement("*", "default-el");
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

describe("loop", () => {
  it("executes steps N times while condition is true", async () => {
    let counter = 0;
    const steps: ChainStep[] = [
      { type: "action", query: { text: "Inc" }, action: "click" },
    ];

    await loop(executor, steps, {
      condition: () => {
        counter++;
        return counter <= 3;
      },
      maxIterations: 10,
    });

    // condition checked 4 times (true 3 times, false on 4th)
    expect(executor.executedActions).toHaveLength(3);
  });

  it("respects maxIterations even if condition stays true", async () => {
    const steps: ChainStep[] = [
      { type: "action", query: { text: "Loop" }, action: "click" },
    ];

    await loop(executor, steps, {
      condition: () => true,
      maxIterations: 5,
    });

    expect(executor.executedActions).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// tryCatch
// ---------------------------------------------------------------------------

describe("tryCatch", () => {
  it("executes try steps on success", async () => {
    const trySteps: ChainStep[] = [
      { type: "action", query: { text: "Ok" }, action: "click" },
    ];
    const catchSteps: ChainStep[] = [
      { type: "action", query: { text: "Error" }, action: "click" },
    ];

    await tryCatch(executor, trySteps, catchSteps);

    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].action).toBe("click");
  });

  it("executes catch steps on error", async () => {
    executor.setNextError(new Error("boom"));
    executor.registerElement("text:Recover", "recover-btn");

    const trySteps: ChainStep[] = [
      { type: "action", query: { text: "Fail" }, action: "click" },
    ];
    const catchSteps: ChainStep[] = [
      { type: "action", query: { text: "Recover" }, action: "click" },
    ];

    await tryCatch(executor, trySteps, catchSteps);

    // The try step failed, then the catch step ran
    const lastAction = executor.executedActions[executor.executedActions.length - 1];
    expect(lastAction.elementId).toBe("recover-btn");
  });

  it("always executes finally steps", async () => {
    executor.registerElement("text:Cleanup", "cleanup-btn");

    const trySteps: ChainStep[] = [
      { type: "action", query: { text: "Main" }, action: "click" },
    ];
    const finallySteps: ChainStep[] = [
      { type: "action", query: { text: "Cleanup" }, action: "click" },
    ];

    await tryCatch(executor, trySteps, [], finallySteps);

    const actions = executor.executedActions;
    const lastAction = actions[actions.length - 1];
    expect(lastAction.elementId).toBe("cleanup-btn");
  });
});

// ---------------------------------------------------------------------------
// switchCase
// ---------------------------------------------------------------------------

describe("switchCase", () => {
  it("executes matching case", async () => {
    executor.registerElement("text:Admin", "admin-btn");

    await switchCase(executor, () => "admin", {
      admin: [{ type: "action", query: { text: "Admin" }, action: "click" }],
      user: [{ type: "action", query: { text: "User" }, action: "click" }],
    });

    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].elementId).toBe("admin-btn");
  });

  it("executes default when no match", async () => {
    executor.registerElement("text:Guest", "guest-btn");

    await switchCase(
      executor,
      () => "unknown",
      {
        admin: [{ type: "action", query: { text: "Admin" }, action: "click" }],
      },
      [{ type: "action", query: { text: "Guest" }, action: "click" }],
    );

    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].elementId).toBe("guest-btn");
  });
});

// ---------------------------------------------------------------------------
// clickUntil
// ---------------------------------------------------------------------------

describe("clickUntil", () => {
  it("clicks until condition element appears", async () => {
    let clickCount = 0;
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Done") {
        return clickCount >= 3 ? { id: "done-el" } : null;
      }
      return originalFind(query);
    };

    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      clickCount++;
      return originalExec(id, action, params);
    };

    const ctx = await clickUntil(
      executor,
      { text: "Next" },
      { type: "elementAppears", query: { text: "Done" } },
      { maxRepetitions: 10 },
    );

    expect(ctx.variables._conditionMet).toBe(true);
    // The loop runs the click step, then checks condition.
    // After 3 clicks, condition is met, so loop stops.
    expect(clickCount).toBe(3);
  });

  it("stops after maxRepetitions even if condition not met", async () => {
    // Override findElement so the condition target is never found
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "NeverAppears") return null;
      return originalFind(query);
    };

    const ctx = await clickUntil(
      executor,
      { text: "Next" },
      { type: "elementAppears", query: { text: "NeverAppears" } },
      { maxRepetitions: 3 },
    );

    // loop() runs 3 iterations, condition never met
    expect(executor.executedActions).toHaveLength(3);
    expect(ctx.variables._conditionMet).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// forEach
// ---------------------------------------------------------------------------

describe("forEach", () => {
  it("iterates over collection executing steps for each item", async () => {
    const steps: ChainStep[] = [
      { type: "action", query: { text: "Item" }, action: "click" },
    ];

    const ctx = await forEach(executor, steps, ["a", "b", "c"], "item");

    expect(executor.executedActions).toHaveLength(3);
    // Iteration variables cleaned up
    expect(ctx.variables.item).toBeUndefined();
    expect(ctx.variables._index).toBeUndefined();
  });

  it("respects maxIterations", async () => {
    const steps: ChainStep[] = [
      { type: "action", query: { text: "Item" }, action: "click" },
    ];

    await forEach(executor, steps, [1, 2, 3, 4, 5], "n", { maxIterations: 2 });

    expect(executor.executedActions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// retryChain
// ---------------------------------------------------------------------------

describe("retryChain", () => {
  it("retries and succeeds on later attempt", async () => {
    let attempts = 0;
    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return originalExec(id, action, params);
    };

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Go" }, action: "click" },
    ];

    const ctx = await retryChain(executor, steps, { maxAttempts: 5, delayMs: 1 });

    expect(ctx.errors).toHaveLength(0);
    expect(attempts).toBe(3);
  });

  it("fails after all attempts", async () => {
    executor.executeAction = async () => { throw new Error("always"); };

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Fail" }, action: "click" },
    ];

    const ctx = await retryChain(executor, steps, { maxAttempts: 2, delayMs: 1 });

    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0].message).toContain("all 2 attempts failed");
  });
});

// ---------------------------------------------------------------------------
// priorityExecute
// ---------------------------------------------------------------------------

describe("priorityExecute", () => {
  it("uses first successful alternative", async () => {
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Missing") return null;
      return originalFind(query);
    };

    const ctx = await priorityExecute(executor, [
      [{ type: "action", query: { text: "Missing" }, action: "click" }],
      [{ type: "action", query: { text: "Ok" }, action: "click" }],
    ]);

    expect(ctx.errors).toHaveLength(0);
    expect(executor.executedActions.length).toBeGreaterThan(0);
  });

  it("fails when all alternatives fail", async () => {
    executor.findElement = () => null;

    const ctx = await priorityExecute(executor, [
      [{ type: "action", query: { text: "A" }, action: "click" }],
      [{ type: "action", query: { text: "B" }, action: "click" }],
    ]);

    expect(ctx.errors).toHaveLength(1);
    expect(ctx.errors[0].message).toContain("all alternatives failed");
  });
});
