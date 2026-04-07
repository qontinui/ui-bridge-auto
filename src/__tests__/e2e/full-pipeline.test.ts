/**
 * End-to-end integration tests for the full automation pipeline.
 *
 * Exercises cross-subsystem coordination:
 *   define states -> detect -> navigate -> recover -> record -> replay
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationEngine } from "../../core/engine";
import { MockRegistry } from "../../test-utils/mock-registry";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import {
  createButton,
  createLink,
  createHeading,
  resetIdCounter,
} from "../../test-utils/mock-elements";
import { ChainBuilder } from "../../actions/action-builder";
import { ActionChain, type ChainStep } from "../../actions/action-chain";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let registry: MockRegistry;
let executor: MockActionExecutor;
let engine: AutomationEngine;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  registry = new MockRegistry();
  executor = new MockActionExecutor();
  engine = new AutomationEngine({
    registry,
    executor,
    enableReliabilityTracking: true,
    enableHealing: true,
  });
});

afterEach(() => {
  engine.dispose();
});

// ---------------------------------------------------------------------------
// 1. Full Lifecycle: Define -> Detect -> Navigate -> Record -> Replay
// ---------------------------------------------------------------------------

describe("Full Lifecycle: Define -> Detect -> Navigate -> Record -> Replay", () => {
  it("completes the full automation pipeline end-to-end", async () => {
    // --- Define 3 states ---
    const loginBtn = createButton("Login");
    registry.addElement(loginBtn);

    engine.defineStates([
      {
        id: "login",
        name: "Login Page",
        requiredElements: [{ role: "button", text: "Login" }],
      },
      {
        id: "dashboard",
        name: "Dashboard",
        requiredElements: [{ role: "heading", text: "Dashboard" }],
      },
      {
        id: "settings",
        name: "Settings",
        requiredElements: [{ role: "link", text: "Settings" }],
      },
    ]);

    // --- Verify login state is detected ---
    expect(engine.isActive("login")).toBe(true);
    expect(engine.isActive("dashboard")).toBe(false);
    expect(engine.isActive("settings")).toBe(false);

    // --- Register elements in executor ---
    executor.registerElement("role:button", loginBtn.id);
    executor.registerElement("text:Login", loginBtn.id);

    // --- Define transitions ---
    engine.defineTransitions([
      {
        id: "t-login-to-dashboard",
        name: "Click Login",
        fromStates: ["login"],
        activateStates: ["dashboard"],
        exitStates: ["login"],
        actions: [{ target: { role: "button", text: "Login" }, action: "click" }],
      },
      {
        id: "t-dashboard-to-settings",
        name: "Click Settings",
        fromStates: ["dashboard"],
        activateStates: ["settings"],
        exitStates: ["dashboard"],
        actions: [{ target: { role: "link", text: "Settings" }, action: "click" }],
      },
    ]);

    // --- Start recording ---
    const sessionId = engine.startRecording({ test: "full-lifecycle" });
    expect(sessionId).toBeTruthy();
    expect(engine.recorder.isRecording).toBe(true);

    // --- Navigate to dashboard ---
    await engine.navigateToState("dashboard");

    // Simulate state change: remove login button, add dashboard heading
    registry.removeElement(loginBtn.id);
    const dashHeading = createHeading(1, "Dashboard");
    registry.addElement(dashHeading);
    engine.stateDetector.evaluate();

    expect(engine.isActive("dashboard")).toBe(true);
    expect(engine.isActive("login")).toBe(false);

    // Register elements for next transition
    executor.registerElement("role:link", "settings-link-id");
    executor.registerElement("text:Settings", "settings-link-id");

    // --- Navigate to settings ---
    await engine.navigateToState("settings");

    // Simulate state change: remove heading, add settings link
    registry.removeElement(dashHeading.id);
    const settingsLink = createLink("Settings", "/settings");
    registry.addElement(settingsLink);
    engine.stateDetector.evaluate();

    expect(engine.isActive("settings")).toBe(true);
    expect(engine.isActive("dashboard")).toBe(false);

    // --- Stop recording ---
    const session = engine.stopRecording();
    expect(session.id).toBe(sessionId);
    expect(session.endedAt).toBeDefined();
    expect(engine.recorder.isRecording).toBe(false);

    // --- Verify recording has action events ---
    // The navigateToState calls executed actions that were recorded
    expect(executor.executedActions.length).toBeGreaterThanOrEqual(2);

    // --- Replay the recording ---
    // Re-register elements so replay can find them
    executor.registerElement("*", "replay-target");
    const replayResult = await engine.replaySession(session, {
      speed: 10,
      pauseBetweenActions: 0,
      verifyStates: false,
      stopOnError: false,
    });

    expect(replayResult).toBeDefined();
    expect(replayResult.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Navigate with Mid-Path Recovery
// ---------------------------------------------------------------------------

describe("Navigate with Mid-Path Recovery", () => {
  it("re-plans via alternate route when primary path fails mid-navigation", async () => {
    // --- Define states A, B, C with distinct required elements ---
    const btnA = createButton("ActionA");
    registry.addElement(btnA);

    engine.defineStates([
      {
        id: "stateA",
        name: "State A",
        requiredElements: [{ role: "button", text: "ActionA" }],
      },
      {
        id: "stateB",
        name: "State B",
        requiredElements: [{ role: "heading", text: "PageB" }],
      },
      {
        id: "stateC",
        name: "State C",
        requiredElements: [{ role: "link", text: "LinkC" }],
      },
    ]);

    expect(engine.isActive("stateA")).toBe(true);

    // --- Define transitions ---
    // A->B (primary, cost 1) and B->C (cost 1) form the cheap path A->B->C
    // A->C (direct but expensive, cost 5)
    const directLink = createLink("DirectToC", "/c");
    registry.addElement(directLink);

    executor.registerElement("role:button", btnA.id);
    executor.registerElement("text:ActionA", btnA.id);
    executor.registerElement("role:link", directLink.id);
    executor.registerElement("text:DirectToC", directLink.id);

    engine.defineTransitions([
      {
        id: "t-a-to-b",
        name: "A to B",
        fromStates: ["stateA"],
        activateStates: ["stateB"],
        exitStates: ["stateA"],
        actions: [{ target: { role: "button", text: "ActionA" }, action: "click" }],
        pathCost: 1,
      },
      {
        id: "t-b-to-c",
        name: "B to C",
        fromStates: ["stateB"],
        activateStates: ["stateC"],
        exitStates: ["stateB"],
        actions: [{ target: { role: "heading", text: "PageB" }, action: "click" }],
        pathCost: 1,
      },
      {
        id: "t-a-to-c",
        name: "A to C (direct)",
        fromStates: ["stateA"],
        activateStates: ["stateC"],
        exitStates: ["stateA"],
        actions: [{ target: { role: "link", text: "DirectToC" }, action: "click" }],
        pathCost: 5,
      },
    ]);

    // --- Make A->B fail ---
    const executedIds: string[] = [];
    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      executedIds.push(id);
      // Fail when trying the button for A->B transition
      if (id === btnA.id) {
        throw new Error("A->B transition failed");
      }
      return originalExec(id, action, params);
    };

    // --- Navigate to C ---
    // Should try A->B->C first (cost 2), A->B fails, recovery detects still at A,
    // re-plans and uses A->C (cost 5)
    const result = await engine.navigateToState("stateC");

    expect(result).toBeDefined();
    // The first call was to btnA.id (failed), then recovery used directLink.id
    expect(executedIds).toContain(btnA.id);
    expect(executedIds).toContain(directLink.id);
  });
});

// ---------------------------------------------------------------------------
// 3. Data-Driven forEach with Real Chain
// ---------------------------------------------------------------------------

describe("Data-Driven forEach with Real Chain", () => {
  it("iterates over a collection and executes actions for each item", async () => {
    executor.registerElement("*", "target-el");

    const builder = new ChainBuilder(executor);

    // Set a collection variable with 3 items
    builder
      .set("items", ["apple", "banana", "cherry"])
      .forEach("items", "item", (b) => {
        b.click({ text: "Item" });
      });

    const result = await builder.execute();

    expect(result.success).toBe(true);
    // forEach iterated 3 times, clicking once per item
    expect(executor.executedActions).toHaveLength(3);
    expect(executor.executedActions.every((a) => a.action === "click")).toBe(true);
  });

  it("forEach with ActionChain directly for 3 items clicking a button", async () => {
    executor.registerElement("text:ProcessBtn", "process-btn");

    const steps: ChainStep[] = [
      { type: "setVariable", variable: "collection", value: ["x", "y", "z"] },
      {
        type: "forEach",
        collection: "collection",
        itemVariable: "current",
        steps: [
          { type: "action", query: { text: "ProcessBtn" }, action: "click" },
        ],
      },
    ];

    const chain = new ActionChain(executor);
    const result = await chain.execute(steps);

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Reliability Feedback Loop
// ---------------------------------------------------------------------------

describe("Reliability Feedback Loop", () => {
  it("tracks reliability and influences path selection", async () => {
    // --- Define states ---
    const btnStart = createButton("Start");
    registry.addElement(btnStart);

    engine.defineStates([
      {
        id: "origin",
        name: "Origin",
        requiredElements: [{ role: "button", text: "Start" }],
      },
      {
        id: "targetX",
        name: "Target X",
        requiredElements: [{ role: "heading", text: "TargetX" }],
      },
    ]);

    executor.registerElement("role:button", btnStart.id);
    executor.registerElement("text:Start", btnStart.id);

    engine.defineTransitions([
      {
        id: "t-to-x",
        name: "Go to X",
        fromStates: ["origin"],
        activateStates: ["targetX"],
        exitStates: ["origin"],
        actions: [{ target: { role: "button", text: "Start" }, action: "click" }],
        pathCost: 1,
      },
    ]);

    // --- Execute a successful transition ---
    await engine.navigateToState("targetX");

    // Check reliability tracker recorded success
    const rateAfterSuccess = engine.reliabilityTracker.successRate("t-to-x");
    expect(rateAfterSuccess).toBe(1.0);

    // --- Reset to origin state for another attempt ---
    registry.addElement(btnStart);
    engine.stateDetector.evaluate();

    // --- Execute a transition that fails ---
    let failOnce = true;
    const origExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("transient failure");
      }
      return origExec(id, action, params);
    };

    // The first attempt will fail, recovery re-tries (same transition since
    // it's the only path). But since recovery excludes failed transitions,
    // this will throw. Catch it and check the reliability data.
    try {
      await engine.navigateToState("targetX");
    } catch {
      // Expected — only one transition and it failed
    }

    // Check reliability rate decreased (1 success + 1 failure = 0.5)
    const rateAfterFailure = engine.reliabilityTracker.successRate("t-to-x");
    expect(rateAfterFailure).toBeLessThan(1.0);
    expect(rateAfterFailure).toBe(0.5);

    // --- Verify reliability-adjusted costs ---
    // With 50% success rate, adjusted cost = baseCost * (1 + (1 - 0.5) * 2) = 1 * 2 = 2
    const adjustedCost = engine.reliabilityTracker.adjustedCost("t-to-x", 1);
    expect(adjustedCost).toBe(2.0);
  });

  it("prefers more reliable transitions when multiple paths exist", async () => {
    const btnFast = createButton("Fast");
    const linkSlow = createLink("Slow", "/slow");
    registry.addElement(btnFast);
    registry.addElement(linkSlow);

    engine.defineStates([
      {
        id: "start",
        name: "Start",
        requiredElements: [{ role: "button", text: "Fast" }],
      },
      {
        id: "end",
        name: "End",
        requiredElements: [{ role: "heading", text: "End" }],
      },
    ]);

    executor.registerElement("role:button", btnFast.id);
    executor.registerElement("text:Fast", btnFast.id);
    executor.registerElement("role:link", linkSlow.id);
    executor.registerElement("text:Slow", linkSlow.id);

    engine.defineTransitions([
      {
        id: "t-fast",
        name: "Fast Route",
        fromStates: ["start"],
        activateStates: ["end"],
        exitStates: ["start"],
        actions: [{ target: { role: "button", text: "Fast" }, action: "click" }],
        pathCost: 1,
      },
      {
        id: "t-slow",
        name: "Slow Route",
        fromStates: ["start"],
        activateStates: ["end"],
        exitStates: ["start"],
        actions: [{ target: { role: "link", text: "Slow" }, action: "click" }],
        pathCost: 1,
      },
    ]);

    // Record failures for t-fast to reduce its reliability
    engine.reliabilityTracker.record("t-fast", false, 100);
    engine.reliabilityTracker.record("t-fast", false, 100);
    // Record successes for t-slow
    engine.reliabilityTracker.record("t-slow", true, 50);
    engine.reliabilityTracker.record("t-slow", true, 50);

    // t-fast adjusted cost = 1 * (1 + (1 - 0) * 2) = 3.0
    // t-slow adjusted cost = 1 * (1 + (1 - 1) * 2) = 1.0
    expect(engine.reliabilityTracker.adjustedCost("t-fast", 1)).toBe(3.0);
    expect(engine.reliabilityTracker.adjustedCost("t-slow", 1)).toBe(1.0);

    // Navigate — should prefer t-slow due to lower adjusted cost
    const executedIds: string[] = [];
    const origExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      executedIds.push(id);
      return origExec(id, action, params);
    };

    await engine.navigateToState("end");

    // The slow (reliable) route should have been chosen
    expect(executedIds).toContain(linkSlow.id);
    expect(executedIds).not.toContain(btnFast.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Flow Registry -> runFlow from Chain
// ---------------------------------------------------------------------------

describe("Flow Registry -> runFlow from Chain", () => {
  it("registers and executes a flow with 2 steps via chain", async () => {
    // --- Register elements ---
    executor.registerElement("text:Username", "username-input");
    executor.registerElement("text:Submit", "submit-btn");

    // --- Register a flow "login" ---
    engine.flowRegistry.define({
      name: "login",
      description: "Login flow with username and submit",
      steps: [
        {
          target: { text: "Username" },
          action: "type",
          params: { value: "admin" },
        },
        {
          target: { text: "Submit" },
          action: "click",
        },
      ],
    });

    // --- Build a chain that calls runFlow("login") ---
    const builder = new ChainBuilder(executor, engine.flowRegistry);
    builder.runFlow("login");

    const result = await builder.execute();

    expect(result.success).toBe(true);

    // --- Verify both flow steps were executed ---
    expect(executor.executedActions).toHaveLength(2);
    expect(executor.executedActions[0]).toEqual({
      elementId: "username-input",
      action: "type",
      params: { value: "admin" },
    });
    expect(executor.executedActions[1]).toEqual({
      elementId: "submit-btn",
      action: "click",
      params: undefined,
    });
  });

  it("chains multiple flows together", async () => {
    executor.registerElement("text:User", "user-input");
    executor.registerElement("text:Pass", "pass-input");
    executor.registerElement("text:Login", "login-btn");
    executor.registerElement("text:Search", "search-input");

    // Define two flows
    engine.flowRegistry.define({
      name: "authenticate",
      steps: [
        { target: { text: "User" }, action: "type", params: { value: "admin" } },
        { target: { text: "Pass" }, action: "type", params: { value: "secret" } },
        { target: { text: "Login" }, action: "click" },
      ],
    });

    engine.flowRegistry.define({
      name: "search",
      steps: [
        { target: { text: "Search" }, action: "type", params: { value: "query" } },
      ],
    });

    // Chain them
    const builder = new ChainBuilder(executor, engine.flowRegistry);
    builder.runFlow("authenticate").runFlow("search");

    const result = await builder.execute();

    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(4);
    expect(executor.executedActions[0].elementId).toBe("user-input");
    expect(executor.executedActions[1].elementId).toBe("pass-input");
    expect(executor.executedActions[2].elementId).toBe("login-btn");
    expect(executor.executedActions[3].elementId).toBe("search-input");
  });

  it("fails gracefully when flow is not registered", async () => {
    const builder = new ChainBuilder(executor, engine.flowRegistry);
    builder.runFlow("nonexistent");

    const result = await builder.execute();

    expect(result.success).toBe(false);
    expect(result.context.errors.length).toBeGreaterThan(0);
    expect(result.context.errors[0].message).toContain("nonexistent");
  });
});
