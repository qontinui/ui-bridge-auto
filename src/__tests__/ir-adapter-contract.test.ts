/**
 * Regression test: @qontinui/shared-types/ui-bridge-ir ↔ ui-bridge-auto runtime
 *
 * Ensures the IR module's `AdaptedState` / `AdaptedTransition` shapes remain
 * structurally compatible with ui-bridge-auto's `StateDefinition` /
 * `TransitionDefinition` (the runtime engine's input). If either side drifts
 * — e.g., ui-bridge-auto adds a required field on `StateDefinition` — this
 * test fails at compile time, surfacing the drift to whoever changes either
 * side.
 *
 * Imports directly from qontinui-schemas/ts/src/ to avoid a stale dist
 * masking real source drift.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  adaptIRDocumentToWorkflowConfig,
  adaptIRState,
  adaptIRTransition,
  type AdaptedState,
  type AdaptedTransition,
  type IRDocument,
} from "@qontinui/shared-types/ui-bridge-ir";

import { AutomationEngine } from "../core/engine";
import { MockRegistry } from "../test-utils/mock-registry";
import { MockActionExecutor } from "../test-utils/mock-executor";
import { createButton, createHeading, createLink, resetIdCounter } from "../test-utils/mock-elements";
import type { StateDefinition, TransitionDefinition } from "../state/state-machine";

// ---------------------------------------------------------------------------
// Compile-time structural-compatibility witnesses.
//
// The function is never called — its only purpose is to make the TypeScript
// compiler verify that adapter output is a structural subtype of the runtime
// input. If ui-bridge-auto adds a required field to `StateDefinition` (or
// removes one from `AdaptedState`), this stops compiling.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeWitnesses(s: AdaptedState, t: AdaptedTransition): {
  state: StateDefinition;
  transition: TransitionDefinition;
} {
  return { state: s, transition: t };
}

// ---------------------------------------------------------------------------
// Test fixture
// ---------------------------------------------------------------------------

const FIXTURE: IRDocument = {
  version: "1.0",
  id: "ir-adapter-fixture",
  name: "IR Adapter Fixture",
  description: "Smallest IR doc that exercises all adapter branches",
  states: [
    {
      id: "login",
      name: "Login",
      requiredElements: [{ role: "button", text: "Login" }],
      excludedElements: [{ role: "heading", text: "Dashboard" }],
      blocking: false,
      group: "auth",
      pathCost: 1,
      metadata: { description: "Login state", tags: ["auth"] },
      provenance: { source: "hand-authored", file: "fixture.ir.json", line: 5 },
      elementIds: ["should-be-stripped"],
      incomingTransitions: ["should-be-stripped"],
    },
    {
      id: "dashboard",
      name: "Dashboard",
      requiredElements: [{ role: "heading", text: "Dashboard" }],
      isInitial: false,
    },
    {
      id: "settings",
      name: "Settings",
      requiredElements: [{ role: "link", text: "Settings" }],
      isTerminal: true,
    },
  ],
  transitions: [
    {
      id: "t-login-to-dashboard",
      name: "Click Login",
      fromStates: ["login"],
      activateStates: ["dashboard"],
      // exitStates omitted on purpose — adapter must default to [].
      actions: [
        {
          type: "click",
          target: { role: "button", text: "Login" },
          // IR can express `state` waits — adapter narrows to runtime-supported
          // subset (drops `state`, `condition`, and richer fields).
          waitAfter: { type: "idle", timeout: 5000 },
        },
        {
          type: "click",
          target: { role: "link", text: "Forgot password" },
          // IR-only wait variant — adapter drops it entirely.
          waitAfter: { type: "state", stateId: "password-reset", timeout: 5000 },
        },
      ],
      effect: "write",
      metadata: { description: "Submits credentials", tags: ["auth"] },
      provenance: { source: "build-plugin", pluginVersion: "0.0.1" },
    },
    {
      id: "t-dashboard-to-settings",
      name: "Open Settings",
      fromStates: ["dashboard"],
      activateStates: ["settings"],
      exitStates: ["dashboard"],
      actions: [{ type: "click", target: { role: "link", text: "Settings" } }],
      effect: "read",
      pathCost: 2,
      bidirectional: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IR adapter contract (cross-package regression)", () => {
  it("strips IR-only fields from adapted states", () => {
    const adapted = adaptIRState(FIXTURE.states[0]);
    expect(adapted).not.toHaveProperty("metadata");
    expect(adapted).not.toHaveProperty("provenance");
    expect(adapted).not.toHaveProperty("elementIds");
    expect(adapted).not.toHaveProperty("incomingTransitions");
    expect(adapted).not.toHaveProperty("crossRefs");
    expect(adapted).not.toHaveProperty("visualRefs");
    // Authored fields preserved.
    expect(adapted.id).toBe("login");
    expect(adapted.name).toBe("Login");
    expect(adapted.requiredElements).toEqual([{ role: "button", text: "Login" }]);
    expect(adapted.excludedElements).toEqual([{ role: "heading", text: "Dashboard" }]);
    expect(adapted.group).toBe("auth");
    expect(adapted.pathCost).toBe(1);
  });

  it("strips IR-only fields from adapted transitions and defaults exitStates", () => {
    const t1 = adaptIRTransition(FIXTURE.transitions[0]);
    const t2 = adaptIRTransition(FIXTURE.transitions[1]);

    expect(t1).not.toHaveProperty("effect");
    expect(t1).not.toHaveProperty("metadata");
    expect(t1).not.toHaveProperty("provenance");
    expect(t1).not.toHaveProperty("crossRefs");

    // Default behavior — IR omitted exitStates, adapter normalizes.
    expect(t1.exitStates).toEqual([]);
    expect(t2.exitStates).toEqual(["dashboard"]);

    // Preserved authored fields.
    expect(t2.bidirectional).toBe(true);
    expect(t2.pathCost).toBe(2);

    // Runtime-compatible waitAfter survives, narrowed to runtime fields.
    expect(t1.actions[0].waitAfter).toEqual({ type: "idle", timeout: 5000 });
    // IR-only wait variant (`state`) is dropped entirely.
    expect(t1.actions[1].waitAfter).toBeUndefined();
  });

  it("rejects unsupported IR versions loudly", () => {
    const bad = { ...FIXTURE, version: "0.9" as unknown as IRDocument["version"] };
    expect(() => adaptIRDocumentToWorkflowConfig(bad)).toThrow(/unsupported IR version/);
  });

  it("end-to-end: adapter output drives ui-bridge-auto state detection", () => {
    resetIdCounter();
    document.body.innerHTML = "";
    const registry = new MockRegistry();
    const executor = new MockActionExecutor();
    const engine = new AutomationEngine({ registry, executor });

    try {
      const adapted = adaptIRDocumentToWorkflowConfig(FIXTURE);

      // Structural assignment proves runtime accepts adapter output without casts.
      const states: StateDefinition[] = adapted.states;
      const transitions: TransitionDefinition[] = adapted.transitions;

      const loginBtn = createButton("Login");
      registry.addElement(loginBtn);

      engine.defineStates(states);
      engine.defineTransitions(transitions);

      expect(engine.isActive("login")).toBe(true);
      expect(engine.isActive("dashboard")).toBe(false);

      registry.removeElement(loginBtn.id);
      const heading = createHeading(1, "Dashboard");
      registry.addElement(heading);
      engine.stateDetector.evaluate();

      expect(engine.isActive("dashboard")).toBe(true);
      expect(engine.isActive("login")).toBe(false);

      registry.removeElement(heading.id);
      const settingsLink = createLink("Settings", "/settings");
      registry.addElement(settingsLink);
      engine.stateDetector.evaluate();

      expect(engine.isActive("settings")).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it("preserves the doc-level fields in the adapted WorkflowConfig", () => {
    const adapted = adaptIRDocumentToWorkflowConfig(FIXTURE);
    expect(adapted.id).toBe("ir-adapter-fixture");
    expect(adapted.name).toBe("IR Adapter Fixture");
    expect(adapted.description).toBe("Smallest IR doc that exercises all adapter branches");
    expect(adapted.states).toHaveLength(3);
    expect(adapted.transitions).toHaveLength(2);
    expect(adapted.initialState).toBeUndefined();
  });
});
