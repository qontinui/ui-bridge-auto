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
// Branching
// ---------------------------------------------------------------------------

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
