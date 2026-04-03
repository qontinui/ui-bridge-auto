import { describe, it, expect } from "vitest";
import {
  serialize,
  deserialize,
  mergeStateMachines,
  validate,
} from "../../state/persistence";
import type {
  StateDefinition,
  TransitionDefinition,
} from "../../state/state-machine";
import { ReliabilityTracker } from "../../state/reliability";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const loginState: StateDefinition = {
  id: "login",
  name: "Login Page",
  requiredElements: [{ id: "login-form" }],
};

const dashState: StateDefinition = {
  id: "dashboard",
  name: "Dashboard",
  requiredElements: [{ id: "dash-panel" }],
};

const settingsState: StateDefinition = {
  id: "settings",
  name: "Settings",
  requiredElements: [{ id: "settings-form" }],
};

const loginToDash: TransitionDefinition = {
  id: "login-to-dash",
  name: "Login",
  fromStates: ["login"],
  activateStates: ["dashboard"],
  exitStates: ["login"],
  actions: [{ target: { id: "submit" }, action: "click" }],
};

const dashToSettings: TransitionDefinition = {
  id: "dash-to-settings",
  name: "Open Settings",
  fromStates: ["dashboard"],
  activateStates: ["settings"],
  exitStates: ["dashboard"],
  actions: [{ target: { id: "settings-btn" }, action: "click" }],
};

// ---------------------------------------------------------------------------
// serialize / deserialize
// ---------------------------------------------------------------------------

describe("serialize / deserialize", () => {
  it("round-trip state machine", () => {
    const json = serialize([loginState, dashState], [loginToDash]);
    const restored = deserialize(json);

    expect(restored.states).toHaveLength(2);
    expect(restored.transitions).toHaveLength(1);
    expect(restored.states.find((s) => s.id === "login")?.name).toBe("Login Page");
    expect(restored.transitions[0].id).toBe("login-to-dash");
  });

  it("includes reliability data when provided", () => {
    const tracker = new ReliabilityTracker();
    tracker.record("login-to-dash", true, 100);
    tracker.record("login-to-dash", false, 200);

    const json = serialize([loginState, dashState], [loginToDash], tracker);
    const parsed = JSON.parse(json);

    expect(parsed.reliability).toBeDefined();
    expect(parsed.reliability.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deserialize with reliability
// ---------------------------------------------------------------------------

describe("deserialize with reliability", () => {
  it("reconstructs ReliabilityTracker", () => {
    const tracker = new ReliabilityTracker();
    tracker.record("login-to-dash", true, 100);
    tracker.record("login-to-dash", true, 100);
    tracker.record("login-to-dash", false, 200);

    const json = serialize([loginState, dashState], [loginToDash], tracker);
    const restored = deserialize(json);

    expect(restored.reliability).toBeDefined();
    if (restored.reliability) {
      const record = restored.reliability.get("login-to-dash");
      expect(record).toBeDefined();
      expect(record!.successCount).toBe(2);
      expect(record!.failureCount).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeStateMachines
// ---------------------------------------------------------------------------

describe("mergeStateMachines", () => {
  it("manual wins on conflict", () => {
    const manual = {
      states: [{ ...loginState, name: "Login (manual)" }],
      transitions: [loginToDash],
    };
    const discovered = {
      states: [{ ...loginState, name: "Login (discovered)" }],
      transitions: [loginToDash],
    };

    const merged = mergeStateMachines(manual, discovered);
    expect(merged.states.find((s) => s.id === "login")?.name).toBe("Login (manual)");
  });

  it("adds discovered states not in manual", () => {
    const manual = { states: [loginState], transitions: [] as TransitionDefinition[] };
    const discovered = {
      states: [dashState, settingsState],
      transitions: [dashToSettings],
    };

    const merged = mergeStateMachines(manual, discovered);
    expect(merged.states).toHaveLength(3);
    expect(merged.states.find((s) => s.id === "dashboard")).toBeDefined();
    expect(merged.states.find((s) => s.id === "settings")).toBeDefined();
    expect(merged.transitions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("validate", () => {
  it("returns valid for correct data", () => {
    const json = serialize([loginState, dashState], [loginToDash]);
    const data = JSON.parse(json);
    const result = validate(data);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for missing states in transitions", () => {
    const json = serialize([loginState], [loginToDash]); // dashboard missing
    const data = JSON.parse(json);
    const result = validate(data);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
