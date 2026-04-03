import { describe, it, expect, beforeEach } from "vitest";
import { ActionChain, type ChainStep, type ChainContext } from "../../actions/action-chain";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { resetIdCounter } from "../../test-utils/mock-elements";

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
// Sequential steps
// ---------------------------------------------------------------------------

describe("ActionChain — sequential execution", () => {
  it("executes steps in order", async () => {
    executor.registerElement("role:button", "btn-1");
    executor.registerElement("text:Username", "input-1");

    const steps: ChainStep[] = [
      { type: "action", query: { role: "button" }, action: "click" },
      { type: "action", query: { text: "Username" }, action: "type", params: { value: "admin" } },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(2);
    expect(executor.executedActions[0]).toEqual({
      elementId: "btn-1",
      action: "click",
      params: undefined,
    });
    expect(executor.executedActions[1]).toEqual({
      elementId: "input-1",
      action: "type",
      params: { value: "admin" },
    });
  });
});

// ---------------------------------------------------------------------------
// Branch steps
// ---------------------------------------------------------------------------

describe("ActionChain — branch", () => {
  it("takes ifTrue path when condition is true", async () => {
    const steps: ChainStep[] = [
      {
        type: "branch",
        condition: () => true,
        ifTrue: [{ type: "action", query: { text: "Yes" }, action: "click" }],
        ifFalse: [{ type: "action", query: { text: "No" }, action: "click" }],
      },
    ];

    const chain = new ActionChain(executor, steps);
    await chain.execute();

    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].action).toBe("click");
  });

  it("takes ifFalse path when condition is false", async () => {
    executor.registerElement("text:No", "no-btn");

    const steps: ChainStep[] = [
      {
        type: "branch",
        condition: () => false,
        ifTrue: [{ type: "action", query: { text: "Yes" }, action: "click" }],
        ifFalse: [{ type: "action", query: { text: "No" }, action: "click" }],
      },
    ];

    const chain = new ActionChain(executor, steps);
    await chain.execute();

    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].elementId).toBe("no-btn");
  });
});

// ---------------------------------------------------------------------------
// Extract step
// ---------------------------------------------------------------------------

describe("ActionChain — extract", () => {
  it("stores element value in context variables", async () => {
    executor.registerElement("text:Price", "price-el");

    const steps: ChainStep[] = [
      {
        type: "extract",
        query: { text: "Price" },
        property: "textContent",
        variable: "price",
      },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.context.variables).toHaveProperty("price");
  });
});

// ---------------------------------------------------------------------------
// Assert step
// ---------------------------------------------------------------------------

describe("ActionChain — assert", () => {
  it("passes when property matches expected value", async () => {
    executor.registerElement("text:Status", "status-el");

    const steps: ChainStep[] = [
      {
        type: "assert",
        query: { text: "Status" },
        property: "textContent",
        expected: "Status",
      },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(result.context.errors).toHaveLength(0);
  });

  it("fails when property does not match expected value", async () => {
    executor.registerElement("text:Status", "status-el");

    const steps: ChainStep[] = [
      {
        type: "assert",
        query: { text: "Status" },
        property: "textContent",
        expected: "Active",
      },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(false);
    expect(result.context.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

describe("ActionChain — repetition", () => {
  it("repeats an action step the specified number of times", async () => {
    const steps: ChainStep[] = [
      { type: "action", query: { text: "Inc" }, action: "click", repetition: { count: 3 } },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(3);
    expect(executor.executedActions.every(a => a.action === "click")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vanish wait
// ---------------------------------------------------------------------------

describe("ActionChain — vanish wait", () => {
  it("resolves immediately when element is not found", async () => {
    // Override findElement so the vanish target is never found
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Loading") return null;
      return originalFind(query);
    };

    const steps: ChainStep[] = [
      { type: "wait", spec: { type: "vanish", query: { text: "Loading" }, timeout: 1000 } },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(true);
  });

  it("times out when element remains present", async () => {
    // Override findElement to always find "Loading"
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Loading") return { id: "loading-el" };
      return originalFind(query);
    };

    const steps: ChainStep[] = [
      { type: "wait", spec: { type: "vanish", query: { text: "Loading" }, timeout: 200 } },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(false);
    expect(result.context.errors.length).toBeGreaterThan(0);
    expect(result.context.errors[0].message).toContain("waitForVanish timed out");
  });
});

// ---------------------------------------------------------------------------
// clickUntil
// ---------------------------------------------------------------------------

describe("ActionChain — clickUntil", () => {
  it("clicks until condition element appears", async () => {
    let clickCount = 0;
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      // After 3 clicks, the "Done" element appears
      if (query.text === "Done") {
        return clickCount >= 3 ? { id: "done-el" } : null;
      }
      return originalFind(query);
    };

    const originalExecute = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      clickCount++;
      return originalExecute(id, action, params);
    };

    const steps: ChainStep[] = [
      {
        type: "clickUntil",
        query: { text: "Next" },
        condition: { type: "elementAppears", query: { text: "Done" } },
        maxRepetitions: 10,
      },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(clickCount).toBe(3);
  });

  it("fails when condition not met after max repetitions", async () => {
    // Override findElement so the condition target is never found
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "NeverAppears") return null;
      return originalFind(query);
    };

    const steps: ChainStep[] = [
      {
        type: "clickUntil",
        query: { text: "Next" },
        condition: { type: "elementAppears", query: { text: "NeverAppears" } },
        maxRepetitions: 2,
      },
    ];

    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("condition not met");
  });
});

// ---------------------------------------------------------------------------
// stopOnError
// ---------------------------------------------------------------------------

describe("ActionChain — stopOnError", () => {
  it("stops chain on first error when stopOnError is true", async () => {
    executor.setNextError(new Error("action failed"));

    const steps: ChainStep[] = [
      { type: "action", query: { text: "Fail" }, action: "click" },
      { type: "action", query: { text: "Never" }, action: "click" },
    ];

    const chain = new ActionChain(executor, steps, { stopOnError: true });
    const result = await chain.execute();

    expect(result.success).toBe(false);
    expect(result.context.results).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ChainContext
// ---------------------------------------------------------------------------

describe("ChainContext", () => {
  it("has variables, results, and errors", async () => {
    const steps: ChainStep[] = [];
    const chain = new ActionChain(executor, steps);
    const result = await chain.execute();

    expect(result.context).toHaveProperty("variables");
    expect(result.context).toHaveProperty("results");
    expect(result.context).toHaveProperty("errors");
    expect(typeof result.context.variables).toBe("object");
    expect(Array.isArray(result.context.results)).toBe(true);
    expect(Array.isArray(result.context.errors)).toBe(true);
  });
});
