import { describe, it, expect, beforeEach } from "vitest";
import { loop, tryCatch, switchCase } from "../../actions/control-flow";
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
