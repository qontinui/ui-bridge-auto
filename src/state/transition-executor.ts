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
 */
export async function navigateToState(
  targetState: string,
  machine: StateMachine,
  transitions: TransitionDefinition[],
  actionExecutor: ActionExecutorLike,
): Promise<void> {
  const currentStates = machine.getActiveStates();
  const path = findPath(currentStates, targetState, transitions);

  for (const transition of path) {
    await executeTransition(transition, actionExecutor);
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
  }
}
