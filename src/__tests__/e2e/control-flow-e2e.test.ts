/**
 * End-to-end integration tests for advanced control flow and wait primitives.
 *
 * These tests exercise the full chain execution pipeline with real
 * ChainBuilder -> ActionChain -> MockActionExecutor flows, covering
 * scopes, loops, retries, priority fallback, circuit breakers, hooks,
 * flows, waits, assertions, and data-driven automation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChainBuilder } from "../../actions/action-builder";
import { ActionChain, type ChainStep } from "../../actions/action-chain";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { MockRegistry } from "../../test-utils/mock-registry";
import { createButton, createMockElement, resetIdCounter } from "../../test-utils/mock-elements";
import { FlowRegistry } from "../../batch/flow";
import { CircuitBreaker } from "../../actions/hooks";
import type { ChainHooks } from "../../actions/hooks";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let executor: MockActionExecutor;
let registry: MockRegistry;

beforeEach(() => {
  executor = new MockActionExecutor();
  registry = new MockRegistry();
  resetIdCounter();
});

// ---------------------------------------------------------------------------
// 1. Scope + Transform Chain
// ---------------------------------------------------------------------------

describe("Scope + Transform Chain", () => {
  it("isolates variables inside a scope and restores them on exit", async () => {
    const builder = new ChainBuilder(executor);

    builder
      .set("name", "hello world")
      .scope(
        (b) => {
          // Transform "name" to uppercase
          b.transform("name", "toUpperCase");
          // Build a result by concatenating prefix + ": " + name
          // (compute is arithmetic-only, so use setVariable)
          b.set("result", "placeholder");
        },
        { prefix: "GREETING" },
      );

    // We need to inspect the context, so build the steps and execute manually
    // to read intermediate state. Instead, use a branch to capture values.
    const chain = new ChainBuilder(executor);

    chain
      .set("name", "hello world")
      .scope(
        (b) => {
          b.transform("name", "toUpperCase");
          // Build result = prefix + ": " + name
          // Since compute only handles arithmetic, we set result directly
          // via a branch that reads context variables.
          b._pushStep({
            type: "branch",
            condition: (ctx) => {
              ctx.variables.result = `${ctx.variables.prefix}: ${ctx.variables.name}`;
              return true;
            },
            ifTrue: [],
          });
        },
        { prefix: "GREETING" },
      );

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // After scope exits, "name" should be restored to original value
    expect(result.context.variables.name).toBe("hello world");
    // "prefix" should be gone (scope cleanup restores saved snapshot)
    expect(result.context.variables.prefix).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. forEach with break
// ---------------------------------------------------------------------------

describe("forEach with break", () => {
  it("stops iteration when _break is set", async () => {
    const btn = createButton("Item Action");
    executor.registerElement("text:Item Action", btn.id);

    const chain = new ChainBuilder(executor);

    chain
      .set("items", [1, 2, 3, 4, 5])
      .forEach("items", "n", (b) => {
        b.click({ text: "Item Action" });
        // Break when _index >= 2 (after 3rd iteration: indices 0, 1, 2)
        b._pushStep({
          type: "branch",
          condition: (ctx) => (ctx.variables._index as number) >= 2,
          ifTrue: [{ type: "setVariable", variable: "_break", value: true }],
        });
      });

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // Should have executed 3 clicks (iterations 0, 1, 2)
    expect(executor.executedActions).toHaveLength(3);
    expect(executor.executedActions.every((a) => a.action === "click")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. retryBlock with Transient Failure
// ---------------------------------------------------------------------------

describe("retryBlock with Transient Failure", () => {
  it("succeeds after transient failures within retry limit", async () => {
    const btn = createButton("Retry Target");
    executor.registerElement("text:Retry Target", btn.id);

    // Track attempts via a counter. The first 2 calls to executeAction fail.
    let attemptCount = 0;
    const origExecute = executor.executeAction.bind(executor);
    executor.executeAction = async (
      elementId: string,
      action: string,
      params?: Record<string, unknown>,
    ) => {
      attemptCount++;
      if (attemptCount <= 2) {
        throw new Error("Transient failure");
      }
      return origExecute(elementId, action, params);
    };

    const chain = new ChainBuilder(executor);

    chain.retryBlock(
      (b) => {
        b.click({ text: "Retry Target" });
      },
      { maxAttempts: 5, delayMs: 0 },
    );

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // 3 total attempts: 2 failures + 1 success
    expect(attemptCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Priority with Fallback
// ---------------------------------------------------------------------------

describe("Priority with Fallback", () => {
  it("falls back to a secondary action when the primary element is missing", async () => {
    // Register only the fallback button
    const fallbackBtn = createButton("Fallback");
    executor.registerElement("text:Fallback", fallbackBtn.id);
    // Do NOT register "primary-btn" — findElement will return null for it

    const chain = new ChainBuilder(executor);

    chain.priority(
      // First alternative: click primary (will fail — element not found)
      (b) => b.click({ text: "Primary" }),
      // Second alternative: click fallback (will succeed)
      (b) => b.click({ text: "Fallback" }),
    );

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // Only the fallback click should have succeeded
    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].elementId).toBe(fallbackBtn.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Circuit Breaker Integration
// ---------------------------------------------------------------------------

describe("Circuit Breaker Integration", () => {
  it("opens after threshold failures and skips remaining actions", async () => {
    const btn = createButton("CB Target");
    executor.registerElement("text:CB Target", btn.id);

    // Make executeAction always fail
    executor.executeAction = async () => {
      throw new Error("Persistent failure");
    };

    const cb = new CircuitBreaker({ threshold: 2, resetAfterMs: 60_000 });

    const chain = new ChainBuilder(executor)
      .click({ text: "CB Target" })
      .click({ text: "CB Target" })
      .click({ text: "CB Target" })
      .click({ text: "CB Target" })
      .click({ text: "CB Target" });

    // Execute with stopOnError: false so the chain continues past failures
    const result = await chain.execute({
      stopOnError: false,
      circuitBreaker: cb,
    });

    expect(result.success).toBe(false);

    // Errors breakdown:
    // - 2 errors from actual executeAction failures
    // - 3 errors from circuit breaker open
    const actionErrors = result.context.errors.filter(
      (e) => e.message === "Persistent failure",
    );
    const cbErrors = result.context.errors.filter((e) =>
      e.message.includes("Circuit breaker open"),
    );

    expect(actionErrors).toHaveLength(2);
    expect(cbErrors).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 6. Hooks Lifecycle
// ---------------------------------------------------------------------------

describe("Hooks Lifecycle", () => {
  it("calls hooks in the correct order around each step", async () => {
    const btn = createButton("Hook Btn");
    executor.registerElement("text:Hook Btn", btn.id);

    const input = createMockElement({
      tagName: "input",
      type: "input",
      textContent: "",
      id: "hook-input",
    });
    executor.registerElement("text:Hook Input", input.id);

    const log: string[] = [];

    const hooks: ChainHooks = {
      beforeStep: async (step) => {
        if (step.type === "action") {
          log.push(`before:${step.action}`);
        }
      },
      afterStep: async (step, _ctx, error) => {
        if (step.type === "action") {
          log.push(`after:${step.action}${error ? ":error" : ""}`);
        }
      },
    };

    const chain = new ChainBuilder(executor)
      .withHooks(hooks)
      .click({ text: "Hook Btn" })
      .type({ text: "Hook Input" }, "hello");

    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(log).toEqual([
      "before:click",
      "after:click",
      "before:type",
      "after:type",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 7. runFlow Composition
// ---------------------------------------------------------------------------

describe("runFlow Composition", () => {
  it("executes composed flows in sequence", async () => {
    // Register elements
    const usernameInput = createMockElement({
      tagName: "input",
      type: "input",
      id: "username-input",
    });
    const passwordInput = createMockElement({
      tagName: "input",
      type: "input",
      id: "password-input",
    });
    const submitBtn = createButton("Submit");

    executor.registerElement("text:Username", usernameInput.id);
    executor.registerElement("text:Password", passwordInput.id);
    executor.registerElement("text:Submit", submitBtn.id);

    // Define flows
    const flowRegistry = new FlowRegistry();

    flowRegistry.define({
      name: "fillForm",
      steps: [
        { target: { text: "Username" }, action: "type", params: { value: "admin" } },
        { target: { text: "Password" }, action: "type", params: { value: "secret" } },
      ],
    });

    flowRegistry.define({
      name: "submitForm",
      steps: [
        { target: { text: "Submit" }, action: "click" },
      ],
    });

    const chain = new ChainBuilder(executor, flowRegistry)
      .runFlow("fillForm")
      .runFlow("submitForm");

    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(3);
    expect(executor.executedActions[0]).toMatchObject({
      elementId: usernameInput.id,
      action: "type",
      params: { value: "admin" },
    });
    expect(executor.executedActions[1]).toMatchObject({
      elementId: passwordInput.id,
      action: "type",
      params: { value: "secret" },
    });
    expect(executor.executedActions[2]).toMatchObject({
      elementId: submitBtn.id,
      action: "click",
    });
  });
});

// ---------------------------------------------------------------------------
// 8. waitForChange in Chain
// ---------------------------------------------------------------------------

describe("waitForChange in Chain", () => {
  it("resolves when an element disappears (presence change)", async () => {
    const el = createMockElement({ id: "changing-el", textContent: "Changing" });
    executor.registerElement("text:Changing", el.id);

    // After 2 findElement calls, make the element disappear
    let findCallCount = 0;
    const origFind = executor.findElement.bind(executor);
    executor.findElement = (query) => {
      // Only intercept the specific query for our changing element
      if (query.text === "Changing" || (query.role === undefined && query.ariaLabel === undefined && query.text === "Changing")) {
        findCallCount++;
        if (findCallCount > 2) {
          return null; // Element disappeared
        }
      }
      return origFind(query);
    };

    const chain = new ChainBuilder(executor).waitForChange(
      { text: "Changing" },
      "presence",
      500,
    );

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // findElement was called multiple times; after call 2 it returned null
    expect(findCallCount).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// 9. assertCount + assertRelation
// ---------------------------------------------------------------------------

describe("assertCount + assertRelation", () => {
  it("asserts the correct number of matching elements", async () => {
    // Register 3 buttons
    const btn1 = createButton("Btn 1", { id: "btn-1" });
    const btn2 = createButton("Btn 2", { id: "btn-2" });
    const btn3 = createButton("Btn 3", { id: "btn-3" });

    executor.registerElement("role:button", btn1.id);

    // Override findAllElements to return all 3 buttons for role:button
    executor.findAllElements = (query) => {
      if (query.role === "button") {
        return [{ id: btn1.id }, { id: btn2.id }, { id: btn3.id }];
      }
      return [];
    };

    const chain = new ChainBuilder(executor).assertCount({ role: "button" }, 3);

    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(result.context.errors).toHaveLength(0);
  });

  it("asserts spatial relation between two elements", async () => {
    const topEl = createMockElement({ id: "top-el", textContent: "Top" });
    const bottomEl = createMockElement({ id: "bottom-el", textContent: "Bottom" });

    executor.registerElement("text:Top", topEl.id);
    executor.registerElement("text:Bottom", bottomEl.id);

    // Register rects: top element is above bottom element
    executor.registerRect(topEl.id, { x: 0, y: 0, width: 100, height: 30 });
    executor.registerRect(bottomEl.id, { x: 0, y: 100, width: 100, height: 30 });

    const chain = new ChainBuilder(executor).assertRelation(
      { text: "Top" },
      "above",
      { text: "Bottom" },
    );

    const result = await chain.execute();

    expect(result.success).toBe(true);
    expect(result.context.errors).toHaveLength(0);
  });

  it("fails assertRelation when spatial relation does not hold", async () => {
    const topEl = createMockElement({ id: "top-el-2", textContent: "TopFail" });
    const bottomEl = createMockElement({ id: "bottom-el-2", textContent: "BottomFail" });

    executor.registerElement("text:TopFail", topEl.id);
    executor.registerElement("text:BottomFail", bottomEl.id);

    // Register rects: top element is actually BELOW bottom element
    executor.registerRect(topEl.id, { x: 0, y: 200, width: 100, height: 30 });
    executor.registerRect(bottomEl.id, { x: 0, y: 0, width: 100, height: 30 });

    const chain = new ChainBuilder(executor).assertRelation(
      { text: "TopFail" },
      "above",
      { text: "BottomFail" },
    );

    const result = await chain.execute();

    expect(result.success).toBe(false);
    expect(result.context.errors[0].message).toContain("not above");
  });
});

// ---------------------------------------------------------------------------
// 10. Data-Driven Automation
// ---------------------------------------------------------------------------

describe("Data-Driven Automation", () => {
  it("iterates over a data array and executes actions for each item", async () => {
    const greetBtn = createButton("Greet");
    executor.registerElement("text:Greet", greetBtn.id);

    const chain = new ChainBuilder(executor);

    chain
      .set("users", ["alice", "bob", "charlie"])
      .forEach("users", "user", (b) => {
        // Build a greeting string using a branch to access context
        b._pushStep({
          type: "branch",
          condition: (ctx) => {
            ctx.variables.greeting = `Hello, ${ctx.variables.user}!`;
            return true;
          },
          ifTrue: [],
        });
        b.click({ text: "Greet" });
      });

    const result = await chain.execute();

    expect(result.success).toBe(true);
    // 3 users = 3 clicks
    expect(executor.executedActions).toHaveLength(3);
    expect(executor.executedActions.every((a) => a.action === "click")).toBe(true);
    expect(
      executor.executedActions.every((a) => a.elementId === greetBtn.id),
    ).toBe(true);
  });
});
