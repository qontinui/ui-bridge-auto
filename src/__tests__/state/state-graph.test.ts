import { describe, it, expect } from "vitest";
import {
  exportGraph,
  importGraph,
  toMermaid,
  toDot,
} from "../../state/state-graph";
import type {
  StateDefinition,
  TransitionDefinition,
} from "../../state/state-machine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const states: StateDefinition[] = [
  { id: "login", name: "Login Page", requiredElements: [{ id: "login-form" }] },
  { id: "dashboard", name: "Dashboard", requiredElements: [{ id: "dash-panel" }] },
  { id: "settings", name: "Settings", requiredElements: [{ id: "settings-form" }] },
];

const transitions: TransitionDefinition[] = [
  {
    id: "login-to-dash",
    name: "Login",
    fromStates: ["login"],
    activateStates: ["dashboard"],
    exitStates: ["login"],
    actions: [{ target: { id: "submit" }, action: "click" }],
  },
  {
    id: "dash-to-settings",
    name: "Open Settings",
    fromStates: ["dashboard"],
    activateStates: ["settings"],
    exitStates: ["dashboard"],
    actions: [{ target: { id: "settings-btn" }, action: "click" }],
  },
];

// ---------------------------------------------------------------------------
// exportGraph
// ---------------------------------------------------------------------------

describe("exportGraph", () => {
  it("produces valid JSON with states and transitions", () => {
    const result = exportGraph(states, transitions, "json");
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty("states");
    expect(parsed).toHaveProperty("transitions");
    expect(parsed.states).toHaveLength(3);
    expect(parsed.transitions).toHaveLength(2);
    expect(parsed.states[0]).toHaveProperty("id");
    expect(parsed.transitions[0]).toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// importGraph
// ---------------------------------------------------------------------------

describe("importGraph", () => {
  it("round-trip from exported JSON", () => {
    const exported = exportGraph(states, transitions, "json");
    const imported = importGraph(exported);

    expect(imported.states).toHaveLength(3);
    expect(imported.transitions).toHaveLength(2);
    expect(imported.states.map((s) => s.id)).toEqual(
      expect.arrayContaining(["login", "dashboard", "settings"]),
    );
    expect(imported.transitions.map((t) => t.id)).toEqual(
      expect.arrayContaining(["login-to-dash", "dash-to-settings"]),
    );
  });
});

// ---------------------------------------------------------------------------
// toMermaid
// ---------------------------------------------------------------------------

describe("toMermaid", () => {
  it("produces valid Mermaid syntax with state diagram", () => {
    const mermaid = toMermaid(states, transitions);

    expect(mermaid).toContain("stateDiagram");
    // Should contain state declarations
    expect(mermaid).toContain("login");
    expect(mermaid).toContain("dashboard");
    expect(mermaid).toContain("settings");
    // Should contain transitions (arrows)
    expect(mermaid).toContain("-->");
  });
});

// ---------------------------------------------------------------------------
// toDot
// ---------------------------------------------------------------------------

describe("toDot", () => {
  it("produces valid DOT syntax with digraph", () => {
    const dot = toDot(states, transitions);

    expect(dot).toContain("digraph");
    expect(dot).toContain("{");
    expect(dot).toContain("}");
    // Should contain state nodes
    expect(dot).toContain("login");
    expect(dot).toContain("dashboard");
    expect(dot).toContain("settings");
    // Should contain edges (arrows)
    expect(dot).toContain("->");
  });
});
