/**
 * Integration tests for the enhanced AutomationEngine.
 *
 * Tests the engine constructor, subsystem wiring, state management,
 * element queries, recording, persistence, and cleanup.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationEngine, type EngineConfig } from "../../core/engine";
import {
  MockRegistry,
  MockActionExecutor,
  createButton,
  createInput,
  createLink,
  resetIdCounter,
} from "../../test-utils";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let registry: MockRegistry;
let executor: MockActionExecutor;
let engine: AutomationEngine;

beforeEach(() => {
  resetIdCounter();
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
// Constructor
// ---------------------------------------------------------------------------

describe("constructor", () => {
  it("creates all subsystems", () => {
    expect(engine.stateMachine).toBeDefined();
    expect(engine.stateDetector).toBeDefined();
    expect(engine.reliabilityTracker).toBeDefined();
    expect(engine.flowRegistry).toBeDefined();
    expect(engine.recorder).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// State definitions
// ---------------------------------------------------------------------------

describe("defineStates + defineTransitions", () => {
  it("wires state machine and detector", () => {
    const btn = createButton("Login");
    registry.addElement(btn);

    engine.defineStates([
      {
        id: "login-page",
        name: "Login Page",
        requiredElements: [{ role: "button" }],
      },
    ]);

    // The detector should have evaluated and activated the state
    expect(engine.getActiveStates().has("login-page")).toBe(true);
    expect(engine.isActive("login-page")).toBe(true);
  });

  it("registers transitions", () => {
    engine.defineTransitions([
      {
        id: "t1",
        name: "Login",
        fromStates: ["login-page"],
        activateStates: ["dashboard"],
        exitStates: ["login-page"],
        actions: [{ target: { role: "button" }, action: "click" }],
      },
    ]);

    const defs = engine.stateMachine.getTransitionDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].id).toBe("t1");
  });
});

// ---------------------------------------------------------------------------
// Element queries
// ---------------------------------------------------------------------------

describe("findElement", () => {
  it("finds element using registry", () => {
    registry.addElement(createButton("Submit"));

    const result = engine.findElement({ role: "button" });
    expect(result).not.toBeNull();
  });

  it("returns null when no match", () => {
    const result = engine.findElement({ role: "dialog" });
    expect(result).toBeNull();
  });
});

describe("findAllElements", () => {
  it("returns all matching elements", () => {
    registry.addElement(createButton("A"));
    registry.addElement(createButton("B"));

    const results = engine.findAllElements({ role: "button" });
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Waiting
// ---------------------------------------------------------------------------

describe("waitForElement", () => {
  it("resolves immediately if element exists", async () => {
    registry.addElement(createButton("Go"));
    const result = await engine.waitForElement({ role: "button" }, 500);
    expect(result).not.toBeNull();
  });

  it("times out when element never appears", async () => {
    await expect(
      engine.waitForElement({ role: "dialog" }, 50),
    ).rejects.toThrow("Timed out");
  });
});

describe("waitForState", () => {
  it("resolves immediately if state is active", async () => {
    registry.addElement(createButton("X"));
    engine.defineStates([
      {
        id: "active-state",
        name: "Active",
        requiredElements: [{ role: "button" }],
      },
    ]);

    await engine.waitForState("active-state", 500);
    // No throw means success
  });

  it("times out for inactive state", async () => {
    engine.defineStates([
      {
        id: "missing-state",
        name: "Missing",
        requiredElements: [{ role: "dialog" }],
      },
    ]);

    await expect(
      engine.waitForState("missing-state", 50),
    ).rejects.toThrow("Timed out");
  });
});

describe("waitForIdle", () => {
  it("resolves with mock executor", async () => {
    await engine.waitForIdle(500);
    // Should resolve without error
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigateToState", () => {
  it("navigates and records reliability", async () => {
    registry.addElement(createButton("Login"));
    executor.registerElement("role:button", "btn-1");

    engine.defineStates([
      {
        id: "login",
        name: "Login",
        requiredElements: [{ role: "button" }],
      },
      {
        id: "dashboard",
        name: "Dashboard",
        requiredElements: [{ role: "main" }],
      },
    ]);

    engine.defineTransitions([
      {
        id: "t-login",
        name: "Do Login",
        fromStates: ["login"],
        activateStates: ["dashboard"],
        exitStates: ["login"],
        actions: [{ target: { role: "button" }, action: "click" }],
      },
    ]);

    const result = await engine.navigateToState("dashboard");
    expect(result.path).toHaveLength(1);
    expect(result.strategy).toBe("dijkstra");

    // Reliability should have been recorded
    const rate = engine.reliabilityTracker.successRate("t-login");
    expect(rate).toBe(1.0);
  });

  it("recovers mid-path by re-planning via alternate transition", async () => {
    const btn = createButton("Start");
    const link = createLink("Go", "/next");
    registry.addElement(btn);
    registry.addElement(link);
    executor.registerElement("role:button", btn.id);
    executor.registerElement("role:link", link.id);

    engine.defineStates([
      {
        id: "stateA",
        name: "State A",
        requiredElements: [{ role: "button" }],
      },
      {
        id: "stateB",
        name: "State B",
        requiredElements: [{ role: "heading" }],
      },
    ]);

    // Two transitions to the same target — first one (lower cost) will be
    // tried first, fails, then recovery picks the second one.
    engine.defineTransitions([
      {
        id: "t-primary",
        name: "Primary Route",
        fromStates: ["stateA"],
        activateStates: ["stateB"],
        exitStates: ["stateA"],
        actions: [{ target: { role: "button" }, action: "click" }],
        pathCost: 1,
      },
      {
        id: "t-alternate",
        name: "Alternate Route",
        fromStates: ["stateA"],
        activateStates: ["stateB"],
        exitStates: ["stateA"],
        actions: [{ target: { role: "link" }, action: "click" }],
        pathCost: 2,
      },
    ]);

    // Make the primary route fail, alternate succeeds
    let callCount = 0;
    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      callCount++;
      if (id === btn.id) throw new Error("primary route failed");
      return originalExec(id, action, params);
    };

    const result = await engine.navigateToState("stateB");

    // Recovery should have excluded t-primary and used t-alternate
    expect(result).toBeDefined();
    expect(callCount).toBe(2); // first failed, second succeeded
  });

  it("recovers when target is already reached after partial progress", async () => {
    const btn = createButton("Go");
    const heading = createInput("Title");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);

    engine.defineStates([
      {
        id: "start",
        name: "Start",
        requiredElements: [{ role: "button" }],
      },
      {
        id: "target",
        name: "Target",
        requiredElements: [{ role: "textbox" }],
      },
    ]);

    engine.defineTransitions([
      {
        id: "t-go",
        name: "Go to Target",
        fromStates: ["start"],
        activateStates: ["target"],
        exitStates: ["start"],
        actions: [{ target: { role: "button" }, action: "click" }],
      },
    ]);

    // The action "succeeds" but we make it throw to trigger recovery.
    // After recovery, we add the target-required element so the state detector
    // finds the target is active.
    let threw = false;
    const originalExec = executor.executeAction.bind(executor);
    executor.executeAction = async (id, action, params) => {
      if (!threw) {
        threw = true;
        // Simulate: action partially worked, target element now exists
        registry.addElement(heading);
        engine.stateDetector.evaluate();
        throw new Error("transient");
      }
      return originalExec(id, action, params);
    };

    const result = await engine.navigateToState("target");

    // Recovery detected target is active, no re-plan needed
    expect(result).toBeDefined();
  });

  it("throws when all paths exhausted", async () => {
    const btn = createButton("Fail");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);

    engine.defineStates([
      {
        id: "here",
        name: "Here",
        requiredElements: [{ role: "button" }],
      },
      {
        id: "there",
        name: "There",
        requiredElements: [{ role: "heading" }],
      },
    ]);

    engine.defineTransitions([
      {
        id: "t-fail",
        name: "Always Fails",
        fromStates: ["here"],
        activateStates: ["there"],
        exitStates: ["here"],
        actions: [{ target: { role: "button" }, action: "click" }],
      },
    ]);

    // Make action always fail — only one transition exists, so recovery
    // excludes it and no more paths remain.
    executor.executeAction = async () => { throw new Error("always fails"); };

    await expect(
      engine.navigateToState("there"),
    ).rejects.toThrow("always fails");
  });

  it("can disable recovery with recovery: false", async () => {
    const btn = createButton("NoRecover");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);

    engine.defineStates([
      {
        id: "origin",
        name: "Origin",
        requiredElements: [{ role: "button" }],
      },
      {
        id: "dest",
        name: "Dest",
        requiredElements: [{ role: "heading" }],
      },
    ]);

    engine.defineTransitions([
      {
        id: "t-no-recover",
        name: "No Recover",
        fromStates: ["origin"],
        activateStates: ["dest"],
        exitStates: ["origin"],
        actions: [{ target: { role: "button" }, action: "click" }],
      },
    ]);

    executor.executeAction = async () => { throw new Error("fail"); };

    await expect(
      engine.navigateToState("dest", { recovery: false }),
    ).rejects.toThrow("fail");
  });
});

// ---------------------------------------------------------------------------
// Sequence execution
// ---------------------------------------------------------------------------

describe("executeSequence", () => {
  it("executes steps", async () => {
    const btn = createButton("Click Me");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);
    const results = await engine.executeSequence([
      { target: { role: "button" }, action: "click" },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
  });

  it("records to active recording session", async () => {
    const btn2 = createButton("Record Btn");
    registry.addElement(btn2);
    executor.registerElement("role:button", btn2.id);
    engine.startRecording();

    await engine.executeSequence([
      { target: { role: "button" }, action: "click" },
    ]);

    const session = engine.stopRecording();
    expect(session.events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe("recording lifecycle", () => {
  it("starts and stops recording", () => {
    const sessionId = engine.startRecording({ test: true });
    expect(sessionId).toBeTruthy();
    expect(engine.recorder.isRecording).toBe(true);

    const session = engine.stopRecording();
    expect(session.id).toBe(sessionId);
    expect(session.endedAt).toBeDefined();
    expect(engine.recorder.isRecording).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("serialize / deserialize", () => {
  it("round-trips state machine definitions", () => {
    engine.defineStates([
      {
        id: "page-a",
        name: "Page A",
        requiredElements: [{ role: "main" }],
      },
    ]);
    engine.defineTransitions([
      {
        id: "t-a",
        name: "Nav A",
        fromStates: ["page-a"],
        activateStates: ["page-b"],
        exitStates: ["page-a"],
        actions: [],
      },
    ]);

    const json = engine.serialize();
    expect(json).toBeTruthy();

    // Create a fresh engine and deserialize into it
    const engine2 = new AutomationEngine({ registry, executor });
    engine2.deserialize(json);

    const states = engine2.stateMachine.getAllStateDefinitions();
    expect(states).toHaveLength(1);
    expect(states[0].id).toBe("page-a");

    const transitions = engine2.stateMachine.getTransitionDefinitions();
    expect(transitions).toHaveLength(1);

    engine2.dispose();
  });
});

// ---------------------------------------------------------------------------
// Graph export
// ---------------------------------------------------------------------------

describe("exportGraph", () => {
  it("produces valid JSON", () => {
    engine.defineStates([
      { id: "s1", name: "S1", requiredElements: [{ role: "button" }] },
    ]);

    const json = engine.exportGraph("json");
    const parsed = JSON.parse(json);
    expect(parsed.states).toBeDefined();
    expect(parsed.states).toHaveLength(1);
    expect(parsed.metadata.stateCount).toBe(1);
  });

  it("produces valid mermaid format", () => {
    engine.defineStates([
      { id: "s1", name: "S1", requiredElements: [] },
    ]);

    const mermaid = engine.exportGraph("mermaid");
    expect(mermaid).toContain("stateDiagram");
  });
});

// ---------------------------------------------------------------------------
// Dispose
// ---------------------------------------------------------------------------

describe("dispose", () => {
  it("cleans up detector and stops recording", () => {
    engine.startRecording();
    expect(engine.recorder.isRecording).toBe(true);

    engine.dispose();
    expect(engine.recorder.isRecording).toBe(false);
  });

  it("can be called multiple times safely", () => {
    engine.dispose();
    engine.dispose();
    // No throw
  });
});
