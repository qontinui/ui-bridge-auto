/**
 * Transition definitions and execution results.
 *
 * A transition describes a sequence of actions that moves the application
 * from one set of active states to another. Each transition has precondition
 * states (must be active), actions to execute, and postcondition states
 * (activated/exited after execution).
 */

import type { ElementCriteria } from "./match";

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

/**
 * All supported action verbs for transition actions.
 */
export type ActionType =
  | "click"
  | "doubleClick"
  | "rightClick"
  | "middleClick"
  | "type"
  | "clear"
  | "select"
  | "check"
  | "uncheck"
  | "toggle"
  | "focus"
  | "blur"
  | "hover"
  | "scrollIntoView"
  | "scroll"
  | "sendKeys"
  | "drag"
  | "submit"
  | "reset"
  | "setValue"
  | "mouseDown"
  | "mouseUp"
  | "keyDown"
  | "keyUp";

// ---------------------------------------------------------------------------
// Wait specification
// ---------------------------------------------------------------------------

/** How to wait after an action completes. */
export type WaitType = "idle" | "element" | "state" | "time" | "condition" | "vanish";

/**
 * Specification for what to wait for after an action executes.
 * Used to ensure the UI has settled before proceeding.
 */
export interface WaitSpec {
  /** What kind of signal to wait for. */
  type: WaitType;
  /** Element criteria to wait for (when type is "element"). */
  query?: ElementCriteria;
  /** State ID to wait for (when type is "state"). */
  stateId?: string;
  /** Duration in ms (when type is "time"). */
  ms?: number;
  /** Maximum wait time before timeout (default 10000). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Transition action
// ---------------------------------------------------------------------------

/**
 * A single action step within a transition.
 * Targets an element identified by criteria and executes an action verb.
 */
export interface TransitionAction {
  /** The action to perform. */
  type: ActionType;
  /** Criteria to find the target element. */
  target: ElementCriteria;
  /** Action-specific parameters (e.g., { text: "hello" } for "type"). */
  params?: Record<string, unknown>;
  /** Optional wait specification applied after this action completes. */
  waitAfter?: WaitSpec;
}

// ---------------------------------------------------------------------------
// Transition definition
// ---------------------------------------------------------------------------

/**
 * A named transition between application states.
 *
 * Transitions define preconditions (fromStates), postconditions
 * (activateStates/exitStates), and the actions to execute. The state machine
 * uses transitions for pathfinding and navigation.
 */
export interface Transition {
  /** Unique transition identifier. */
  id: string;
  /** Human-readable transition name. */
  name: string;
  /** Optional description of what this transition does. */
  description?: string;

  /** Precondition: all of these states must be active. */
  fromStates: string[];
  /** States to enter after the transition completes. */
  activateStates: string[];
  /** States to leave after the transition completes. */
  exitStates: string[];

  /** Ordered list of actions to execute. */
  actions: TransitionAction[];

  /** Navigation cost for pathfinding (default 1.0). */
  pathCost?: number;
  /** Whether this transition can be reversed (hints for pathfinder). */
  bidirectional?: boolean;

  /** How many times this transition has succeeded. */
  successCount: number;
  /** How many times this transition has failed. */
  failureCount: number;
  /** Rolling average execution duration (ms). */
  averageDurationMs: number;
  /** Epoch timestamp of last execution. */
  lastExecutedAt?: number;
}

// ---------------------------------------------------------------------------
// Transition result
// ---------------------------------------------------------------------------

/**
 * Outcome of executing a transition.
 * Captures timing, error information, and state-set snapshots.
 */
export interface TransitionResult {
  /** ID of the transition that was executed. */
  transitionId: string;
  /** Whether the transition completed successfully. */
  success: boolean;
  /** Total execution duration (ms). */
  durationMs: number;
  /** Number of actions that were executed (may be less than total on failure). */
  actionsExecuted: number;
  /** Error message if the transition failed. */
  error?: string;
  /** Active states before the transition was executed. */
  statesBefore: Set<string>;
  /** Active states after the transition completed (or failed). */
  statesAfter: Set<string>;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Compute the success rate of a transition (0.0-1.0).
 * Returns 0.5 if no executions have been recorded (neutral prior).
 */
export function transitionSuccessRate(transition: Transition): number {
  const total = transition.successCount + transition.failureCount;
  if (total === 0) return 0.5;
  return transition.successCount / total;
}

/**
 * Update a transition's reliability statistics after an execution.
 * Mutates the transition in place. Returns the transition for chaining.
 */
export function recordTransitionExecution(
  transition: Transition,
  result: TransitionResult,
): Transition {
  if (result.success) {
    transition.successCount++;
  } else {
    transition.failureCount++;
  }

  // Rolling average: weighted 90% old + 10% new
  const total = transition.successCount + transition.failureCount;
  if (total === 1) {
    transition.averageDurationMs = result.durationMs;
  } else {
    transition.averageDurationMs =
      transition.averageDurationMs * 0.9 + result.durationMs * 0.1;
  }

  transition.lastExecutedAt = Date.now();
  return transition;
}
