import { describe, it, expect } from "vitest";
import { emitWorkflowConfig, emitWorkflowConfigJSON } from "../../static-builder/output/workflow-emitter";
import { emitPersistedStateMachine, emitPersistedStateMachineJSON } from "../../static-builder/output/persisted-emitter";
import type { StateDefinition, TransitionDefinition } from "../../state/state-machine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const states: StateDefinition[] = [
  {
    id: "tab-dashboard",
    name: "Dashboard",
    requiredElements: [{ role: "main" }],
    group: "pages",
    pathCost: 1,
  },
  {
    id: "tab-settings",
    name: "Settings",
    requiredElements: [{ text: "Settings" }],
    group: "pages",
    pathCost: 1,
  },
];

const transitions: TransitionDefinition[] = [
  {
    id: "tab-dashboard--to--tab-settings",
    name: "Dashboard → Settings",
    fromStates: ["tab-dashboard"],
    activateStates: ["tab-settings"],
    exitStates: ["tab-dashboard"],
    actions: [{ target: { text: "Settings" }, action: "click" }],
    pathCost: 1,
  },
];

// ---------------------------------------------------------------------------
// emitWorkflowConfig
// ---------------------------------------------------------------------------

describe("emitWorkflowConfig", () => {
  it("produces a valid WorkflowConfig", () => {
    const config = emitWorkflowConfig(states, transitions, {
      id: "test-workflow",
      name: "Test Workflow",
    });

    expect(config.id).toBe("test-workflow");
    expect(config.name).toBe("Test Workflow");
    expect(config.version).toBe("1.0.0");
    expect(config.states).toHaveLength(2);
    expect(config.transitions).toHaveLength(1);
    expect(config.initialState).toBe("tab-dashboard");
    expect(config.settings).toBeDefined();
  });

  it("uses custom initialState when provided", () => {
    const config = emitWorkflowConfig(states, transitions, {
      id: "w",
      name: "W",
      initialState: "tab-settings",
    });

    expect(config.initialState).toBe("tab-settings");
  });

  it("maps state fields correctly", () => {
    const config = emitWorkflowConfig(states, transitions, {
      id: "w",
      name: "W",
    });

    const s = config.states[0];
    expect(s.id).toBe("tab-dashboard");
    expect(s.name).toBe("Dashboard");
    expect(s.group).toBe("pages");
    expect(s.pathCost).toBe(1);
  });

  it("maps transition actions with type field", () => {
    const config = emitWorkflowConfig(states, transitions, {
      id: "w",
      name: "W",
    });

    const t = config.transitions[0];
    expect(t.id).toBe("tab-dashboard--to--tab-settings");
    expect(t.actions).toHaveLength(1);
    expect(t.actions[0].type).toBe("click");
  });

  it("merges custom settings", () => {
    const config = emitWorkflowConfig(states, transitions, {
      id: "w",
      name: "W",
      settings: { maxRetries: 5 },
    });

    expect(config.settings.maxRetries).toBe(5);
  });
});

describe("emitWorkflowConfigJSON", () => {
  it("produces valid JSON", () => {
    const json = emitWorkflowConfigJSON(states, transitions, {
      id: "w",
      name: "W",
    });

    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("w");
    expect(parsed.states).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// emitPersistedStateMachine
// ---------------------------------------------------------------------------

describe("emitPersistedStateMachine", () => {
  it("produces a valid PersistedStateMachine", () => {
    const persisted = emitPersistedStateMachine(states, transitions);

    expect(persisted.version).toBe("1.0.0");
    expect(persisted.createdAt).toBeGreaterThan(0);
    expect(persisted.updatedAt).toBeGreaterThanOrEqual(persisted.createdAt);
    expect(persisted.states).toHaveLength(2);
    expect(persisted.transitions).toHaveLength(1);
  });

  it("includes all state definitions", () => {
    const persisted = emitPersistedStateMachine(states, transitions);

    expect(persisted.states[0].id).toBe("tab-dashboard");
    expect(persisted.states[1].id).toBe("tab-settings");
  });

  it("handles empty inputs", () => {
    const persisted = emitPersistedStateMachine([], []);

    expect(persisted.states).toHaveLength(0);
    expect(persisted.transitions).toHaveLength(0);
    expect(persisted.version).toBe("1.0.0");
  });
});

describe("emitPersistedStateMachineJSON", () => {
  it("produces valid JSON compatible with deserialize()", () => {
    const json = emitPersistedStateMachineJSON(states, transitions);

    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.states).toHaveLength(2);
    expect(parsed.transitions).toHaveLength(1);
    expect(parsed.createdAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveConfig validation
// ---------------------------------------------------------------------------

describe("resolveConfig validation", () => {
  it("throws on missing projectRoot", async () => {
    const { resolveConfig } = await import("../../static-builder/config");
    expect(() =>
      resolveConfig({
        projectRoot: "",
        routeFile: "src/App.tsx",
        routeFunction: "App",
        routeDiscriminant: "tab",
        navigationFunctions: ["setTab"],
      }),
    ).toThrow("projectRoot");
  });

  it("throws on missing routeFile", async () => {
    const { resolveConfig } = await import("../../static-builder/config");
    expect(() =>
      resolveConfig({
        projectRoot: "/app",
        routeFile: "",
        routeFunction: "App",
        routeDiscriminant: "tab",
        navigationFunctions: ["setTab"],
      }),
    ).toThrow("routeFile");
  });

  it("throws on empty navigationFunctions", async () => {
    const { resolveConfig } = await import("../../static-builder/config");
    expect(() =>
      resolveConfig({
        projectRoot: "/app",
        routeFile: "src/App.tsx",
        routeFunction: "App",
        routeDiscriminant: "tab",
        navigationFunctions: [],
      }),
    ).toThrow("navigationFunctions");
  });
});
