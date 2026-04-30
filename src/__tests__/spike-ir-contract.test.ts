/**
 * Spike: IR -> WorkflowConfig contract validation
 *
 * Section-1 foundations spike for the UI Bridge redesign.
 * Validates that a hand-authored IR document can be adapted into
 * ui-bridge-auto's runtime shape (StateDefinition[] / TransitionDefinition[])
 * before any plugin work begins.
 *
 * Companion artifact:
 *   qontinui-dev-notes/ui-bridge-redesign/section-1-foundations/spike/login-flow.ir.json
 *
 * Pass criteria:
 *   1. Adapter produces structurally-valid input for engine.defineStates / defineTransitions.
 *   2. IR-only fields (provenance, metadata, effect) are stripped from runtime input.
 *   3. exitStates defaults to [] when IR omits it (IR treats it as a hint).
 *   4. ElementCriteria flows through as ElementQuery without rewriting (decision #7).
 *   5. End-to-end: a state defined by the adapter output is detected by AutomationEngine
 *      against a MockRegistry populated with matching elements.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationEngine } from "../core/engine";
import { MockRegistry } from "../test-utils/mock-registry";
import { MockActionExecutor } from "../test-utils/mock-executor";
import { createButton, createHeading, createLink, resetIdCounter } from "../test-utils/mock-elements";
import type { ElementCriteria } from "../types/match";
import type { StateDefinition, TransitionDefinition, TransitionAction } from "../state/state-machine";

// ---------------------------------------------------------------------------
// Inline IR shape (the section-2 module will own the canonical types)
// ---------------------------------------------------------------------------

interface IRProvenance {
  source: "hand-authored" | "build-plugin" | "ai-generated";
  file?: string;
  line?: number;
}

interface IRStateMetadata {
  description?: string;
  purpose?: string;
  tags?: string[];
  relatedElements?: string[];
}

interface IRState {
  id: string;
  name: string;
  /** Canonical authoring shape per decision #7. */
  requiredElements: ElementCriteria[];
  excludedElements?: ElementCriteria[];
  blocking?: boolean;
  group?: string;
  pathCost?: number;
  /** IR-only: metadata routed through useUIAnnotation store at runtime. */
  metadata?: IRStateMetadata;
  /** IR-only: where this declaration came from. */
  provenance?: IRProvenance;
  /** IR-only: optional companion list filled in by the runtime SDK at registration. */
  elementIds?: string[];
}

type IREffect = "read" | "write" | "destructive";

interface IRTransition {
  id: string;
  name: string;
  fromStates: string[];
  activateStates: string[];
  /** IR treats this as a hint; adapter populates `[]` when omitted. */
  exitStates?: string[];
  actions: Array<{ type: string; target: ElementCriteria; params?: Record<string, unknown> }>;
  pathCost?: number;
  /** IR-only: side-effect annotation. */
  effect?: IREffect;
  /** IR-only. */
  provenance?: IRProvenance;
}

interface IRDocument {
  version: "1.0";
  id: string;
  name: string;
  description?: string;
  states: IRState[];
  transitions: IRTransition[];
}

// ---------------------------------------------------------------------------
// Inline adapter (the section-2 module will own the canonical implementation)
// ---------------------------------------------------------------------------

function adaptIRStateToDefinition(state: IRState): StateDefinition {
  return {
    id: state.id,
    name: state.name,
    requiredElements: state.requiredElements,
    excludedElements: state.excludedElements,
    blocking: state.blocking,
    group: state.group,
    pathCost: state.pathCost,
  };
}

function adaptIRTransitionToDefinition(t: IRTransition): TransitionDefinition {
  return {
    id: t.id,
    name: t.name,
    fromStates: t.fromStates,
    activateStates: t.activateStates,
    exitStates: t.exitStates ?? [],
    actions: t.actions.map(
      (a): TransitionAction => ({
        target: a.target,
        action: a.type,
        params: a.params,
      }),
    ),
    pathCost: t.pathCost,
  };
}

function adaptIRDocument(doc: IRDocument): {
  states: StateDefinition[];
  transitions: TransitionDefinition[];
} {
  return {
    states: doc.states.map(adaptIRStateToDefinition),
    transitions: doc.transitions.map(adaptIRTransitionToDefinition),
  };
}

// ---------------------------------------------------------------------------
// Spike fixture (mirrors login-flow.ir.json — hand-keyed to keep this test
// self-contained; the JSON file is the human-readable companion artifact)
// ---------------------------------------------------------------------------

const SPIKE_DOC: IRDocument = {
  version: "1.0",
  id: "spike-login-flow",
  name: "Spike: Login Flow",
  description: "3-state synthetic page",
  states: [
    {
      id: "login",
      name: "Login Page",
      requiredElements: [{ role: "button", text: "Login" }],
      metadata: { description: "Login screen", tags: ["auth", "entry"] },
      provenance: { source: "hand-authored", file: "spike/login-flow.ir.json" },
    },
    {
      id: "dashboard",
      name: "Dashboard",
      requiredElements: [{ role: "heading", text: "Dashboard" }],
      metadata: { description: "Authenticated landing", tags: ["auth", "post-login"] },
      provenance: { source: "hand-authored", file: "spike/login-flow.ir.json" },
    },
    {
      id: "settings",
      name: "Settings",
      requiredElements: [{ role: "link", text: "Settings" }],
      metadata: { description: "Settings page", tags: ["settings"] },
      provenance: { source: "hand-authored", file: "spike/login-flow.ir.json" },
    },
  ],
  transitions: [
    {
      id: "t-login-to-dashboard",
      name: "Click Login",
      fromStates: ["login"],
      activateStates: ["dashboard"],
      // Note: exitStates intentionally omitted — adapter must default to [].
      actions: [{ type: "click", target: { role: "button", text: "Login" } }],
      effect: "write",
      provenance: { source: "hand-authored" },
    },
    {
      id: "t-dashboard-to-settings",
      name: "Click Settings",
      fromStates: ["dashboard"],
      activateStates: ["settings"],
      exitStates: ["dashboard"],
      actions: [{ type: "click", target: { role: "link", text: "Settings" } }],
      effect: "read",
      provenance: { source: "hand-authored" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Spike: IR -> WorkflowConfig contract", () => {
  let registry: MockRegistry;
  let executor: MockActionExecutor;
  let engine: AutomationEngine;

  beforeEach(() => {
    resetIdCounter();
    document.body.innerHTML = "";
    registry = new MockRegistry();
    executor = new MockActionExecutor();
    engine = new AutomationEngine({ registry, executor });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("produces structurally-valid StateDefinition[] / TransitionDefinition[]", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);

    expect(adapted.states).toHaveLength(3);
    expect(adapted.transitions).toHaveLength(2);

    for (const s of adapted.states) {
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(Array.isArray(s.requiredElements)).toBe(true);
    }

    for (const t of adapted.transitions) {
      expect(typeof t.id).toBe("string");
      expect(Array.isArray(t.fromStates)).toBe(true);
      expect(Array.isArray(t.activateStates)).toBe(true);
      expect(Array.isArray(t.exitStates)).toBe(true);
      expect(Array.isArray(t.actions)).toBe(true);
    }
  });

  it("strips IR-only fields (provenance, metadata, effect) from runtime input", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);

    for (const s of adapted.states) {
      expect(s).not.toHaveProperty("metadata");
      expect(s).not.toHaveProperty("provenance");
      expect(s).not.toHaveProperty("elementIds");
    }

    for (const t of adapted.transitions) {
      expect(t).not.toHaveProperty("provenance");
      expect(t).not.toHaveProperty("effect");
    }
  });

  it("defaults exitStates to [] when IR omits it (decision: hint, not required)", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);
    const loginToDash = adapted.transitions.find((t) => t.id === "t-login-to-dashboard");
    expect(loginToDash).toBeDefined();
    expect(loginToDash!.exitStates).toEqual([]);

    const dashToSettings = adapted.transitions.find((t) => t.id === "t-dashboard-to-settings");
    expect(dashToSettings).toBeDefined();
    expect(dashToSettings!.exitStates).toEqual(["dashboard"]);
  });

  it("flows ElementCriteria through unchanged (decision #7: criteria are canonical)", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);
    const loginState = adapted.states.find((s) => s.id === "login");
    expect(loginState).toBeDefined();

    expect(loginState!.requiredElements).toEqual([{ role: "button", text: "Login" }]);
  });

  it("end-to-end: adapter output drives ui-bridge-auto state detection", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);

    // Populate the registry with the login element so the login state matches.
    const loginBtn = createButton("Login");
    registry.addElement(loginBtn);

    engine.defineStates(adapted.states);
    engine.defineTransitions(adapted.transitions);

    expect(engine.isActive("login")).toBe(true);
    expect(engine.isActive("dashboard")).toBe(false);
    expect(engine.isActive("settings")).toBe(false);

    // Swap the DOM: remove login, add dashboard heading.
    registry.removeElement(loginBtn.id);
    const heading = createHeading(1, "Dashboard");
    registry.addElement(heading);
    engine.stateDetector.evaluate();

    expect(engine.isActive("dashboard")).toBe(true);
    expect(engine.isActive("login")).toBe(false);

    // Swap again: dashboard -> settings.
    registry.removeElement(heading.id);
    const settingsLink = createLink("Settings", "/settings");
    registry.addElement(settingsLink);
    engine.stateDetector.evaluate();

    expect(engine.isActive("settings")).toBe(true);
    expect(engine.isActive("dashboard")).toBe(false);
  });

  it("end-to-end: transitions registered through adapter are queryable by id", () => {
    const adapted = adaptIRDocument(SPIKE_DOC);
    engine.defineStates(adapted.states);
    engine.defineTransitions(adapted.transitions);

    const loginToDash = engine.stateMachine.getTransitionDefinitions().find(
      (t) => t.id === "t-login-to-dashboard",
    );
    expect(loginToDash).toBeDefined();
    expect(loginToDash!.actions).toHaveLength(1);
    expect(loginToDash!.actions[0].action).toBe("click");
    expect(loginToDash!.actions[0].target).toEqual({ role: "button", text: "Login" });
  });
});
