import { describe, it, expect, beforeEach } from "vitest";
import {
  executeSequence,
  type ActionStep,
} from "../../batch/action-sequence";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createInput,
  resetIdCounter,
} from "../../test-utils/mock-elements";

let executor: MockActionExecutor;
let registry: MockRegistry;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  executor = new MockActionExecutor();
  registry = new MockRegistry();
});

describe("executeSequence", () => {
  it("executes a single step", async () => {
    const btn = createButton("Submit");
    registry.addElement(btn);

    const steps: ActionStep[] = [
      { target: { tagName: "button" }, action: "click" },
    ];

    const results = await executeSequence(steps, executor, registry);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].action).toBe("click");
    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].action).toBe("click");
  });

  it("executes multi-step sequence in order", async () => {
    const input = createInput("Email");
    const btn = createButton("Submit");
    registry.addElement(input);
    registry.addElement(btn);

    const steps: ActionStep[] = [
      { target: { tagName: "input" }, action: "type", params: { text: "user@test.com" } },
      { target: { tagName: "button" }, action: "click" },
    ];

    const results = await executeSequence(steps, executor, registry);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(executor.executedActions[0].action).toBe("type");
    expect(executor.executedActions[0].params).toEqual({ text: "user@test.com" });
    expect(executor.executedActions[1].action).toBe("click");
  });

  it("stops on error by default (stopOnError: true)", async () => {
    const btn = createButton("First");
    registry.addElement(btn);

    // Second step's target won't exist
    const steps: ActionStep[] = [
      { target: { tagName: "button" }, action: "click" },
      { target: { tagName: "select" }, action: "click" }, // will fail — not found
      { target: { tagName: "button" }, action: "click" }, // should not run
    ];

    const results = await executeSequence(steps, executor, registry);

    expect(results).toHaveLength(2); // first succeeds, second fails, third skipped
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain("not found");
  });

  it("continues on error when stopOnError is false", async () => {
    const btn = createButton("First");
    registry.addElement(btn);

    const steps: ActionStep[] = [
      { target: { tagName: "button" }, action: "click" },
      { target: { tagName: "select" }, action: "click" }, // will fail
      { target: { tagName: "button" }, action: "click" }, // should still run
    ];

    const results = await executeSequence(steps, executor, registry, {
      stopOnError: false,
    });

    expect(results).toHaveLength(3);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
  });

  it("applies default waitAfter (idle) between steps", async () => {
    const btn = createButton("Submit");
    registry.addElement(btn);

    const steps: ActionStep[] = [
      { target: { tagName: "button" }, action: "click" },
    ];

    // The default wait is idle which calls executor.waitForIdle
    const results = await executeSequence(steps, executor, registry);
    expect(results[0].success).toBe(true);
  });

  it("records step duration in results", async () => {
    const btn = createButton("Submit");
    registry.addElement(btn);

    const steps: ActionStep[] = [
      { target: { tagName: "button" }, action: "click" },
    ];

    const results = await executeSequence(steps, executor, registry);
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles empty step list", async () => {
    const results = await executeSequence([], executor, registry);
    expect(results).toEqual([]);
  });

  it("reports element not found as error", async () => {
    const steps: ActionStep[] = [
      { target: { id: "nonexistent" }, action: "click" },
    ];

    const results = await executeSequence(steps, executor, registry);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBeDefined();
  });
});
