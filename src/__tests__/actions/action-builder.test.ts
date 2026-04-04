import { describe, it, expect, beforeEach } from "vitest";
import { ChainBuilder } from "../../actions/action-builder";
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
// Fluent API
// ---------------------------------------------------------------------------

describe("ChainBuilder — fluent API", () => {
  it("click().type().select() produces correct steps", () => {
    const builder = new ChainBuilder(executor)
      .click({ role: "button" })
      .type({ text: "Email" }, "user@example.com")
      .select({ text: "Country" }, "US");

    const steps = builder.steps();

    expect(steps).toHaveLength(3);
    const s0 = steps[0] as { type: string; action: string; params?: unknown };
    const s1 = steps[1] as { type: string; action: string; params?: unknown };
    const s2 = steps[2] as { type: string; action: string; params?: unknown };
    expect(s0.type).toBe("action");
    expect(s0.action).toBe("click");
    expect(s1.type).toBe("action");
    expect(s1.action).toBe("type");
    expect(s1.params).toEqual({ value: "user@example.com" });
    expect(s2.type).toBe("action");
    expect(s2.action).toBe("select");
    expect(s2.params).toEqual({ value: "US" });
  });

  it("waitForIdle() adds wait step", () => {
    const builder = new ChainBuilder(executor)
      .click({ text: "Save" })
      .waitForIdle();

    const steps = builder.steps();

    expect(steps).toHaveLength(2);
    expect(steps[1].type).toBe("wait");
  });

  it("extract() adds extract step", () => {
    const builder = new ChainBuilder(executor)
      .extract({ text: "Total" }, "textContent", "totalAmount");

    const steps = builder.steps();

    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; property: string; variable: string };
    expect(s.type).toBe("extract");
    expect(s.property).toBe("textContent");
    expect(s.variable).toBe("totalAmount");
  });

  it("assert() adds assert step", () => {
    const builder = new ChainBuilder(executor)
      .assert({ text: "Status" }, "textContent", "Active");

    const steps = builder.steps();

    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; property: string; expected: unknown };
    expect(s.type).toBe("assert");
    expect(s.property).toBe("textContent");
    expect(s.expected).toBe("Active");
  });
});

// ---------------------------------------------------------------------------
// Data operation methods
// ---------------------------------------------------------------------------

describe("ChainBuilder — data operations", () => {
  it("transform() produces correct step", () => {
    const steps = new ChainBuilder(executor)
      .transform("name", "toUpperCase")
      .steps();
    const s = steps[0] as { type: string; variable: string; operation: string; args: unknown[] };
    expect(s.type).toBe("transform");
    expect(s.variable).toBe("name");
    expect(s.operation).toBe("toUpperCase");
    expect(s.args).toEqual([]);
  });

  it("transform() with args", () => {
    const steps = new ChainBuilder(executor)
      .transform("price", "add", 10)
      .steps();
    const s = steps[0] as { type: string; variable: string; operation: string; args: unknown[] };
    expect(s.args).toEqual([10]);
  });

  it("compute() produces correct step", () => {
    const steps = new ChainBuilder(executor)
      .compute("price * quantity", "total")
      .steps();
    const s = steps[0] as { type: string; expression: string; variable: string };
    expect(s.type).toBe("compute");
    expect(s.expression).toBe("price * quantity");
    expect(s.variable).toBe("total");
  });
});

// ---------------------------------------------------------------------------
// New action methods
// ---------------------------------------------------------------------------

describe("ChainBuilder — new action methods", () => {
  it("middleClick() produces correct step", () => {
    const steps = new ChainBuilder(executor).middleClick({ role: "button" }).steps();
    const s = steps[0] as { type: string; action: string };
    expect(s.type).toBe("action");
    expect(s.action).toBe("middleClick");
  });

  it("mouseDown() produces step with button param", () => {
    const steps = new ChainBuilder(executor).mouseDown({ role: "slider" }, "right").steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.action).toBe("mouseDown");
    expect(s.params).toEqual({ button: "right" });
  });

  it("mouseUp() produces step without params when no button specified", () => {
    const steps = new ChainBuilder(executor).mouseUp({ role: "slider" }).steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.action).toBe("mouseUp");
    expect(s.params).toBeUndefined();
  });

  it("keyDown() produces step with keys and modifiers", () => {
    const steps = new ChainBuilder(executor).keyDown({ role: "textbox" }, "a", ["ctrl"]).steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.action).toBe("keyDown");
    expect(s.params).toEqual({ keys: "a", modifiers: ["ctrl"] });
  });

  it("keyUp() produces step with keys", () => {
    const steps = new ChainBuilder(executor).keyUp({ role: "textbox" }, "a").steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.action).toBe("keyUp");
    expect(s.params).toEqual({ keys: "a" });
  });

  it("scroll() produces step with direction and amount params", () => {
    const steps = new ChainBuilder(executor)
      .scroll({ role: "list" }, { direction: "up", amount: 5 })
      .steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.action).toBe("scroll");
    expect(s.params).toEqual({ direction: "up", amount: 5, smooth: true });
  });

  it("scroll() uses defaults when no options provided", () => {
    const steps = new ChainBuilder(executor).scroll({ role: "list" }).steps();
    const s = steps[0] as { type: string; action: string; params?: Record<string, unknown> };
    expect(s.params).toEqual({ direction: "down", amount: 3, smooth: true });
  });

  it("waitForVanish() adds a vanish wait step", () => {
    const steps = new ChainBuilder(executor)
      .waitForVanish({ text: "Loading..." }, 5000)
      .steps();
    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; spec: { type: string; timeout?: number } };
    expect(s.type).toBe("wait");
    expect(s.spec.type).toBe("vanish");
    expect(s.spec.timeout).toBe(5000);
  });

  it("clickUntil() adds a clickUntil step", () => {
    const steps = new ChainBuilder(executor)
      .clickUntil(
        { text: "Next" },
        { type: "elementAppears", query: { text: "Done" } },
        { maxRepetitions: 5, pauseBetweenMs: 200 },
      )
      .steps();
    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; maxRepetitions?: number; pauseBetweenMs?: number };
    expect(s.type).toBe("clickUntil");
    expect(s.maxRepetitions).toBe(5);
    expect(s.pauseBetweenMs).toBe(200);
  });

  it("repeat() annotates the last action step with repetition", () => {
    const steps = new ChainBuilder(executor)
      .click({ text: "Save" })
      .repeat(3, 500)
      .steps();
    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; repetition?: { count: number; pauseBetweenMs?: number } };
    expect(s.repetition).toEqual({ count: 3, pauseBetweenMs: 500 });
  });
});

// ---------------------------------------------------------------------------
// Branching
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Control flow builder methods
// ---------------------------------------------------------------------------

describe("ChainBuilder — control flow", () => {
  it("set() produces setVariable step", () => {
    const steps = new ChainBuilder(executor).set("x", 42).steps();
    const s = steps[0] as { type: string; variable: string; value: unknown };
    expect(s.type).toBe("setVariable");
    expect(s.variable).toBe("x");
    expect(s.value).toBe(42);
  });

  it("break() produces setVariable _break", () => {
    const steps = new ChainBuilder(executor).break().steps();
    const s = steps[0] as { type: string; variable: string; value: unknown };
    expect(s.type).toBe("setVariable");
    expect(s.variable).toBe("_break");
    expect(s.value).toBe(true);
  });

  it("continue() produces setVariable _continue", () => {
    const steps = new ChainBuilder(executor).continue().steps();
    const s = steps[0] as { type: string; variable: string; value: unknown };
    expect(s.variable).toBe("_continue");
  });

  it("scope() creates scope step with sub-steps", () => {
    const steps = new ChainBuilder(executor)
      .scope(b => b.click({ text: "Inside" }), { temp: true })
      .steps();
    const s = steps[0] as { type: string; steps: unknown[]; initialVars?: Record<string, unknown> };
    expect(s.type).toBe("scope");
    expect(s.steps).toHaveLength(1);
    expect(s.initialVars).toEqual({ temp: true });
  });

  it("forEach() creates forEach step", () => {
    const steps = new ChainBuilder(executor)
      .forEach("items", "item", b => b.click({ text: "Item" }), { maxIterations: 10 })
      .steps();
    const s = steps[0] as { type: string; collection: string; itemVariable: string; steps: unknown[]; maxIterations?: number };
    expect(s.type).toBe("forEach");
    expect(s.collection).toBe("items");
    expect(s.itemVariable).toBe("item");
    expect(s.steps).toHaveLength(1);
    expect(s.maxIterations).toBe(10);
  });

  it("retryBlock() creates retryBlock step", () => {
    const steps = new ChainBuilder(executor)
      .retryBlock(b => b.click({ text: "Retry" }), { maxAttempts: 5, delayMs: 100 })
      .steps();
    const s = steps[0] as { type: string; steps: unknown[]; maxAttempts?: number; delayMs?: number };
    expect(s.type).toBe("retryBlock");
    expect(s.steps).toHaveLength(1);
    expect(s.maxAttempts).toBe(5);
    expect(s.delayMs).toBe(100);
  });

  it("priority() creates priority step with alternatives", () => {
    const steps = new ChainBuilder(executor)
      .priority(
        b => b.click({ text: "Primary" }),
        b => b.click({ text: "Fallback" }),
      )
      .steps();
    const s = steps[0] as { type: string; alternatives: unknown[][] };
    expect(s.type).toBe("priority");
    expect(s.alternatives).toHaveLength(2);
    expect(s.alternatives[0]).toHaveLength(1);
    expect(s.alternatives[1]).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Wait extension builder methods
// ---------------------------------------------------------------------------

describe("ChainBuilder — wait extensions", () => {
  it("waitForChange() produces change wait step", () => {
    const steps = new ChainBuilder(executor)
      .waitForChange({ text: "Price" }, "text", 5000)
      .steps();
    const s = steps[0] as { type: string; spec: { type: string; property?: string; timeout?: number } };
    expect(s.type).toBe("wait");
    expect(s.spec.type).toBe("change");
    expect(s.spec.property).toBe("text");
    expect(s.spec.timeout).toBe(5000);
  });

  it("waitForStable() produces stable wait step", () => {
    const steps = new ChainBuilder(executor)
      .waitForStable({ text: "Counter" }, "text", 5000, 200)
      .steps();
    const s = steps[0] as { type: string; spec: { type: string; property?: string; quietPeriodMs?: number } };
    expect(s.spec.type).toBe("stable");
    expect(s.spec.property).toBe("text");
    expect(s.spec.quietPeriodMs).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Assertion builder methods
// ---------------------------------------------------------------------------

describe("ChainBuilder — assertion extensions", () => {
  it("assertCount() produces count assert step", () => {
    const steps = new ChainBuilder(executor)
      .assertCount({ role: "button" }, 3)
      .steps();
    const s = steps[0] as { type: string; property: string; expected: unknown };
    expect(s.type).toBe("assert");
    expect(s.property).toBe("count");
    expect(s.expected).toBe(3);
  });

  it("assertRelation() produces spatialRelation assert step", () => {
    const steps = new ChainBuilder(executor)
      .assertRelation({ text: "Header" }, "above", { text: "Content" })
      .steps();
    const s = steps[0] as { type: string; property: string; expected: { relation: string; query: { text: string } } };
    expect(s.type).toBe("assert");
    expect(s.property).toBe("spatialRelation");
    expect(s.expected.relation).toBe("above");
    expect(s.expected.query.text).toBe("Content");
  });
});

// ---------------------------------------------------------------------------
// runFlow builder method
// ---------------------------------------------------------------------------

describe("ChainBuilder — runFlow", () => {
  it("runFlow() produces runFlow step", () => {
    const steps = new ChainBuilder(executor)
      .runFlow("loginFlow", { username: "admin" })
      .steps();
    const s = steps[0] as { type: string; flowName: string; params?: Record<string, unknown> };
    expect(s.type).toBe("runFlow");
    expect(s.flowName).toBe("loginFlow");
    expect(s.params).toEqual({ username: "admin" });
  });
});

describe("ChainBuilder — branching", () => {
  it("if().then().else() creates branch step", () => {
    const condition = () => true;

    const builder = new ChainBuilder(executor)
      .if(condition)
        .then(b => b.click({ text: "Yes" }))
        .else(b => b.click({ text: "No" }));

    const steps = builder.steps();

    expect(steps).toHaveLength(1);
    const s = steps[0] as { type: string; condition: unknown; ifTrue: unknown[]; ifFalse: unknown[] };
    expect(s.type).toBe("branch");
    expect(s.condition).toBe(condition);
    expect(s.ifTrue).toHaveLength(1);
    expect(s.ifFalse).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

describe("ChainBuilder — execute", () => {
  it("execute() runs the built chain", async () => {
    executor.registerElement("role:button", "btn-1");

    const builder = new ChainBuilder(executor)
      .click({ role: "button" });

    const result = await builder.execute();

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].action).toBe("click");
  });

  it("execute() returns failure when action fails", async () => {
    executor.setNextError(new Error("click failed"));

    const builder = new ChainBuilder(executor)
      .click({ text: "Broken" });

    const result = await builder.execute();

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// steps() inspection
// ---------------------------------------------------------------------------

describe("ChainBuilder — steps()", () => {
  it("returns the built steps for inspection", () => {
    const builder = new ChainBuilder(executor)
      .click({ text: "A" })
      .type({ text: "B" }, "hello")
      .waitForIdle();

    const steps = builder.steps();

    expect(steps).toHaveLength(3);
    expect(steps.map(s => s.type)).toEqual(["action", "action", "wait"]);
  });
});
