/**
 * Higher-level control flow executors for action chains.
 *
 * Provides loop, try-catch, switch-case, and repeat-until patterns
 * that compose on top of ActionChain and ActionExecutorLike.
 */

import type { ElementQuery } from '../core/element-query';
import type { ActionExecutorLike } from '../state/transition-executor';
import type { ChainStep, ChainContext, ClickUntilCondition } from './action-chain';
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

// ---------------------------------------------------------------------------
// clickUntil
// ---------------------------------------------------------------------------

/**
 * Click an element repeatedly until a condition is met.
 *
 * Useful for stepping through wizards, dismissing repeated dialogs, or
 * paginating until a target element appears or disappears.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param clickTarget - Query for the element to click each iteration.
 * @param condition - When to stop clicking.
 * @param options - Iteration, pause, and timeout limits.
 * @returns The accumulated ChainContext.
 */
export async function clickUntil(
  executor: ActionExecutorLike,
  clickTarget: ElementQuery,
  condition: ClickUntilCondition,
  options?: {
    /** Maximum number of click repetitions (default 10). */
    maxRepetitions?: number;
    /** Pause between clicks (ms, default 0). */
    pauseBetweenMs?: number;
    /** Overall timeout (ms, default 30000). */
    timeout?: number;
  },
): Promise<ChainContext> {
  const maxReps = options?.maxRepetitions ?? 10;
  const pauseBetween = options?.pauseBetweenMs ?? 0;
  const timeout = options?.timeout ?? 30_000;
  const deadline = Date.now() + timeout;

  const clickStep: ChainStep = {
    type: 'action',
    query: clickTarget,
    action: 'click',
  };

  return loop(executor, [clickStep], {
    maxIterations: maxReps,
    condition: (ctx) => {
      if (Date.now() >= deadline) {
        ctx.errors.push(new Error(`clickUntil timed out after ${timeout}ms`));
        ctx.aborted = true;
        return false;
      }

      // Check condition after each click.
      const found = executor.findElement(condition.query);
      const conditionMet =
        condition.type === 'elementAppears'
          ? found !== null
          : found === null;

      if (conditionMet) {
        ctx.variables._conditionMet = true;
        return false; // Stop.
      }

      return true; // Keep clicking.
    },
    delayBetween: pauseBetween,
  });
}

// ---------------------------------------------------------------------------
// forEach
// ---------------------------------------------------------------------------

/**
 * Iterate over a collection, executing steps for each item.
 *
 * Sets `itemVariable` and `_index` in context for each iteration.
 * Supports early exit via `_break` and skip via `_continue` context variables.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param steps - Steps to execute for each item.
 * @param collection - The array to iterate over.
 * @param itemVariable - Variable name to store the current item.
 * @param options - Iteration limits and delays.
 * @returns The accumulated ChainContext.
 */
export async function forEach(
  executor: ActionExecutorLike,
  steps: ChainStep[],
  collection: unknown[],
  itemVariable: string,
  options?: {
    /** Maximum iterations (default 1000). */
    maxIterations?: number;
    /** Delay between iterations in ms (default 0). */
    delayBetween?: number;
  },
): Promise<ChainContext> {
  const max = Math.min(collection.length, options?.maxIterations ?? 1000);
  const delayBetween = options?.delayBetween ?? 0;
  const ctx = createChainContext();

  for (let i = 0; i < max; i++) {
    if (ctx.aborted) break;
    delete ctx.variables._continue;

    ctx.variables[itemVariable] = collection[i];
    ctx.variables._index = i;
    ctx.variables._length = collection.length;

    // Seed iteration variables into inner steps so the loop body can access them.
    const seededSteps: ChainStep[] = [
      { type: 'setVariable', variable: itemVariable, value: collection[i] },
      { type: 'setVariable', variable: '_index', value: i },
      { type: 'setVariable', variable: '_length', value: collection.length },
      ...steps,
    ];

    const chain = new ActionChain(executor);
    const iterResult = await chain.execute(seededSteps, { stopOnError: false });

    ctx.results.push(...iterResult.context.results);
    ctx.errors.push(...iterResult.context.errors);
    Object.assign(ctx.variables, iterResult.context.variables);

    if (iterResult.context.aborted) {
      ctx.aborted = true;
      break;
    }

    if (ctx.variables._break) {
      delete ctx.variables._break;
      break;
    }

    if (delayBetween > 0 && i < max - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayBetween));
    }
  }

  delete ctx.variables[itemVariable];
  delete ctx.variables._index;
  delete ctx.variables._length;
  delete ctx.variables._continue;
  delete ctx.variables._break;

  return ctx;
}

// ---------------------------------------------------------------------------
// retryChain
// ---------------------------------------------------------------------------

/**
 * Execute a chain of steps with retry on failure.
 *
 * Retries the entire sequence up to `maxAttempts` times. On each failure,
 * waits `delayMs` before retrying. Returns the context from the first
 * successful attempt, or an error context if all attempts fail.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param steps - Steps to execute (retried as a unit).
 * @param options - Retry configuration.
 * @returns The ChainContext from the first successful attempt.
 */
export async function retryChain(
  executor: ActionExecutorLike,
  steps: ChainStep[],
  options?: {
    /** Maximum attempts (default 3). */
    maxAttempts?: number;
    /** Delay between attempts in ms (default 500). */
    delayMs?: number;
  },
): Promise<ChainContext> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const delayMs = options?.delayMs ?? 500;
  const ctx = createChainContext();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const chain = new ActionChain(executor);
    const result = await chain.execute(steps, { stopOnError: true });

    if (result.success) {
      ctx.results.push(...result.context.results);
      Object.assign(ctx.variables, result.context.variables);
      return ctx;
    }

    ctx.results.push(...result.context.results);

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  ctx.errors.push(new Error(`retryChain: all ${maxAttempts} attempts failed`));
  return ctx;
}

// ---------------------------------------------------------------------------
// priorityExecute
// ---------------------------------------------------------------------------

/**
 * Try alternative step sequences in order, returning on first success.
 *
 * Each alternative is executed independently. The first one that completes
 * without errors wins. If all fail, the context contains an error.
 *
 * @param executor - An ActionExecutorLike to use.
 * @param alternatives - Arrays of steps to try in priority order.
 * @returns The ChainContext from the first successful alternative.
 */
export async function priorityExecute(
  executor: ActionExecutorLike,
  alternatives: ChainStep[][],
): Promise<ChainContext> {
  const ctx = createChainContext();

  for (const alt of alternatives) {
    const chain = new ActionChain(executor);
    const result = await chain.execute(alt, { stopOnError: true });

    if (result.success) {
      ctx.results.push(...result.context.results);
      Object.assign(ctx.variables, result.context.variables);
      return ctx;
    }
  }

  ctx.errors.push(new Error('priorityExecute: all alternatives failed'));
  return ctx;
}
