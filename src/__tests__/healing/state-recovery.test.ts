import { describe, it, expect, beforeEach } from "vitest";
import { StateRecovery } from "../../healing/state-recovery";
import { StateMachine } from "../../state/state-machine";
import type { StateDetector } from "../../state/state-detector";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createInput,
  resetIdCounter,
} from "../../test-utils/mock-elements";

let machine: StateMachine;
let registry: MockRegistry;
let recovery: StateRecovery;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  machine = new StateMachine();
  registry = new MockRegistry();

  // Define states
  machine.defineStates([
    {
      id: "login",
      name: "Login Page",
      requiredElements: [{ tagName: "input" }],
    },
    {
      id: "dashboard",
      name: "Dashboard",
      requiredElements: [{ role: "button" }],
    },
  ]);

  // Define transitions
  machine.defineTransitions([
    {
      id: "login-to-dash",
      name: "Login to Dashboard",
      fromStates: ["login"],
      activateStates: ["dashboard"],
      exitStates: ["login"],
      actions: [{ target: { tagName: "button" }, action: "click" }],
    },
  ]);

  // Use null as stateDetector since we use our own detection logic
  recovery = new StateRecovery(machine, null as unknown as StateDetector, registry);
});

describe("StateRecovery", () => {
  it("detects current state from registry elements", () => {
    const btn = createButton("Go");
    registry.addElement(btn);

    const states = recovery.detectCurrentState();
    expect(states.has("dashboard")).toBe(true);
    expect(states.has("login")).toBe(false);
  });

  it("detects login state when input is present", () => {
    const input = createInput("Username");
    registry.addElement(input);

    const states = recovery.detectCurrentState();
    expect(states.has("login")).toBe(true);
  });

  it("recover reports already at target", () => {
    const btn = createButton("Go");
    registry.addElement(btn);

    const result = recovery.recover(
      "dashboard",
      machine.getTransitionDefinitions(),
      new Error("transition failed"),
    );

    expect(result.recovered).toBe(true);
    expect(result.newPath).toHaveLength(0);
    expect(result.diagnosis).toContain("Already at target");
  });

  it("recover re-plans from current state", () => {
    const input = createInput("Username");
    registry.addElement(input);

    const result = recovery.recover(
      "dashboard",
      machine.getTransitionDefinitions(),
      new Error("original failure"),
    );

    // We're in "login" state and need to get to "dashboard"
    // There's a transition "login-to-dash" that should be found
    expect(result.currentStates.has("login")).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.newPath.length).toBeGreaterThan(0);
    expect(result.diagnosis).toContain("alternative path");
  });

  it("reports failure when no path exists", () => {
    // Empty registry = no recognized state
    const result = recovery.recover(
      "dashboard",
      machine.getTransitionDefinitions(),
      new Error("test failure"),
    );

    expect(result.recovered).toBe(false);
    expect(result.diagnosis).toContain("Cannot recover");
  });
});
