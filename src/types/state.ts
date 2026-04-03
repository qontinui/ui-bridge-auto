/**
 * State representation for the automation state machine.
 *
 * States are identified by element presence and property conditions on the
 * live DOM — no screenshots or visual matching. Each state is defined by
 * required/excluded element criteria and optional property checks. Multiple
 * states can be active simultaneously (e.g., "logged-in" + "dashboard-visible").
 */

import type { ElementCriteria } from "./match";

// ---------------------------------------------------------------------------
// State definition
// ---------------------------------------------------------------------------

/**
 * A named, identifiable application state.
 *
 * States are detected by checking whether required elements are present in the
 * DOM and excluded elements are absent. Additional property conditions can
 * refine detection further.
 */
export interface State {
  /** Unique state identifier. */
  id: string;
  /** Human-readable state name. */
  name: string;
  /** Optional description of what this state represents. */
  description?: string;

  /** Element criteria that must ALL be satisfied for this state to be active. */
  requiredElements: ElementCriteria[];
  /** Element criteria where NONE may be satisfied (any match disqualifies). */
  excludedElements?: ElementCriteria[];
  /** Additional property checks on matched elements. */
  conditions?: StateCondition[];

  /** Whether this is a valid initial/starting state. */
  isInitial?: boolean;
  /** Whether this is a terminal state (no outgoing transitions). */
  isTerminal?: boolean;
  /** Whether this state is modal/blocking (e.g., a dialog). */
  blocking?: boolean;
  /** Logical group this state belongs to (e.g., "auth", "settings"). */
  group?: string;
  /** Navigation cost weight for pathfinding (default 1.0). */
  pathCost?: number;

  /** Epoch timestamp when this state was last entered. */
  enteredAt?: number;
  /** Epoch timestamp when this state was last exited. */
  exitedAt?: number;
  /** How many times this state has been detected across all evaluations. */
  observationCount: number;
}

// ---------------------------------------------------------------------------
// State conditions
// ---------------------------------------------------------------------------

/** Property names that can be checked in a StateCondition. */
export type StateConditionProperty =
  | "visible"
  | "enabled"
  | "checked"
  | "expanded"
  | "selected"
  | "text"
  | "value";

/** Comparison operators for state condition evaluation. */
export type StateConditionComparator =
  | "equals"
  | "contains"
  | "matches"
  | "greaterThan"
  | "lessThan";

/**
 * A condition that checks a specific property on a matched element.
 * Used to refine state detection beyond simple presence/absence checks.
 */
export interface StateCondition {
  /** Criteria to locate the element to check. */
  element: ElementCriteria;
  /** Which property on the element to evaluate. */
  property: StateConditionProperty;
  /** The expected value for the property. */
  expected: unknown;
  /** How to compare actual vs expected (default "equals"). */
  comparator?: StateConditionComparator;
}

// ---------------------------------------------------------------------------
// Active state tracking
// ---------------------------------------------------------------------------

/**
 * The set of currently active states at a specific moment.
 * Recomputed each time the state detector evaluates the DOM.
 */
export interface ActiveStateSet {
  /** IDs of all currently active states. */
  states: Set<string>;
  /** Epoch timestamp when this set was computed. */
  timestamp: number;
  /** How many elements were evaluated to compute this set. */
  elementCount: number;
}

/**
 * Lifecycle phase of a state during a detection cycle.
 * - "entering": state is becoming active (was inactive last cycle)
 * - "active": state has been active for more than one cycle
 * - "exiting": state is becoming inactive (was active last cycle)
 * - "hidden": state is not active
 */
export type StateLifecycle = "entering" | "active" | "exiting" | "hidden";

// ---------------------------------------------------------------------------
// State change events
// ---------------------------------------------------------------------------

/**
 * Event emitted when a state is entered or exited.
 * Carries the full context of the transition between active-state sets.
 */
export interface StateChangeEvent {
  /** Whether the state was entered or exited. */
  type: "enter" | "exit";
  /** ID of the state that changed. */
  stateId: string;
  /** Human-readable name of the state that changed. */
  stateName: string;
  /** Epoch timestamp of the change. */
  timestamp: number;
  /** The active-state set before this change. */
  previousStates: Set<string>;
  /** The active-state set after this change. */
  currentStates: Set<string>;
  /** Optional description of what caused the change. */
  trigger?: string;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Create an empty ActiveStateSet with the given timestamp.
 */
export function createEmptyStateSet(timestamp?: number): ActiveStateSet {
  return {
    states: new Set(),
    timestamp: timestamp ?? Date.now(),
    elementCount: 0,
  };
}

/**
 * Compute the difference between two active-state sets.
 * Returns the IDs of states that were entered and exited.
 */
export function diffStateSets(
  previous: ActiveStateSet,
  current: ActiveStateSet,
): { entered: string[]; exited: string[] } {
  const entered: string[] = [];
  const exited: string[] = [];

  for (const id of current.states) {
    if (!previous.states.has(id)) {
      entered.push(id);
    }
  }

  for (const id of previous.states) {
    if (!current.states.has(id)) {
      exited.push(id);
    }
  }

  return { entered, exited };
}

/**
 * Determine the lifecycle phase of a state given the previous and current sets.
 */
export function getStateLifecycle(
  stateId: string,
  previous: ActiveStateSet,
  current: ActiveStateSet,
): StateLifecycle {
  const wasPrevious = previous.states.has(stateId);
  const isCurrent = current.states.has(stateId);

  if (isCurrent && !wasPrevious) return "entering";
  if (isCurrent && wasPrevious) return "active";
  if (!isCurrent && wasPrevious) return "exiting";
  return "hidden";
}

/**
 * Evaluate a single StateCondition against an actual property value.
 * Returns true if the condition is satisfied.
 */
export function evaluateCondition(
  condition: StateCondition,
  actualValue: unknown,
): boolean {
  const comparator = condition.comparator ?? "equals";

  switch (comparator) {
    case "equals":
      return actualValue === condition.expected;

    case "contains": {
      if (typeof actualValue === "string" && typeof condition.expected === "string") {
        return actualValue.includes(condition.expected);
      }
      return false;
    }

    case "matches": {
      if (typeof actualValue === "string") {
        const pattern =
          condition.expected instanceof RegExp
            ? condition.expected
            : new RegExp(String(condition.expected));
        return pattern.test(actualValue);
      }
      return false;
    }

    case "greaterThan": {
      if (typeof actualValue === "number" && typeof condition.expected === "number") {
        return actualValue > condition.expected;
      }
      return false;
    }

    case "lessThan": {
      if (typeof actualValue === "number" && typeof condition.expected === "number") {
        return actualValue < condition.expected;
      }
      return false;
    }

    default:
      return false;
  }
}
