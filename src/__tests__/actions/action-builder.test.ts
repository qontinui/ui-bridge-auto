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
