/**
 * Recovery strategies for failed actions.
 *
 * Provides strategy selection based on error classification, strategy
 * application with retry/fallback logic, and factory functions for
 * common strategy presets.
 */

import type { ElementQuery, QueryableElement } from "../core/element-query";
import type { ActionExecutorLike } from "../state/transition-executor";
import type { ClassifiedError } from "./error-classifier";
import type { ElementRelocator } from "./element-relocator";
import type { StateRecovery } from "./state-recovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available recovery strategy types. */
export type StrategyType =
  | "retry"
  | "fallback"
  | "alternativePath"
  | "resetAndRetry"
  | "wait";

/** A recovery strategy configuration. */
export interface RecoveryStrategy {
  type: StrategyType;
  maxAttempts?: number;
  delayMs?: number;
  fallbackQuery?: ElementQuery;
  resetAction?: () => Promise<void>;
}

/** Result of applying a recovery strategy. */
export interface StrategyResult {
  recovered: boolean;
  strategy: StrategyType;
  attempts: number;
  error?: string;
}

/** Context for applying a recovery strategy. */
export interface StrategyContext {
  executor: ActionExecutorLike;
  relocator: ElementRelocator;
  stateRecovery?: StateRecovery;
  error: Error;
}

// ---------------------------------------------------------------------------
// Strategy application
// ---------------------------------------------------------------------------

/**
 * Apply a recovery strategy to a failed action.
 *
 * Executes the strategy logic (retry, wait, fallback, etc.) and returns
 * whether recovery was successful.
 */
export async function applyStrategy(
  strategy: RecoveryStrategy,
  failedAction: () => Promise<void>,
  context: StrategyContext,
): Promise<StrategyResult> {
  const maxAttempts = strategy.maxAttempts ?? 3;
  const delayMs = strategy.delayMs ?? 500;

  switch (strategy.type) {
    case "retry":
      return applyRetry(failedAction, maxAttempts, delayMs);

    case "wait":
      return applyWait(failedAction, delayMs);

    case "fallback":
      return applyFallback(strategy, context);

    case "resetAndRetry":
      return applyResetAndRetry(
        failedAction,
        strategy.resetAction,
        maxAttempts,
        delayMs,
      );

    case "alternativePath":
      // Alternative path strategies delegate to StateRecovery
      return {
        recovered: false,
        strategy: "alternativePath",
        attempts: 0,
        error: "alternativePath strategy requires manual StateRecovery integration",
      };

    default:
      return {
        recovered: false,
        strategy: strategy.type,
        attempts: 0,
        error: `Unknown strategy type: ${strategy.type}`,
      };
  }
}

// ---------------------------------------------------------------------------
// Strategy selection
// ---------------------------------------------------------------------------

/**
 * Select the best recovery strategy based on error classification.
 */
export function selectStrategy(classified: ClassifiedError): RecoveryStrategy {
  switch (classified.suggestedAction) {
    case "retry":
      return retryStrategy(3, 500);

    case "relocate":
      return retryStrategy(2, 300);

    case "wait":
      return waitStrategy(2000);

    case "reroute":
      return { type: "alternativePath" };

    case "abort":
    default:
      return retryStrategy(1, 0);
  }
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

/** Create a retry strategy with the given parameters. */
export function retryStrategy(
  maxAttempts = 3,
  delayMs = 500,
): RecoveryStrategy {
  return { type: "retry", maxAttempts, delayMs };
}

/** Create a fallback strategy that uses an alternative element query. */
export function fallbackStrategy(query: ElementQuery): RecoveryStrategy {
  return { type: "fallback", fallbackQuery: query };
}

/** Create a wait strategy that pauses before retrying. */
export function waitStrategy(delayMs: number): RecoveryStrategy {
  return { type: "wait", delayMs, maxAttempts: 1 };
}

// ---------------------------------------------------------------------------
// Internal strategy implementations
// ---------------------------------------------------------------------------

async function applyRetry(
  action: () => Promise<void>,
  maxAttempts: number,
  delayMs: number,
): Promise<StrategyResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await action();
      return { recovered: true, strategy: "retry", attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  return {
    recovered: false,
    strategy: "retry",
    attempts: maxAttempts,
    error: lastError,
  };
}

async function applyWait(
  action: () => Promise<void>,
  delayMs: number,
): Promise<StrategyResult> {
  await sleep(delayMs);

  try {
    await action();
    return { recovered: true, strategy: "wait", attempts: 1 };
  } catch (err) {
    return {
      recovered: false,
      strategy: "wait",
      attempts: 1,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function applyFallback(
  strategy: RecoveryStrategy,
  context: StrategyContext,
): Promise<StrategyResult> {
  if (!strategy.fallbackQuery) {
    return {
      recovered: false,
      strategy: "fallback",
      attempts: 0,
      error: "No fallback query provided",
    };
  }

  try {
    const found = context.executor.findElement(strategy.fallbackQuery);
    if (!found) {
      return {
        recovered: false,
        strategy: "fallback",
        attempts: 1,
        error: "Fallback element not found",
      };
    }

    await context.executor.executeAction(found.id, "click");
    return { recovered: true, strategy: "fallback", attempts: 1 };
  } catch (err) {
    return {
      recovered: false,
      strategy: "fallback",
      attempts: 1,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function applyResetAndRetry(
  action: () => Promise<void>,
  resetAction: (() => Promise<void>) | undefined,
  maxAttempts: number,
  delayMs: number,
): Promise<StrategyResult> {
  if (resetAction) {
    try {
      await resetAction();
    } catch {
      // Reset failed — still try the action
    }
  }

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  return applyRetry(action, maxAttempts, delayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
