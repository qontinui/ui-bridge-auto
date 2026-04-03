import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
} from "../../state/state-machine";

let machine: StateMachine;

beforeEach(() => {
  machine = new StateMachine();
});

// ---------------------------------------------------------------------------
// Definition registration
// ---------------------------------------------------------------------------

describe("defineStates / defineTransitions", () => {
  it("stores state definitions", () => {
    const states: StateDefinition[] = [
      { id: "login", name: "Login Page", requiredElements: [{ tagName: "form" }] },
      { id: "dashboard", name: "Dashboard", requiredElements: [{ id: "dash" }] },
    ];
    machine.defineStates(states);

    expect(machine.getStateDefinition("login")).toBeDefined();
    expect(machine.getStateDefinition("dashboard")).toBeDefined();
    expect(machine.getAllStateDefinitions()).toHaveLength(2);
  });

  it("stores transition definitions", () => {
    const transitions: TransitionDefinition[] = [
      {
        id: "login-to-dash",
        name: "Login → Dashboard",
        fromStates: ["login"],
        activateStates: ["dashboard"],
        exitStates: ["login"],
        actions: [{ target: { id: "submit" }, action: "click" }],
      },
    ];
    machine.defineTransitions(transitions);

    expect(machine.getTransitionDefinitions()).toHaveLength(1);
    expect(machine.getTransitionDefinitions()[0].id).toBe("login-to-dash");
  });

  it("overwrites state with same id", () => {
    machine.defineStates([
      { id: "s1", name: "Original", requiredElements: [] },
    ]);
    machine.defineStates([
      { id: "s1", name: "Updated", requiredElements: [] },
    ]);

    expect(machine.getStateDefinition("s1")!.name).toBe("Updated");
    expect(machine.getAllStateDefinitions()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Active state tracking
// ---------------------------------------------------------------------------

describe("active state management", () => {
  it("starts with no active states", () => {
    expect(machine.getActiveStates().size).toBe(0);
    expect(machine.isActive("anything")).toBe(false);
  });

  it("setActiveStates activates new states", () => {
    machine.setActiveStates(new Set(["login", "header-visible"]));

    expect(machine.isActive("login")).toBe(true);
    expect(machine.isActive("header-visible")).toBe(true);
    expect(machine.isActive("dashboard")).toBe(false);
  });

  it("setActiveStates deactivates old states", () => {
    machine.setActiveStates(new Set(["login"]));
    expect(machine.isActive("login")).toBe(true);

    machine.setActiveStates(new Set(["dashboard"]));
    expect(machine.isActive("login")).toBe(false);
    expect(machine.isActive("dashboard")).toBe(true);
  });

  it("getActiveStates returns a copy (not the internal set)", () => {
    machine.setActiveStates(new Set(["s1"]));
    const copy = machine.getActiveStates();
    copy.add("s2");
    expect(machine.isActive("s2")).toBe(false);
  });

  it("supports multiple simultaneous active states", () => {
    machine.setActiveStates(new Set(["header", "sidebar", "main-content"]));
    expect(machine.getActiveStates().size).toBe(3);
    expect(machine.isActive("header")).toBe(true);
    expect(machine.isActive("sidebar")).toBe(true);
    expect(machine.isActive("main-content")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe("state enter/exit events", () => {
  it("emits state:enter when a state becomes active", () => {
    const cb = vi.fn();
    machine.onStateEnter("login", cb);

    machine.setActiveStates(new Set(["login"]));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "login" }),
    );
  });

  it("emits state:exit when a state is deactivated", () => {
    const cb = vi.fn();
    machine.onStateExit("login", cb);

    machine.setActiveStates(new Set(["login"]));
    machine.setActiveStates(new Set([]));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ stateId: "login" }),
    );
  });

  it("does not re-emit enter for states that remain active", () => {
    const cb = vi.fn();
    machine.onStateEnter("login", cb);

    machine.setActiveStates(new Set(["login"]));
    machine.setActiveStates(new Set(["login", "sidebar"]));

    // login entered once, not re-entered
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("wildcard enter listener receives all enter events", () => {
    const cb = vi.fn();
    machine.onStateEnter("*", cb);

    machine.setActiveStates(new Set(["a", "b"]));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("wildcard exit listener receives all exit events", () => {
    const cb = vi.fn();
    machine.onStateExit("*", cb);

    machine.setActiveStates(new Set(["a", "b"]));
    machine.setActiveStates(new Set([]));

    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("unsubscribe stops listener", () => {
    const cb = vi.fn();
    const unsub = machine.onStateEnter("login", cb);
    unsub();

    machine.setActiveStates(new Set(["login"]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("unsubscribe wildcard listener", () => {
    const cb = vi.fn();
    const unsub = machine.onStateEnter("*", cb);
    unsub();

    machine.setActiveStates(new Set(["login"]));
    expect(cb).not.toHaveBeenCalled();
  });

  it("event includes timestamp", () => {
    const cb = vi.fn();
    machine.onStateEnter("s1", cb);

    const before = Date.now();
    machine.setActiveStates(new Set(["s1"]));

    expect(cb.mock.calls[0][0].timestamp).toBeGreaterThanOrEqual(before);
    expect(cb.mock.calls[0][0].timestamp).toBeLessThanOrEqual(Date.now());
  });
});
