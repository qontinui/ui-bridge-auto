/**
 * Execute multiple actions as an ordered sequence with automatic waits.
 *
 * Each step finds its target element via an ElementQuery, executes the
 * requested action, then waits according to a configurable WaitSpec
 * (defaulting to wait-for-idle). Results are collected with per-step
 * timing and error information.
 */

import type { ElementQuery, QueryableElement } from "../core/element-query";
import { findFirst } from "../core/element-query";
import type { ActionExecutorLike } from "../state/transition-executor";
import type { ActionType } from "../types/transition";
import { generateStableId } from "../discovery/stable-id";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionStep {
  target: ElementQuery;
  action: ActionType;
  params?: Record<string, unknown>;
  waitBefore?: WaitSpec;
  waitAfter?: WaitSpec;
}

export interface WaitSpec {
  type: "idle" | "element" | "state" | "time" | "condition" | "vanish" | "change" | "stable";
  query?: ElementQuery;
  stateId?: string;
  ms?: number;
  timeout?: number;
}

export interface SequenceOptions {
  /** Stop executing on first error. Default true. */
  stopOnError?: boolean;
  /** Default wait applied after each step if no step-level waitAfter. */
  defaultWaitAfter?: WaitSpec;
}

export interface ActionResult {
  step: number;
  action: string;
  elementId: string | null;
  success: boolean;
  error?: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Registry-like interface for element lookup
// ---------------------------------------------------------------------------

export interface ElementRegistryLike {
  getAllElements(): QueryableElement[];
}

// ---------------------------------------------------------------------------
// Wait execution
// ---------------------------------------------------------------------------

async function executeWait(
  spec: WaitSpec,
  executor: ActionExecutorLike,
  registry: ElementRegistryLike,
): Promise<void> {
  const timeout = spec.timeout ?? 5_000;

  switch (spec.type) {
    case "idle":
      await executor.waitForIdle(timeout);
      break;

    case "time":
      await new Promise<void>((resolve) =>
        setTimeout(resolve, spec.ms ?? 500),
      );
      break;

    case "element": {
      if (!spec.query) break;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = findFirst(registry.getAllElements(), spec.query);
        if (found) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Wait for element timed out after ${timeout}ms`);
    }

    case "state": {
      if (!spec.stateId) break;
      // State waits are delegated to the executor's idle wait as a fallback;
      // full state waiting requires the state machine which is handled at
      // a higher level (AutomationEngine).
      await executor.waitForIdle(timeout);
      break;
    }

    case "condition": {
      // Condition waits require a predicate that isn't expressible in the
      // serialisable WaitSpec. Fall back to idle wait.
      await executor.waitForIdle(timeout);
      break;
    }

    case "vanish": {
      if (!spec.query) break;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const found = findFirst(registry.getAllElements(), spec.query);
        if (!found) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Wait for element to vanish timed out after ${timeout}ms`);
    }

    case "change": {
      if (!spec.query) break;
      const changeDeadline = Date.now() + timeout;
      const initialFound = findFirst(registry.getAllElements(), spec.query) !== null;
      while (Date.now() < changeDeadline) {
        const nowFound = findFirst(registry.getAllElements(), spec.query) !== null;
        if (nowFound !== initialFound) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Wait for change timed out after ${timeout}ms`);
    }

    case "stable": {
      if (!spec.query) break;
      const stableDeadline = Date.now() + timeout;
      const quietMs = (spec as { quietPeriodMs?: number }).quietPeriodMs ?? 500;
      let lastFound = findFirst(registry.getAllElements(), spec.query) !== null;
      let lastChangeAt = Date.now();
      while (Date.now() < stableDeadline) {
        const nowFound = findFirst(registry.getAllElements(), spec.query) !== null;
        if (nowFound !== lastFound) {
          lastFound = nowFound;
          lastChangeAt = Date.now();
        }
        if (Date.now() - lastChangeAt >= quietMs) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Wait for stable timed out after ${timeout}ms`);
    }
  }
}

// ---------------------------------------------------------------------------
// Sequence execution
// ---------------------------------------------------------------------------

/**
 * Execute an ordered sequence of action steps, collecting results.
 */
export async function executeSequence(
  steps: ActionStep[],
  executor: ActionExecutorLike,
  registry: ElementRegistryLike,
  options?: SequenceOptions,
): Promise<ActionResult[]> {
  const stopOnError = options?.stopOnError ?? true;
  const defaultWait: WaitSpec = options?.defaultWaitAfter ?? {
    type: "idle",
    timeout: 5_000,
  };

  const results: ActionResult[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const start = Date.now();
    let elementId: string | null = null;

    try {
      // Pre-wait
      if (step.waitBefore) {
        await executeWait(step.waitBefore, executor, registry);
      }

      // Find target element
      const match = findFirst(registry.getAllElements(), step.target);
      if (!match) {
        throw new Error("Target element not found");
      }
      elementId = match.id;

      // Try to generate a stable ID for reporting
      const allElements = registry.getAllElements();
      const qe = allElements.find((e) => e.id === match.id);
      if (qe) {
        try {
          elementId = generateStableId(qe.element);
        } catch {
          // Keep the registry ID if stable ID generation fails
        }
      }

      // Execute the action
      await executor.executeAction(match.id, step.action, step.params);

      // Post-wait
      const waitSpec = step.waitAfter ?? defaultWait;
      await executeWait(waitSpec, executor, registry);

      results.push({
        step: i,
        action: step.action,
        elementId,
        success: true,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);

      results.push({
        step: i,
        action: step.action,
        elementId,
        success: false,
        error: message,
        durationMs: Date.now() - start,
      });

      if (stopOnError) break;
    }
  }

  return results;
}
