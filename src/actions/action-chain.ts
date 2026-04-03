/**
 * Sequential and parallel action chains with conditional branching.
 *
 * An ActionChain executes a list of ChainSteps — actions, waits, branches,
 * parallel sub-chains, data extractions, and assertions. Each step produces
 * results that accumulate in a ChainContext shared across the chain.
 */

import type { ElementQuery } from '../core/element-query';
import type { ActionType, WaitSpec } from '../types/transition';
import type { ActionRecord, RepetitionOptions } from '../types/action';
import {
  createActionRecord,
  markExecuting,
  markCompleted,
  markFailed,
} from '../types/action';
import type { ActionExecutorLike } from '../state/transition-executor';

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

/** Condition for the clickUntil step. */
export interface ClickUntilCondition {
  /** What to check after each click. */
  type: 'elementAppears' | 'elementVanishes';
  /** Element query for the condition check. */
  query: ElementQuery;
}

/** A single step in an action chain. */
export type ChainStep =
  | { type: 'action'; query: ElementQuery; action: ActionType; params?: Record<string, unknown>; repetition?: RepetitionOptions }
  | { type: 'wait'; spec: WaitSpec }
  | { type: 'branch'; condition: (context: ChainContext) => boolean; ifTrue: ChainStep[]; ifFalse?: ChainStep[] }
  | { type: 'parallel'; steps: ChainStep[][] }
  | { type: 'extract'; query: ElementQuery; property: string; variable: string }
  | { type: 'assert'; query: ElementQuery; property: string; expected: unknown }
  | { type: 'clickUntil'; query: ElementQuery; condition: ClickUntilCondition; maxRepetitions?: number; pauseBetweenMs?: number; timeout?: number };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Shared context accumulated during chain execution. */
export interface ChainContext {
  /** Named variables extracted during execution. */
  variables: Record<string, unknown>;
  /** All ActionRecords produced by action steps. */
  results: ActionRecord[];
  /** Errors encountered during execution. */
  errors: Error[];
  /** Whether the chain was aborted early. */
  aborted: boolean;
}

/** Result returned by ActionChain.execute(). */
export interface ChainResult {
  /** Whether all steps completed without errors. */
  success: boolean;
  /** The accumulated execution context. */
  context: ChainContext;
}

/** Create an empty ChainContext. */
export function createChainContext(): ChainContext {
  return {
    variables: {},
    results: [],
    errors: [],
    aborted: false,
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for chain execution. */
export interface ChainOptions {
  /** Stop execution on the first error (default true). */
  stopOnError?: boolean;
  /** Overall timeout for the entire chain in ms. */
  timeout?: number;
  /** Callback invoked after each step completes. */
  onStepComplete?: (step: ChainStep, result: ActionRecord | null) => void;
}

// ---------------------------------------------------------------------------
// ActionChain
// ---------------------------------------------------------------------------

/** The executor interface used by ActionChain. Same as ActionExecutorLike. */
export type ChainExecutor = ActionExecutorLike;

/**
 * Executes chains of action steps sequentially, with support for branching,
 * parallel execution, data extraction, and assertions.
 *
 * Can be constructed with steps up front or by passing steps to execute().
 */
export class ActionChain {
  private nextId = 1;
  private readonly _executor: ChainExecutor;
  private readonly _steps: ChainStep[];
  private readonly _options: ChainOptions;

  /**
   * Create a new ActionChain.
   *
   * @param executor - An ActionExecutorLike for finding and acting on elements.
   * @param steps - Optional initial steps (can also pass to execute()).
   * @param options - Default execution options.
   */
  constructor(
    executor: ChainExecutor,
    steps?: ChainStep[],
    options?: ChainOptions,
  ) {
    this._executor = executor;
    this._steps = steps ?? [];
    this._options = { stopOnError: true, ...options };
  }

  /**
   * Execute the chain (or provided steps).
   *
   * @param steps - Steps to execute. If omitted, uses the steps from the constructor.
   * @param options - Execution options. If omitted, uses the options from the constructor.
   * @returns A ChainResult with success flag and accumulated context.
   */
  async execute(
    steps?: ChainStep[],
    options?: ChainOptions,
  ): Promise<ChainResult> {
    const stepsToRun = steps ?? this._steps;
    const opts: ChainOptions = { ...this._options, ...options };
    const ctx = createChainContext();
    let success = true;

    const timeoutAt = opts.timeout
      ? Date.now() + opts.timeout
      : Number.MAX_SAFE_INTEGER;

    await this.executeSteps(stepsToRun, ctx, opts, timeoutAt);

    if (ctx.errors.length > 0 || ctx.aborted) {
      success = false;
    }

    return { success, context: ctx };
  }

  // -------------------------------------------------------------------------
  // Internal step execution
  // -------------------------------------------------------------------------

  /** Execute a list of steps in order. */
  private async executeSteps(
    steps: ChainStep[],
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    for (const step of steps) {
      if (ctx.aborted) break;

      if (Date.now() >= timeoutAt) {
        ctx.errors.push(new Error('Chain execution timed out'));
        ctx.aborted = true;
        break;
      }

      try {
        await this.executeStep(step, ctx, opts, timeoutAt);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        ctx.errors.push(error);
        if (opts.stopOnError) {
          ctx.aborted = true;
          break;
        }
      }
    }
  }

  /** Execute a single step. */
  private async executeStep(
    step: ChainStep,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    switch (step.type) {
      case 'action':
        await this.executeActionStep(step, ctx, opts);
        break;
      case 'wait':
        await this.executeWaitStep(step);
        break;
      case 'branch':
        await this.executeBranchStep(step, ctx, opts, timeoutAt);
        break;
      case 'parallel':
        await this.executeParallelStep(step, ctx, opts, timeoutAt);
        break;
      case 'extract':
        await this.executeExtractStep(step, ctx);
        break;
      case 'assert':
        await this.executeAssertStep(step, ctx);
        break;
      case 'clickUntil':
        await this.executeClickUntilStep(step, ctx, opts);
        break;
    }
  }

  /** Execute an action step using the ActionExecutorLike interface. */
  private async executeActionStep(
    step: Extract<ChainStep, { type: 'action' }>,
    ctx: ChainContext,
    opts: ChainOptions,
  ): Promise<void> {
    const count = step.repetition?.count ?? 1;
    const maxReps = step.repetition?.maxRepetitions ?? count;
    const reps = Math.min(count, maxReps);
    const pauseBetween = step.repetition?.pauseBetweenMs ?? 0;

    for (let rep = 0; rep < reps; rep++) {
      const found = this._executor.findElement(step.query);
      const recordId = `chain-action-${this.nextId++}`;

      if (!found) {
        const record = createActionRecord(
          recordId,
          step.action,
          'not-found',
          undefined,
          step.params,
        );
        markFailed(record, `No element found matching query: ${JSON.stringify(step.query)}`);
        ctx.results.push(record);

        opts.onStepComplete?.(step, record);
        throw new Error(record.error);
      }

      const record = createActionRecord(
        recordId,
        step.action,
        found.id,
        undefined,
        step.params,
      );
      markExecuting(record);

      try {
        await this._executor.executeAction(found.id, step.action, step.params);
        markCompleted(record);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markFailed(record, message);
      }

      ctx.results.push(record);
      opts.onStepComplete?.(step, record);

      if (record.status === 'failed') {
        throw new Error(record.error ?? `Action "${step.action}" failed`);
      }

      // Pause between repetitions.
      if (rep < reps - 1 && pauseBetween > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseBetween));
      }
    }
  }

  /** Execute a wait step. */
  private async executeWaitStep(
    step: Extract<ChainStep, { type: 'wait' }>,
  ): Promise<void> {
    const spec = step.spec;

    switch (spec.type) {
      case 'time': {
        const ms = spec.ms ?? 1000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        break;
      }
      case 'idle': {
        await this._executor.waitForIdle(spec.timeout);
        break;
      }
      case 'element':
      case 'state':
      case 'condition': {
        const timeout = spec.timeout ?? 10_000;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        break;
      }
      case 'vanish': {
        const timeout = spec.timeout ?? 10_000;
        const interval = 100;
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (spec.query) {
            const found = this._executor.findElement({
              text: spec.query.text,
              role: spec.query.role,
              ariaLabel: spec.query.ariaLabel,
            });
            if (!found) return; // Element vanished
          }
          await new Promise((resolve) => setTimeout(resolve, interval));
        }
        throw new Error(`waitForVanish timed out after ${timeout}ms`);
      }
    }
  }

  /** Execute a branch step. */
  private async executeBranchStep(
    step: Extract<ChainStep, { type: 'branch' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    const branchTaken = step.condition(ctx);
    const stepsToRun = branchTaken ? step.ifTrue : (step.ifFalse ?? []);
    await this.executeSteps(stepsToRun, ctx, opts, timeoutAt);
  }

  /** Execute parallel sub-chains. */
  private async executeParallelStep(
    step: Extract<ChainStep, { type: 'parallel' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    const subContexts = await Promise.all(
      step.steps.map(async (subSteps) => {
        const subCtx = createChainContext();
        subCtx.variables = { ...ctx.variables };
        await this.executeSteps(subSteps, subCtx, opts, timeoutAt);
        return subCtx;
      }),
    );

    for (const sub of subContexts) {
      ctx.results.push(...sub.results);
      ctx.errors.push(...sub.errors);
      Object.assign(ctx.variables, sub.variables);
      if (sub.aborted) ctx.aborted = true;
    }
  }

  /** Execute an extract step — stores element ID as the extracted value. */
  private async executeExtractStep(
    step: Extract<ChainStep, { type: 'extract' }>,
    ctx: ChainContext,
  ): Promise<void> {
    const found = this._executor.findElement(step.query);
    if (!found) {
      throw new Error(
        `Extract failed: no element found matching query: ${JSON.stringify(step.query)}`,
      );
    }
    ctx.variables[step.variable] = found.id;
  }

  /**
   * Execute an assert step.
   *
   * Verifies that an element's property matches the expected value.
   * Since ActionExecutorLike only provides findElement, we verify
   * text-based properties by constructing a refined query that
   * includes the expected value as a text constraint.
   */
  private async executeAssertStep(
    step: Extract<ChainStep, { type: 'assert' }>,
    ctx: ChainContext,
  ): Promise<void> {
    // First, verify the element exists.
    const found = this._executor.findElement(step.query);
    if (!found) {
      throw new Error(
        `Assertion failed: no element found matching query: ${JSON.stringify(step.query)}`,
      );
    }

    // For text-based properties, verify by constructing a query that includes
    // the expected text and checking if it resolves to the same element.
    if (
      (step.property === 'textContent' || step.property === 'text') &&
      typeof step.expected === 'string'
    ) {
      const verifyQuery: ElementQuery = { ...step.query, text: step.expected };
      const verified = this._executor.findElement(verifyQuery);
      if (!verified || verified.id !== found.id) {
        throw new Error(
          `Assertion failed: expected ${step.property}=${JSON.stringify(step.expected)} on element "${found.id}"`,
        );
      }
    }
  }

  /** Execute a clickUntil step — repeatedly clicks until a condition is met. */
  private async executeClickUntilStep(
    step: Extract<ChainStep, { type: 'clickUntil' }>,
    ctx: ChainContext,
    opts: ChainOptions,
  ): Promise<void> {
    const maxReps = step.maxRepetitions ?? 10;
    const pauseBetween = step.pauseBetweenMs ?? 0;
    const timeout = step.timeout ?? 30_000;
    const started = Date.now();

    for (let i = 0; i < maxReps; i++) {
      if (Date.now() - started > timeout) {
        throw new Error(`clickUntil timed out after ${timeout}ms`);
      }

      // Click the target.
      const found = this._executor.findElement(step.query);
      const recordId = `chain-action-${this.nextId++}`;

      if (!found) {
        const record = createActionRecord(recordId, 'click', 'not-found', undefined);
        markFailed(record, `clickUntil: no element found matching query: ${JSON.stringify(step.query)}`);
        ctx.results.push(record);
        throw new Error(record.error);
      }

      const record = createActionRecord(recordId, 'click', found.id);
      markExecuting(record);

      try {
        await this._executor.executeAction(found.id, 'click');
        markCompleted(record);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        markFailed(record, message);
      }

      ctx.results.push(record);
      opts.onStepComplete?.(step, record);

      if (record.status === 'failed') {
        throw new Error(record.error ?? 'clickUntil: click failed');
      }

      // Pause after click to let DOM settle before checking condition.
      if (pauseBetween > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseBetween));
      }

      // Check condition.
      const conditionElement = this._executor.findElement(step.condition.query);
      const conditionMet =
        step.condition.type === 'elementAppears'
          ? conditionElement !== null
          : conditionElement === null;

      if (conditionMet) return;
    }

    throw new Error(`clickUntil: condition not met after ${maxReps} repetitions`);
  }
}
