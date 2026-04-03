/**
 * Higher-level control flow executors for action chains.
 *
 * Provides loop, try-catch, switch-case, and repeat-until patterns
 * that compose on top of ActionChain and ActionExecutorLike.
 */

import type { ElementQuery } from '../core/element-query';
import type { ActionExecutorLike } from '../state/transition-executor';
import type { ChainStep, ChainContext } from './action-chain';
import { ActionChain, createChainContext } from './action-chain';

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

/**
 * Execute steps in a loop until the condition returns false or maxIterations is reached.
 *
 * @param executor - An ActionExecutorLike to use for action execution.
 * @param steps - Steps to execute on each iteration.
 * @param options - Loop configuration.
 * @returns The accumulated ChainContext from all iterations.
 */
export async function loop(
  executor: ActionExecutorLike,
  steps: ChainStep[],
  options: {
    /** Condition evaluated before each iteration. Loop continues while true. */
    condition: (ctx: ChainContext, iteration: number) => boolean;
    /** Maximum number of iterations (default 100). */
    maxIterations?: number;
    /** Delay in ms between iterations (default 0). */
    delayBetween?: number;
  },
): Promise<ChainContext> {
  const maxIterations = options.maxIterations ?? 100;
  const delayBetween = options.delayBetween ?? 0;
  const ctx = createChainContext();

  for (let i = 0; i < maxIterations; i++) {
    if (!options.condition(ctx, i)) break;
    if (ctx.aborted) break;

    const chain = new ActionChain(executor);
    const iterResult = await chain.execute(steps, { stopOnError: false });

    // Merge iteration results into the accumulated context.
    ctx.results.push(...iterResult.context.results);
    ctx.errors.push(...iterResult.context.errors);
    Object.assign(ctx.variables, iterResult.context.variables);

    if (iterResult.context.aborted) {
      ctx.aborted = true;
      break;
    }

    if (delayBetween > 0 && i < maxIterations - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayBetween));
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// tryCatch
// ---------------------------------------------------------------------------

/**
 * Execute steps with try-catch error handling.
 *
 * Runs trySteps first. If any error occurs, runs catchSteps. Always runs
 * finallySteps (if provided) regardless of success or failure.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param trySteps - Steps to attempt.
 * @param catchSteps - Steps to run if trySteps produce an error.
 * @param finallySteps - Steps to run regardless of outcome.
 * @returns The accumulated ChainContext.
 */
export async function tryCatch(
  executor: ActionExecutorLike,
  trySteps: ChainStep[],
  catchSteps: ChainStep[],
  finallySteps?: ChainStep[],
): Promise<ChainContext> {
  const ctx = createChainContext();

  // Try block.
  const tryChain = new ActionChain(executor);
  const tryResult = await tryChain.execute(trySteps, { stopOnError: true });
  ctx.results.push(...tryResult.context.results);
  Object.assign(ctx.variables, tryResult.context.variables);

  if (!tryResult.success) {
    // Store try errors for reference.
    ctx.variables._tryErrors = tryResult.context.errors.map((e) => e.message);

    // Catch block.
    const catchChain = new ActionChain(executor);
    const catchResult = await catchChain.execute(catchSteps, { stopOnError: false });
    ctx.results.push(...catchResult.context.results);
    ctx.errors.push(...catchResult.context.errors);
    Object.assign(ctx.variables, catchResult.context.variables);

    if (catchResult.context.aborted) ctx.aborted = true;
  }

  // Finally block.
  if (finallySteps && finallySteps.length > 0) {
    const finallyChain = new ActionChain(executor);
    const finallyResult = await finallyChain.execute(finallySteps, {
      stopOnError: false,
    });
    ctx.results.push(...finallyResult.context.results);
    ctx.errors.push(...finallyResult.context.errors);
    Object.assign(ctx.variables, finallyResult.context.variables);
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// switchCase
// ---------------------------------------------------------------------------

/**
 * Execute one of several branches based on a runtime value.
 *
 * Evaluates the value function, looks up the matching case key, and
 * executes those steps. Falls through to defaultCase if no match.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param value - Function that returns the switch value.
 * @param cases - Map of case values to step arrays.
 * @param defaultCase - Steps to run if no case matches.
 * @returns The ChainContext from the executed branch.
 */
export async function switchCase(
  executor: ActionExecutorLike,
  value: () => string | number,
  cases: Record<string, ChainStep[]>,
  defaultCase?: ChainStep[],
): Promise<ChainContext> {
  const chain = new ActionChain(executor);
  const key = String(value());
  const steps = cases[key] ?? defaultCase ?? [];
  const result = await chain.execute(steps, { stopOnError: true });
  return result.context;
}

// ---------------------------------------------------------------------------
// repeatUntilElement
// ---------------------------------------------------------------------------

/**
 * Execute steps repeatedly until a target element appears.
 *
 * Useful for scrolling, pagination, or waiting for lazy-loaded content
 * where you need to perform an action (e.g., scroll down) until a
 * target element materializes.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param steps - Steps to execute on each iteration.
 * @param target - Query for the element to wait for.
 * @param options - Iteration and timeout limits.
 * @returns The accumulated ChainContext.
 */
export async function repeatUntilElement(
  executor: ActionExecutorLike,
  steps: ChainStep[],
  target: ElementQuery,
  options?: {
    /** Maximum number of iterations (default 50). */
    maxIterations?: number;
    /** Overall timeout in ms (default 30000). */
    timeout?: number;
  },
): Promise<ChainContext> {
  const maxIterations = options?.maxIterations ?? 50;
  const timeout = options?.timeout ?? 30_000;
  const deadline = Date.now() + timeout;

  return loop(executor, steps, {
    maxIterations,
    condition: (ctx) => {
      if (Date.now() >= deadline) {
        ctx.errors.push(new Error(`repeatUntilElement timed out after ${timeout}ms`));
        ctx.aborted = true;
        return false;
      }

      // Check if target element has appeared using the executor's findElement.
      const found = executor.findElement(target);
      if (found) {
        ctx.variables._targetElement = found;
        return false; // Stop iterating.
      }

      return true; // Keep iterating.
    },
    delayBetween: 100,
  });
}
