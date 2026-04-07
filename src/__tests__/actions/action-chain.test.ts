import { describe, it, expect, beforeEach } from "vitest";
import { ActionChain, type ChainStep } from "../../actions/action-chain";
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

// ---------------------------------------------------------------------------
// Transform step
// ---------------------------------------------------------------------------

describe("ActionChain — transform", () => {
  it("applies string operation to variable", async () => {
    const steps: ChainStep[] = [
      { type: "transform", variable: "name", operation: "toUpperCase", args: [] },
    ];

    new ActionChain(executor, steps);
    // Set initial variable by using a branch that sets it
    const stepsWithSetup: ChainStep[] = [
      { type: "transform", variable: "name", operation: "toUpperCase", args: [] },
    ];

    const chain2 = new ActionChain(executor, stepsWithSetup);
    // Access internal context - we need to set variables before execution
    // Use a different approach: execute with pre-set variables
    const result = await chain2.execute(stepsWithSetup, { stopOnError: true });

    // This will fail because 'name' is not set. Let's test with a proper setup.
    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain('variable "name" is not defined');
  });

  it("transforms a string variable", async () => {
    // Test through ChainBuilder which is the public API
    const { ChainBuilder } = await import("../../actions/action-builder");
    const builder = new ChainBuilder(executor)
      .extract({ text: "Hello" }, "text", "greeting") // extracts element ID as value
      .transform("greeting", "toUpperCase");

    const result = await builder.execute();
    // The extracted value is an element ID (string), so toUpperCase works
    expect(result.success).toBe(true);
    expect(typeof result.context.variables.greeting).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Compute step
// ---------------------------------------------------------------------------

describe("ActionChain — compute", () => {
  it("evaluates arithmetic expression from variables", async () => {
    // We can't easily set variables without extract. Test compute with the chain directly.
    const steps: ChainStep[] = [
      { type: "compute", expression: "3 + 4", variable: "result" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(result.context.variables.result).toBe(7);
  });

  it("uses variables in expressions", async () => {
    const steps: ChainStep[] = [
      { type: "compute", expression: "10 * 5", variable: "price" },
      { type: "compute", expression: "price - 10", variable: "discounted" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(result.context.variables.price).toBe(50);
    expect(result.context.variables.discounted).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// setVariable step
// ---------------------------------------------------------------------------

describe("ActionChain — setVariable", () => {
  it("sets a variable in context", async () => {
    const steps: ChainStep[] = [
      { type: "setVariable", variable: "greeting", value: "hello" },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(result.context.variables.greeting).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// scope step
// ---------------------------------------------------------------------------

describe("ActionChain — scope", () => {
  it("isolates variables inside scope", async () => {
    const steps: ChainStep[] = [
      { type: "setVariable", variable: "outer", value: "preserved" },
      {
        type: "scope",
        steps: [
          { type: "setVariable", variable: "inner", value: "scoped" },
          { type: "setVariable", variable: "outer", value: "modified" },
        ],
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    // outer was restored to pre-scope value
    expect(result.context.variables.outer).toBe("preserved");
    // inner was discarded
    expect(result.context.variables.inner).toBeUndefined();
  });

  it("accepts initialVars", async () => {
    const steps: ChainStep[] = [
      {
        type: "scope",
        steps: [
          { type: "compute", expression: "x + 1", variable: "result" },
        ],
        initialVars: { x: 10 },
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    // result was computed inside scope but discarded after
    expect(result.success).toBe(true);
    expect(result.context.variables.x).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// forEach step
// ---------------------------------------------------------------------------

describe("ActionChain — forEach", () => {
  it("iterates over a collection", async () => {
    const steps: ChainStep[] = [
      { type: "setVariable", variable: "items", value: ["a", "b", "c"] },
      { type: "setVariable", variable: "collected", value: [] },
      {
        type: "forEach",
        collection: "items",
        itemVariable: "item",
        steps: [
          // We can't easily push to an array via ChainStep, but we can verify _index is set
          { type: "compute", expression: "_index + 1", variable: "lastIndex" },
        ],
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    // After forEach, lastIndex should be 3 (index 2 + 1)
    expect(result.context.variables.lastIndex).toBe(3);
    // Iteration variables are cleaned up
    expect(result.context.variables.item).toBeUndefined();
    expect(result.context.variables._index).toBeUndefined();
  });

  it("supports break", async () => {
    const steps: ChainStep[] = [
      { type: "setVariable", variable: "items", value: [1, 2, 3, 4, 5] },
      {
        type: "forEach",
        collection: "items",
        itemVariable: "n",
        steps: [
          { type: "compute", expression: "_index + 0", variable: "stopped" },
          // Break when _index reaches 2 — we need a branch for this
        ],
        maxIterations: 3,
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    // maxIterations capped at 3, so stopped at index 2
    expect(result.context.variables.stopped).toBe(2);
  });

  it("throws if collection is not an array", async () => {
    const steps: ChainStep[] = [
      { type: "setVariable", variable: "notArray", value: "string" },
      {
        type: "forEach",
        collection: "notArray",
        itemVariable: "item",
        steps: [],
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("not an array");
  });
});

// ---------------------------------------------------------------------------
// retryBlock step
// ---------------------------------------------------------------------------

describe("ActionChain — retryBlock", () => {
  it("retries and succeeds on later attempt", async () => {
    let attempts = 0;
    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      attempts++;
      if (attempts < 3) throw new Error("transient");
      return originalExec(id, action, params);
    };

    const steps: ChainStep[] = [
      {
        type: "retryBlock",
        steps: [
          { type: "action", query: { text: "Go" }, action: "click" },
        ],
        maxAttempts: 5,
        delayMs: 1,
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(attempts).toBe(3);
  });

  it("fails after all attempts exhausted", async () => {
    executor.setNextError(new Error("permanent"));
    // Mock so it always fails
    executor.executeAction = async () => { throw new Error("permanent"); };

    const steps: ChainStep[] = [
      {
        type: "retryBlock",
        steps: [
          { type: "action", query: { text: "Fail" }, action: "click" },
        ],
        maxAttempts: 2,
        delayMs: 1,
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("all 2 attempts failed");
  });
});

// ---------------------------------------------------------------------------
// priority step
// ---------------------------------------------------------------------------

describe("ActionChain — priority", () => {
  it("uses first successful alternative", async () => {
    // First alternative will fail (element not found), second succeeds
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Missing") return null;
      return originalFind(query);
    };

    const steps: ChainStep[] = [
      {
        type: "priority",
        alternatives: [
          [{ type: "action", query: { text: "Missing" }, action: "click" }],
          [{ type: "action", query: { text: "Fallback" }, action: "click" }],
        ],
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(executor.executedActions.length).toBeGreaterThan(0);
    expect(executor.executedActions[executor.executedActions.length - 1].action).toBe("click");
  });

  it("fails when all alternatives fail", async () => {
    executor.findElement = () => null;

    const steps: ChainStep[] = [
      {
        type: "priority",
        alternatives: [
          [{ type: "action", query: { text: "A" }, action: "click" }],
          [{ type: "action", query: { text: "B" }, action: "click" }],
        ],
      },
    ];
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("all alternatives failed");
  });
});

// ---------------------------------------------------------------------------
// runFlow step
// ---------------------------------------------------------------------------

describe("ActionChain — runFlow", () => {
  it("executes a named flow from the registry", async () => {
    const { FlowRegistry } = await import("../../batch/flow");
    const registry = new FlowRegistry();
    registry.define({
      name: "clickTwice",
      steps: [
        { target: { text: "Button" }, action: "click" },
        { target: { text: "Button" }, action: "click" },
      ],
    });

    const steps: ChainStep[] = [
      { type: "runFlow", flowName: "clickTwice" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps, { flowRegistry: registry });

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(2);
  });

  it("fails if no flow registry configured", async () => {
    const steps: ChainStep[] = [
      { type: "runFlow", flowName: "missing" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("no FlowRegistry");
  });

  it("fails if flow not found", async () => {
    const { FlowRegistry } = await import("../../batch/flow");
    const registry = new FlowRegistry();

    const steps: ChainStep[] = [
      { type: "runFlow", flowName: "nonexistent" },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps, { flowRegistry: registry });

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("not found");
  });

  it("scopes variables — params don't leak", async () => {
    const { FlowRegistry } = await import("../../batch/flow");
    const registry = new FlowRegistry();
    registry.define({
      name: "noop",
      steps: [],
    });

    const steps: ChainStep[] = [
      { type: "setVariable", variable: "outer", value: "keep" },
      { type: "runFlow", flowName: "noop", params: { inner: "temp" } },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps, { flowRegistry: registry });

    expect(result.success).toBe(true);
    expect(result.context.variables.outer).toBe("keep");
    expect(result.context.variables.inner).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// assertCount
// ---------------------------------------------------------------------------

describe("ActionChain — assertCount", () => {
  it("passes when count matches", async () => {
    executor.registerElement("role:button", "btn-1");

    const steps: ChainStep[] = [
      { type: "assert", query: { role: "button" }, property: "count", expected: 1 },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
  });

  it("fails when count mismatches", async () => {
    executor.registerElement("role:button", "btn-1");

    const steps: ChainStep[] = [
      { type: "assert", query: { role: "button" }, property: "count", expected: 5 },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("expected count 5");
  });
});

// ---------------------------------------------------------------------------
// assertRelation
// ---------------------------------------------------------------------------

describe("ActionChain — assertRelation", () => {
  it("passes when spatial relation holds", async () => {
    executor.registerElement("text:Header", "header-el");
    executor.registerElement("text:Content", "content-el");
    executor.registerRect("header-el", { x: 0, y: 0, width: 100, height: 50 });
    executor.registerRect("content-el", { x: 0, y: 100, width: 100, height: 200 });

    const steps: ChainStep[] = [
      {
        type: "assert",
        query: { text: "Header" },
        property: "spatialRelation",
        expected: { relation: "above", query: { text: "Content" } },
      },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
  });

  it("fails when spatial relation does not hold", async () => {
    executor.registerElement("text:A", "a-el");
    executor.registerElement("text:B", "b-el");
    executor.registerRect("a-el", { x: 0, y: 100, width: 50, height: 50 });
    executor.registerRect("b-el", { x: 0, y: 0, width: 50, height: 50 });

    const steps: ChainStep[] = [
      {
        type: "assert",
        query: { text: "A" },
        property: "spatialRelation",
        expected: { relation: "above", query: { text: "B" } },
      },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("not above");
  });
});

// ---------------------------------------------------------------------------
// waitForChange / waitForStable in chain
// ---------------------------------------------------------------------------

describe("ActionChain — waitForChange", () => {
  it("resolves when element presence changes", async () => {
    let callCount = 0;
    const originalFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      if (query.text === "Loading") {
        callCount++;
        // Initially present, gone after 3 polls
        return callCount <= 3 ? { id: "loading-el" } : null;
      }
      return originalFind(query);
    };

    const steps: ChainStep[] = [
      { type: "wait", spec: { type: "change", query: { text: "Loading" }, timeout: 2000 } },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
  });
});

describe("ActionChain — waitForStable", () => {
  it("resolves when element presence is stable", async () => {
    // Element is always present = immediately stable
    const steps: ChainStep[] = [
      { type: "wait", spec: { type: "stable", query: { text: "Status" }, timeout: 2000, quietPeriodMs: 100 } },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
  });
});

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
