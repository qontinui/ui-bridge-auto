/**
 * State machine for DOM-based automation.
 *
 * Tracks a set of concurrently-active states (not a single current state).
 * Each state is defined by required/excluded element queries and optional
 * property conditions. The machine emits enter/exit events when the active
 * set changes.
 */

import type { ElementQuery } from "../core/element-query";

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface StateDefinition {
  id: string;
  name: string;
  /** ALL must match for state to be active. */
  requiredElements: ElementQuery[];
  /** ANY match means state is NOT active. */
  excludedElements?: ElementQuery[];
  /** Additional property checks on matched elements. */
  conditions?: StateCondition[];
  /** If true, this is a modal/blocking state. */
  blocking?: boolean;
  /** Logical grouping label. */
  group?: string;
  /** Cost weight for pathfinding (default 1.0). */
  pathCost?: number;
}

export interface StateCondition {
  element: ElementQuery;
  /** Property name to check: 'visible' | 'enabled' | 'text' | 'value' | 'ariaExpanded' | etc. */
  property: string;
  expected: unknown;
}

export interface TransitionDefinition {
  id: string;
  name: string;
  /** Precondition: these states must be active. */
  fromStates: string[];
  /** States to enter after the transition. */
  activateStates: string[];
  /** States to leave after the transition. */
  exitStates: string[];
  /** Actions to execute during the transition. */
  actions: TransitionAction[];
  /** Cost weight for pathfinding (default 1.0). */
  pathCost?: number;
}

export interface TransitionAction {
  target: ElementQuery;
  /** Action verb: 'click' | 'type' | 'select' | 'focus' | 'clear' */
  action: string;
  params?: Record<string, unknown>;
  waitAfter?: {
    type: "idle" | "element" | "time";
    query?: ElementQuery;
    ms?: number;
    timeout?: number;
  };
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface StateEvent {
  stateId: string;
  timestamp: number;
}

type StateEventListener = (event: StateEvent) => void;

// ---------------------------------------------------------------------------
// StateMachine
// ---------------------------------------------------------------------------

export class StateMachine {
  private readonly states = new Map<string, StateDefinition>();
  private readonly transitions = new Map<string, TransitionDefinition>();
  private readonly activeStates = new Set<string>();

  private readonly enterListeners = new Map<string, Set<StateEventListener>>();
  private readonly exitListeners = new Map<string, Set<StateEventListener>>();
  private readonly wildcardEnterListeners = new Set<StateEventListener>();
  private readonly wildcardExitListeners = new Set<StateEventListener>();

  // -----------------------------------------------------------------------
  // Definition registration
  // -----------------------------------------------------------------------

  defineStates(defs: StateDefinition[]): void {
    for (const def of defs) {
      this.states.set(def.id, def);
    }
  }

  defineTransitions(defs: TransitionDefinition[]): void {
    for (const def of defs) {
      this.transitions.set(def.id, def);
    }
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  getStateDefinition(id: string): StateDefinition | undefined {
    return this.states.get(id);
  }

  getAllStateDefinitions(): StateDefinition[] {
    return Array.from(this.states.values());
  }

  getTransitionDefinitions(): TransitionDefinition[] {
    return Array.from(this.transitions.values());
  }

  getActiveStates(): Set<string> {
    return new Set(this.activeStates);
  }

  isActive(stateId: string): boolean {
    return this.activeStates.has(stateId);
  }

  // -----------------------------------------------------------------------
  // Active-set mutation (called by StateDetector)
  // -----------------------------------------------------------------------

  /**
   * Replace the active state set. Emits enter/exit events for every change.
   */
  setActiveStates(next: Set<string>): void {
    const now = Date.now();

    // States that were active but are no longer
    for (const id of this.activeStates) {
      if (!next.has(id)) {
        this.activeStates.delete(id);
        this.emitExit({ stateId: id, timestamp: now });
      }
    }

    // States that are newly active
    for (const id of next) {
      if (!this.activeStates.has(id)) {
        this.activeStates.add(id);
        this.emitEnter({ stateId: id, timestamp: now });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Event subscription
  // -----------------------------------------------------------------------

  /**
   * Subscribe to state-enter events. Pass '*' for stateId to listen to all.
   */
  onStateEnter(stateId: string, cb: StateEventListener): () => void {
    if (stateId === "*") {
      this.wildcardEnterListeners.add(cb);
      return () => {
        this.wildcardEnterListeners.delete(cb);
      };
    }
    let set = this.enterListeners.get(stateId);
    if (!set) {
      set = new Set();
      this.enterListeners.set(stateId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  /**
   * Subscribe to state-exit events. Pass '*' for stateId to listen to all.
   */
  onStateExit(stateId: string, cb: StateEventListener): () => void {
    if (stateId === "*") {
      this.wildcardExitListeners.add(cb);
      return () => {
        this.wildcardExitListeners.delete(cb);
      };
    }
    let set = this.exitListeners.get(stateId);
    if (!set) {
      set = new Set();
      this.exitListeners.set(stateId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private emitEnter(event: StateEvent): void {
    const set = this.enterListeners.get(event.stateId);
    if (set) {
      for (const cb of set) cb(event);
    }
    for (const cb of this.wildcardEnterListeners) cb(event);
  }

  private emitExit(event: StateEvent): void {
    const set = this.exitListeners.get(event.stateId);
    if (set) {
      for (const cb of set) cb(event);
    }
    for (const cb of this.wildcardExitListeners) cb(event);
  }
}
