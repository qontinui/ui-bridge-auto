/**
 * Event-driven state detector.
 *
 * Subscribes to registry element events and re-evaluates ALL state definitions
 * on every change. Element queries are cheap (in-memory registry scan), so
 * full re-evaluation is practical.
 *
 * Also runs a periodic reconciliation every 5 seconds as a safety net
 * against missed events.
 */

import type { QueryableElement, ElementQuery } from "../core/element-query";
import { matchesQuery, findFirst } from "../core/element-query";
import type { StateMachine } from "./state-machine";
import type { StateCondition } from "./state-machine";

// ---------------------------------------------------------------------------
// Registry abstraction
// ---------------------------------------------------------------------------

export interface RegistryLike {
  getAllElements(): QueryableElement[];
  on(
    type: string,
    listener: (event: { type: string; data: unknown }) => void,
  ): () => void;
}

// ---------------------------------------------------------------------------
// StateDetector
// ---------------------------------------------------------------------------

export class StateDetector {
  private readonly machine: StateMachine;
  private readonly registry: RegistryLike;

  private readonly unsubscribes: Array<() => void> = [];
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  /** Debounce handle to coalesce rapid-fire registry events. */
  private pendingEval: ReturnType<typeof setTimeout> | null = null;

  constructor(machine: StateMachine, registry: RegistryLike) {
    this.machine = machine;
    this.registry = registry;

    // Subscribe to registry events
    const handler = () => this.scheduleEvaluation();

    this.unsubscribes.push(
      registry.on("element:registered", handler),
      registry.on("element:unregistered", handler),
      registry.on("element:stateChanged", handler),
    );

    // Safety-net reconciliation every 5 seconds
    this.reconcileTimer = setInterval(() => this.evaluate(), 5_000);

    // Initial evaluation
    this.evaluate();
  }

  // -----------------------------------------------------------------------
  // Public
  // -----------------------------------------------------------------------

  /** Force an immediate re-evaluation of all states. */
  evaluate(): void {
    if (this.disposed) return;

    const elements = this.registry.getAllElements();
    const defs = this.machine.getAllStateDefinitions();
    const next = new Set<string>();

    for (const def of defs) {
      if (this.isStateActive(def, elements)) {
        next.add(def.id);
      }
    }

    this.machine.setActiveStates(next);
  }

  /** Tear down subscriptions and timers. */
  dispose(): void {
    this.disposed = true;
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes.length = 0;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (this.pendingEval !== null) {
      clearTimeout(this.pendingEval);
      this.pendingEval = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Debounce evaluation by 1 frame (microtask-ish). Multiple registry events
   * arriving in the same tick collapse into a single evaluation.
   */
  private scheduleEvaluation(): void {
    if (this.pendingEval !== null) return;
    this.pendingEval = setTimeout(() => {
      this.pendingEval = null;
      this.evaluate();
    }, 0);
  }

  /**
   * Determine whether a state definition is currently satisfied.
   */
  private isStateActive(
    def: {
      requiredElements: ElementQuery[];
      excludedElements?: ElementQuery[];
      conditions?: StateCondition[];
    },
    elements: QueryableElement[],
  ): boolean {
    // ALL required elements must have at least one match
    for (const query of def.requiredElements) {
      const found = elements.some((el) => matchesQuery(el, query).matches);
      if (!found) return false;
    }

    // ANY excluded element match means state is NOT active
    if (def.excludedElements) {
      for (const query of def.excludedElements) {
        const found = elements.some((el) => matchesQuery(el, query).matches);
        if (found) return false;
      }
    }

    // Additional property conditions
    if (def.conditions) {
      for (const cond of def.conditions) {
        if (!this.checkCondition(cond, elements)) return false;
      }
    }

    return true;
  }

  /**
   * Check a single StateCondition against the element set.
   */
  private checkCondition(
    cond: StateCondition,
    elements: QueryableElement[],
  ): boolean {
    const result = findFirst(elements, cond.element);
    if (!result) return false;

    // Find the actual QueryableElement to inspect its state
    const el = elements.find((e) => e.id === result.id);
    if (!el) return false;

    const state = el.getState();
    const prop = cond.property;

    let actual: unknown;
    switch (prop) {
      case "visible":
        actual = state.visible;
        break;
      case "enabled":
        actual = state.enabled;
        break;
      case "focused":
        actual = state.focused;
        break;
      case "checked":
        actual = state.checked;
        break;
      case "text":
        actual = state.textContent;
        break;
      case "value":
        actual = state.value;
        break;
      case "ariaExpanded":
        actual = el.element.getAttribute("aria-expanded") === "true";
        break;
      case "ariaSelected":
        actual = el.element.getAttribute("aria-selected") === "true";
        break;
      case "ariaPressed": {
        const raw = el.element.getAttribute("aria-pressed");
        actual = raw === "mixed" ? "mixed" : raw === "true";
        break;
      }
      default:
        // Fall back to reading an attribute
        actual = el.element.getAttribute(prop);
        break;
    }

    return actual === cond.expected;
  }
}
