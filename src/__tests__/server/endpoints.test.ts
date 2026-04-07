/**
 * Tests for the createAutoHandlers endpoint factory.
 *
 * Uses mock registry and executor to verify each handler validates input,
 * calls the correct module, and returns the standard response shape.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAutoHandlers } from "../../server/endpoints";
import { AutomationEngine } from "../../core/engine";
import {
  MockRegistry,
  MockActionExecutor,
  createButton,
  createInput,
  resetIdCounter,
} from "../../test-utils";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let registry: MockRegistry;
let executor: MockActionExecutor;
let engine: AutomationEngine;
let handlers: ReturnType<typeof createAutoHandlers>;

beforeEach(() => {
  resetIdCounter();
  registry = new MockRegistry();
  executor = new MockActionExecutor();
  engine = new AutomationEngine({ registry, executor });
  handlers = createAutoHandlers({ engine, registry, executor });
});

afterEach(() => {
  engine.dispose();
});

// ---------------------------------------------------------------------------
// Element queries
// ---------------------------------------------------------------------------

describe("findElement", () => {
  it("returns matching element", async () => {
    const btn = createButton("Submit");
    registry.addElement(btn);

    const res = await handlers.findElement({ query: { role: "button" } });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).not.toBeNull();
    }
  });

  it("returns null when no match", async () => {
    const res = await handlers.findElement({ query: { role: "dialog" } });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toBeNull();
    }
  });

  it("returns error for missing query", async () => {
    const res = await handlers.findElement({} as any);
    expect(res.success).toBe(false);
  });
});

describe("findAllElements", () => {
  it("returns all matching elements", async () => {
    registry.addElement(createButton("A"));
    registry.addElement(createButton("B"));

    const res = await handlers.findAllElements({ query: { role: "button" } });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.length).toBe(2);
    }
  });

  it("respects maxResults", async () => {
    registry.addElement(createButton("A"));
    registry.addElement(createButton("B"));

    const res = await handlers.findAllElements({
      query: { role: "button" },
      maxResults: 1,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.length).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

describe("waitForElement", () => {
  it("resolves immediately if element exists", async () => {
    registry.addElement(createButton("Go"));

    const res = await handlers.waitForElement({
      query: { role: "button" },
      timeout: 500,
    });
    expect(res.success).toBe(true);
  });

  it("times out when element does not appear", async () => {
    const res = await handlers.waitForElement({
      query: { role: "dialog" },
      timeout: 50,
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toContain("Timed out");
    }
  });

  it("returns error for missing query", async () => {
    const res = await handlers.waitForElement({} as any);
    expect(res.success).toBe(false);
  });
});

describe("waitForState", () => {
  it("returns error for missing stateId", async () => {
    const res = await handlers.waitForState({} as any);
    expect(res.success).toBe(false);
  });
});

describe("waitForIdle", () => {
  it("resolves immediately with mock executor", async () => {
    const res = await handlers.waitForIdle({ timeout: 1000 });
    expect(res.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

describe("defineStates / getStates round-trip", () => {
  it("defines and retrieves states", async () => {
    const states = [
      {
        id: "login",
        name: "Login Page",
        requiredElements: [{ role: "textbox" }],
      },
    ];

    const defineRes = await handlers.defineStates({ states });
    expect(defineRes.success).toBe(true);
    if (defineRes.success) {
      expect(defineRes.data.count).toBe(1);
    }

    const getRes = await handlers.getStates();
    expect(getRes.success).toBe(true);
    if (getRes.success) {
      expect(getRes.data).toHaveLength(1);
      expect(getRes.data[0].id).toBe("login");
    }
  });

  it("returns error for missing states array", async () => {
    const res = await handlers.defineStates({} as any);
    expect(res.success).toBe(false);
  });
});

describe("getActiveStates", () => {
  it("returns empty array initially", async () => {
    const res = await handlers.getActiveStates();
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

describe("executeSequence", () => {
  it("executes steps", async () => {
    const btn = createButton("Click Me");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);
    const steps = [
      { target: { role: "button" }, action: "click" as const },
    ];

    const res = await handlers.executeSequence({ steps });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].success).toBe(true);
    }
  });

  it("returns error for missing steps", async () => {
    const res = await handlers.executeSequence({} as any);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Flows
// ---------------------------------------------------------------------------

describe("flow lifecycle", () => {
  it("define, list, execute, remove", async () => {
    const btn = createButton("Flow Btn");
    registry.addElement(btn);
    executor.registerElement("role:button", btn.id);

    const flow = {
      name: "test-flow",
      steps: [{ target: { role: "button" }, action: "click" as const }],
    };

    const defineRes = await handlers.defineFlow(flow);
    expect(defineRes.success).toBe(true);
    if (defineRes.success) {
      expect(defineRes.data.name).toBe("test-flow");
    }

    const listRes = await handlers.listFlows();
    expect(listRes.success).toBe(true);
    if (listRes.success) {
      expect(listRes.data).toHaveLength(1);
    }

    const execRes = await handlers.executeFlow({ name: "test-flow" });
    expect(execRes.success).toBe(true);

    const removeRes = await handlers.removeFlow({ name: "test-flow" });
    expect(removeRes.success).toBe(true);
    if (removeRes.success) {
      expect(removeRes.data.removed).toBe(true);
    }

    const listRes2 = await handlers.listFlows();
    if (listRes2.success) {
      expect(listRes2.data).toHaveLength(0);
    }
  });

  it("executeFlow fails for unknown flow", async () => {
    const res = await handlers.executeFlow({ name: "nonexistent" });
    expect(res.success).toBe(false);
  });

  it("defineFlow requires name", async () => {
    const res = await handlers.defineFlow({ steps: [] } as any);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

describe("recording lifecycle", () => {
  it("start, status, stop", async () => {
    const startRes = await handlers.startRecording({ metadata: { test: true } });
    expect(startRes.success).toBe(true);
    if (startRes.success) {
      expect(startRes.data.sessionId).toBeTruthy();
    }

    const statusRes = await handlers.getRecordingStatus();
    expect(statusRes.success).toBe(true);
    if (statusRes.success) {
      expect(statusRes.data.isRecording).toBe(true);
    }

    const stopRes = await handlers.stopRecording();
    expect(stopRes.success).toBe(true);
    if (stopRes.success) {
      expect(stopRes.data.id).toBeTruthy();
      expect(stopRes.data.endedAt).toBeDefined();
    }

    const statusRes2 = await handlers.getRecordingStatus();
    if (statusRes2.success) {
      expect(statusRes2.data.isRecording).toBe(false);
    }
  });

  it("stop fails when not recording", async () => {
    const res = await handlers.stopRecording();
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Graph export
// ---------------------------------------------------------------------------

describe("exportGraph", () => {
  it("returns valid JSON format", async () => {
    engine.defineStates([
      { id: "s1", name: "State 1", requiredElements: [{ role: "button" }] },
    ]);

    const res = await handlers.exportGraph({ format: "json" });
    expect(res.success).toBe(true);
    if (res.success) {
      const parsed = JSON.parse(res.data);
      expect(parsed.states).toBeDefined();
      expect(parsed.metadata).toBeDefined();
    }
  });

  it("returns error for missing format", async () => {
    const res = await handlers.exportGraph({} as any);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("saveStateMachine / loadStateMachine", () => {
  it("saves and loads round-trip", async () => {
    engine.defineStates([
      { id: "page", name: "Page", requiredElements: [{ role: "main" }] },
    ]);

    const saveRes = await handlers.saveStateMachine();
    expect(saveRes.success).toBe(true);

    if (saveRes.success) {
      const loadRes = await handlers.loadStateMachine({ json: saveRes.data });
      expect(loadRes.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Healing
// ---------------------------------------------------------------------------

describe("relocateElement", () => {
  it("returns found=false when element not found", async () => {
    const res = await handlers.relocateElement({ previousId: "missing-id" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.found).toBe(false);
    }
  });

  it("returns error for missing previousId", async () => {
    const res = await handlers.relocateElement({} as any);
    expect(res.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe("generateStableIds", () => {
  it("generates IDs for all elements", async () => {
    registry.addElement(createButton("Go"));
    registry.addElement(createInput("Name"));

    const res = await handlers.generateStableIds();
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toHaveLength(2);
      for (const entry of res.data) {
        expect(entry.elementId).toBeTruthy();
        expect(entry.stableId).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validation", () => {
  it("navigateToState requires targetState", async () => {
    const res = await handlers.navigateToState({} as any);
    expect(res.success).toBe(false);
  });

  it("defineTransitions requires transitions array", async () => {
    const res = await handlers.defineTransitions({} as any);
    expect(res.success).toBe(false);
  });

  it("importGraph requires json", async () => {
    const res = await handlers.importGraph({} as any);
    expect(res.success).toBe(false);
  });

  it("loadStateMachine requires json", async () => {
    const res = await handlers.loadStateMachine({} as any);
    expect(res.success).toBe(false);
  });

  it("replaySession requires session", async () => {
    const res = await handlers.replaySession({} as any);
    expect(res.success).toBe(false);
  });

  it("removeFlow requires name", async () => {
    const res = await handlers.removeFlow({} as any);
    expect(res.success).toBe(false);
  });

  it("executeFlow requires name", async () => {
    const res = await handlers.executeFlow({} as any);
    expect(res.success).toBe(false);
  });
});
