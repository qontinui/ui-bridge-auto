/**
 * Transition executor — performs the actions defined in a transition and
 * provides a high-level `navigateToState` that uses the pathfinder.
 */

import type { ElementQuery } from "../core/element-query";
import type { StateMachine, TransitionDefinition, TransitionAction } from "./state-machine";
import { findPath } from "./pathfinder";

// ---------------------------------------------------------------------------
// Action executor abstraction
// ---------------------------------------------------------------------------

export interface ActionExecutorLike {
  findElement(query: ElementQuery): { id: string } | null;
  executeAction(
    elementId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void>;
  waitForIdle(timeout?: number): Promise<void>;
  /** Find all matching elements (optional — needed for count assertions). */
  findAllElements?(query: ElementQuery): { id: string }[];
  /** Get element bounding rect (optional — needed for spatial assertions). */
  getElementRect?(id: string): { x: number; y: number; width: number; height: number } | null;
  /**
   * Batch-find multiple elements at once. Returns a Map from serialized query
   * key to result. More efficient than sequential findElement calls.
   * Default implementation falls back to sequential findElement.
   */
  findElements?(queries: ElementQuery[]): Map<string, { id: string } | null>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TransitionError extends Error {
  public readonly transitionId: string;
  public readonly actionIndex: number;

  constructor(transitionId: string, actionIndex: number, cause: string) {
    super(
      `Transition "${transitionId}" failed at action ${actionIndex}: ${cause}`,
    );
    this.name = "TransitionError";
    this.transitionId = transitionId;
    this.actionIndex = actionIndex;
  }
}

// ---------------------------------------------------------------------------
// Single transition execution
// ---------------------------------------------------------------------------

/**
 * Execute a single transition by running each of its actions in sequence.
 */
export async function executeTransition(
  transition: TransitionDefinition,
  actionExecutor: ActionExecutorLike,
): Promise<void> {
  for (let i = 0; i < transition.actions.length; i++) {
    const action = transition.actions[i];
    await executeAction(transition.id, i, action, actionExecutor);
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Navigate from the current active states to the target state by computing
 * a path and executing each transition in order.
 *
 * By default, recovery is enabled: a failed transition triggers re-detection
 * of the current state and re-planning from the new position, excluding
 * transitions that already failed. Continues until the target is reached
 * or no more paths exist.
 */
export async function navigateToState(
  targetState: string,
  machine: StateMachine,
  transitions: TransitionDefinition[],
  actionExecutor: ActionExecutorLike,
  options?: { recovery?: boolean },
): Promise<void> {
  const recovery = options?.recovery !== false; // default true
  let currentStates = machine.getActiveStates();
  let path = findPath(currentStates, targetState, transitions);
  const failedTransitionIds = new Set<string>();

  while (path.length > 0) {
    const transition = path[0];

    try {
      await executeTransition(transition, actionExecutor);
      path.shift();
    } catch (err) {
      failedTransitionIds.add(transition.id);

      if (recovery) {
        // Re-detect current state from the machine
        currentStates = machine.getActiveStates();

        // Already at target?
        if (currentStates.has(targetState)) {
          return;
        }

        // Re-plan from current state, excluding failed transitions
        const available = transitions.filter((t) => !failedTransitionIds.has(t.id));
        try {
          path = findPath(currentStates, targetState, available);
          continue;
        } catch {
          // No path found — throw the original error
        }
      }

      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function executeAction(
  transitionId: string,
  actionIndex: number,
  action: TransitionAction,
  executor: ActionExecutorLike,
): Promise<void> {
  // Find the target element
  const found = executor.findElement(action.target);
  if (!found) {
    throw new TransitionError(
      transitionId,
      actionIndex,
      "Target element not found for query",
    );
  }

  // Perform the action
  await executor.executeAction(found.id, action.action, action.params);

  // Handle waitAfter
  if (action.waitAfter) {
    await handleWaitAfter(action.waitAfter, executor);
  }
}

async function handleWaitAfter(
  wait: NonNullable<TransitionAction["waitAfter"]>,
  executor: ActionExecutorLike,
): Promise<void> {
  const timeout = wait.timeout ?? 10_000;

  switch (wait.type) {
    case "idle":
      await executor.waitForIdle(timeout);
      break;

    case "time":
      await new Promise<void>((resolve) =>
        setTimeout(resolve, wait.ms ?? 500),
      );
      break;

    case "element": {
      if (!wait.query) break;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const el = executor.findElement(wait.query);
        if (el) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        `Timed out waiting for element after ${timeout}ms`,
      );
    }

    case "vanish": {
      if (!wait.query) break;
      const vanishDeadline = Date.now() + timeout;
      while (Date.now() < vanishDeadline) {
        const el = executor.findElement(wait.query);
        if (!el) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        `Timed out waiting for element to vanish after ${timeout}ms`,
      );
    }

    case "change": {
      if (!wait.query) break;
      const changeDeadline = Date.now() + timeout;
      const initialPresent = executor.findElement(wait.query) !== null;
      while (Date.now() < changeDeadline) {
        const nowPresent = executor.findElement(wait.query) !== null;
        if (nowPresent !== initialPresent) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out waiting for change after ${timeout}ms`);
    }

    case "stable": {
      if (!wait.query) break;
      const stableDeadline = Date.now() + timeout;
      const quietMs = (wait as { quietPeriodMs?: number }).quietPeriodMs ?? 500;
      let lastPresent = executor.findElement(wait.query) !== null;
      let lastChange = Date.now();
      while (Date.now() < stableDeadline) {
        const nowPresent = executor.findElement(wait.query) !== null;
        if (nowPresent !== lastPresent) {
          lastPresent = nowPresent;
          lastChange = Date.now();
        }
        if (Date.now() - lastChange >= quietMs) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out waiting for stable after ${timeout}ms`);
    }
  }
}
