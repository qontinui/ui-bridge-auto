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
import { applyTransform, computeExpression } from './data-ops-extended';
import type { FlowRegistry } from '../batch/flow';
import type { ChainHooks } from './hooks';
import type { CircuitBreaker } from './hooks';
import type { ActionStep, WaitSpec as BatchWaitSpec } from '../batch/action-sequence';

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
  | { type: 'clickUntil'; query: ElementQuery; condition: ClickUntilCondition; maxRepetitions?: number; pauseBetweenMs?: number; timeout?: number }
  | { type: 'transform'; variable: string; operation: string; args: unknown[] }
  | { type: 'compute'; expression: string; variable: string }
  | { type: 'setVariable'; variable: string; value: unknown }
  | { type: 'scope'; steps: ChainStep[]; initialVars?: Record<string, unknown> }
  | { type: 'forEach'; collection: string; itemVariable: string; steps: ChainStep[]; maxIterations?: number }
  | { type: 'retryBlock'; steps: ChainStep[]; maxAttempts?: number; delayMs?: number }
  | { type: 'priority'; alternatives: ChainStep[][] }
  | { type: 'runFlow'; flowName: string; params?: Record<string, unknown> };

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
  /** Flow registry for runFlow steps. */
  flowRegistry?: FlowRegistry;
  /** Lifecycle hooks for step execution. */
  hooks?: ChainHooks;
  /** Circuit breaker for action steps. */
  circuitBreaker?: CircuitBreaker;
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
      // Stop executing remaining steps if a break or continue signal is pending.
      if (ctx.variables._break || ctx.variables._continue) break;

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
    // Circuit breaker check for action steps.
    if (step.type === 'action' && opts.circuitBreaker) {
      const cbKey = step.action;
      if (opts.circuitBreaker.isOpen(cbKey)) {
        throw new Error(`Circuit breaker open for action "${cbKey}" — skipping`);
      }
    }

    // Before-step hook.
    if (opts.hooks?.beforeStep) {
      await opts.hooks.beforeStep(step, ctx);
    }

    try {
      await this.executeStepDispatch(step, ctx, opts, timeoutAt);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Record failure on circuit breaker.
      if (step.type === 'action' && opts.circuitBreaker) {
        opts.circuitBreaker.recordFailure(step.action);
      }

      // Error hook.
      if (opts.hooks?.onError) {
        await opts.hooks.onError(step, error, ctx);
      }

      // After-step hook with error.
      if (opts.hooks?.afterStep) {
        await opts.hooks.afterStep(step, ctx, error);
      }

      throw error;
    }

    // Record success on circuit breaker.
    if (step.type === 'action' && opts.circuitBreaker) {
      opts.circuitBreaker.recordSuccess(step.action);
    }

    // After-step hook (success).
    if (opts.hooks?.afterStep) {
      await opts.hooks.afterStep(step, ctx);
    }
  }

  /** Dispatch a step to the appropriate handler. */
  private async executeStepDispatch(
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
      case 'transform':
        this.executeTransformStep(step, ctx);
        break;
      case 'compute':
        this.executeComputeStep(step, ctx);
        break;
      case 'setVariable':
        ctx.variables[step.variable] = step.value;
        break;
      case 'scope':
        await this.executeScopeStep(step, ctx, opts, timeoutAt);
        break;
      case 'forEach':
        await this.executeForEachStep(step, ctx, opts, timeoutAt);
        break;
      case 'retryBlock':
        await this.executeRetryBlockStep(step, ctx, opts, timeoutAt);
        break;
      case 'priority':
        await this.executePriorityStep(step, ctx, opts, timeoutAt);
        break;
      case 'runFlow':
        await this.executeRunFlowStep(step, ctx, opts, timeoutAt);
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
      case 'change': {
        // In the chain context, we can only detect element presence changes
        // since ActionExecutorLike doesn't expose element properties.
        // Poll findElement and detect when the element appears/disappears.
        const changeTimeout = spec.timeout ?? 10_000;
        const changeInterval = 100;
        const changeStarted = Date.now();
        const initiallyPresent = spec.query
          ? this._executor.findElement({ text: spec.query.text, role: spec.query.role, ariaLabel: spec.query.ariaLabel }) !== null
          : false;
        while (Date.now() - changeStarted < changeTimeout) {
          if (spec.query) {
            const nowPresent = this._executor.findElement({
              text: spec.query.text,
              role: spec.query.role,
              ariaLabel: spec.query.ariaLabel,
            }) !== null;
            if (nowPresent !== initiallyPresent) return; // Changed
          }
          await new Promise((resolve) => setTimeout(resolve, changeInterval));
        }
        throw new Error(`waitForChange timed out after ${changeTimeout}ms`);
      }
      case 'stable': {
        // Wait until element presence stops changing for quietPeriodMs.
        const stableTimeout = spec.timeout ?? 10_000;
        const quietPeriod = spec.quietPeriodMs ?? 500;
        const stableInterval = 50;
        const stableStarted = Date.now();
        let lastState = spec.query
          ? this._executor.findElement({ text: spec.query.text, role: spec.query.role, ariaLabel: spec.query.ariaLabel }) !== null
          : false;
        let lastChangeTime = Date.now();
        while (Date.now() - stableStarted < stableTimeout) {
          if (spec.query) {
            const nowPresent = this._executor.findElement({
              text: spec.query.text,
              role: spec.query.role,
              ariaLabel: spec.query.ariaLabel,
            }) !== null;
            if (nowPresent !== lastState) {
              lastState = nowPresent;
              lastChangeTime = Date.now();
            }
          }
          if (Date.now() - lastChangeTime >= quietPeriod) return; // Stable
          await new Promise((resolve) => setTimeout(resolve, stableInterval));
        }
        throw new Error(`waitForStable timed out after ${stableTimeout}ms`);
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
    // Count assertion: check how many elements match the query.
    if (step.property === 'count') {
      if (!this._executor.findAllElements) {
        throw new Error('assertCount: findAllElements not available on executor');
      }
      const matches = this._executor.findAllElements(step.query);
      const expectedCount = Number(step.expected);
      if (matches.length !== expectedCount) {
        throw new Error(
          `Assertion failed: expected count ${expectedCount}, got ${matches.length} for query: ${JSON.stringify(step.query)}`,
        );
      }
      return;
    }

    // Spatial relation assertion: check position relative to another element.
    if (step.property === 'spatialRelation') {
      const spec = step.expected as { relation: string; query: ElementQuery };
      if (!spec || !spec.relation || !spec.query) {
        throw new Error('assertRelation: expected must have { relation, query }');
      }
      if (!this._executor.getElementRect) {
        throw new Error('assertRelation: getElementRect not available on executor');
      }
      const foundA = this._executor.findElement(step.query);
      const foundB = this._executor.findElement(spec.query);
      if (!foundA) throw new Error(`assertRelation: element A not found: ${JSON.stringify(step.query)}`);
      if (!foundB) throw new Error(`assertRelation: element B not found: ${JSON.stringify(spec.query)}`);
      const rectA = this._executor.getElementRect(foundA.id);
      const rectB = this._executor.getElementRect(foundB.id);
      if (!rectA || !rectB) throw new Error('assertRelation: could not get element rects');

      const centerA = { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 };
      const centerB = { x: rectB.x + rectB.width / 2, y: rectB.y + rectB.height / 2 };
      let matches = false;
      switch (spec.relation) {
        case 'above': matches = centerA.y < centerB.y; break;
        case 'below': matches = centerA.y > centerB.y; break;
        case 'leftOf': matches = centerA.x < centerB.x; break;
        case 'rightOf': matches = centerA.x > centerB.x; break;
        default: throw new Error(`assertRelation: unknown relation "${spec.relation}"`);
      }
      if (!matches) {
        throw new Error(
          `Assertion failed: element A is not ${spec.relation} element B`,
        );
      }
      return;
    }

    // Standard assertion: verify the element exists.
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

  /** Execute a transform step — apply a data operation to a variable. */
  private executeTransformStep(
    step: Extract<ChainStep, { type: 'transform' }>,
    ctx: ChainContext,
  ): void {
    const value = ctx.variables[step.variable];
    if (value === undefined) {
      throw new Error(`transform: variable "${step.variable}" is not defined`);
    }
    ctx.variables[step.variable] = applyTransform(value, step.operation, step.args);
  }

  /** Execute a compute step — evaluate an arithmetic expression and store the result. */
  private executeComputeStep(
    step: Extract<ChainStep, { type: 'compute' }>,
    ctx: ChainContext,
  ): void {
    ctx.variables[step.variable] = computeExpression(step.expression, ctx.variables);
  }

  /** Execute a scope step — run steps with isolated variables. */
  private async executeScopeStep(
    step: Extract<ChainStep, { type: 'scope' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    const saved = { ...ctx.variables };
    if (step.initialVars) {
      Object.assign(ctx.variables, step.initialVars);
    }
    try {
      await this.executeSteps(step.steps, ctx, opts, timeoutAt);
    } finally {
      ctx.variables = saved;
    }
  }

  /** Execute a forEach step — iterate over a collection variable. */
  private async executeForEachStep(
    step: Extract<ChainStep, { type: 'forEach' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    const collection = ctx.variables[step.collection];
    if (!Array.isArray(collection)) {
      throw new Error(
        `forEach: variable "${step.collection}" is not an array (got ${typeof collection})`,
      );
    }

    const max = Math.min(collection.length, step.maxIterations ?? 1000);

    for (let i = 0; i < max; i++) {
      if (ctx.aborted) break;
      if (Date.now() >= timeoutAt) {
        ctx.errors.push(new Error('forEach: chain execution timed out'));
        ctx.aborted = true;
        break;
      }

      // Clear continue signal from previous iteration.
      delete ctx.variables._continue;

      // Set iteration variables.
      ctx.variables[step.itemVariable] = collection[i];
      ctx.variables._index = i;
      ctx.variables._length = collection.length;

      // Execute inner steps.
      await this.executeSteps(step.steps, ctx, opts, timeoutAt);

      // Check break signal.
      if (ctx.variables._break) {
        delete ctx.variables._break;
        break;
      }
    }

    // Clean up iteration variables.
    delete ctx.variables[step.itemVariable];
    delete ctx.variables._index;
    delete ctx.variables._length;
    delete ctx.variables._continue;
    delete ctx.variables._break;
  }

  /** Execute a retryBlock step — retry a sequence of steps on failure. */
  private async executeRetryBlockStep(
    step: Extract<ChainStep, { type: 'retryBlock' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    const maxAttempts = step.maxAttempts ?? 3;
    const delayMs = step.delayMs ?? 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const subCtx = createChainContext();
      subCtx.variables = { ...ctx.variables };

      await this.executeSteps(step.steps, subCtx, { ...opts, stopOnError: true }, timeoutAt);

      if (subCtx.errors.length === 0) {
        // Success — merge results and variables into parent.
        ctx.results.push(...subCtx.results);
        Object.assign(ctx.variables, subCtx.variables);
        return;
      }

      // Record attempt results even on failure.
      ctx.results.push(...subCtx.results);

      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    ctx.errors.push(new Error(`retryBlock: all ${maxAttempts} attempts failed`));
  }

  /** Execute a priority step — try alternatives in order, use first success. */
  private async executePriorityStep(
    step: Extract<ChainStep, { type: 'priority' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    for (const alternative of step.alternatives) {
      const subCtx = createChainContext();
      subCtx.variables = { ...ctx.variables };

      await this.executeSteps(alternative, subCtx, { ...opts, stopOnError: true }, timeoutAt);

      if (subCtx.errors.length === 0) {
        // Success — merge results and variables into parent.
        ctx.results.push(...subCtx.results);
        Object.assign(ctx.variables, subCtx.variables);
        return;
      }
    }

    ctx.errors.push(new Error('priority: all alternatives failed'));
  }

  /** Execute a runFlow step — run a named flow as a scoped sub-chain. */
  private async executeRunFlowStep(
    step: Extract<ChainStep, { type: 'runFlow' }>,
    ctx: ChainContext,
    opts: ChainOptions,
    timeoutAt: number,
  ): Promise<void> {
    if (!opts.flowRegistry) {
      throw new Error('runFlow: no FlowRegistry configured in ChainOptions');
    }
    const flow = opts.flowRegistry.get(step.flowName);
    if (!flow) {
      throw new Error(`runFlow: flow "${step.flowName}" not found`);
    }

    const chainSteps = actionStepsToChainSteps(flow.steps);

    // Scoped execution: snapshot variables, merge params, execute, restore.
    const saved = { ...ctx.variables };
    if (step.params) {
      Object.assign(ctx.variables, step.params);
    }
    try {
      await this.executeSteps(chainSteps, ctx, opts, timeoutAt);
    } finally {
      ctx.variables = saved;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: convert ActionStep[] to ChainStep[]
// ---------------------------------------------------------------------------

/**
 * Convert a batch WaitSpec to a transition WaitSpec.
 * The batch WaitSpec uses ElementQuery for query, while the transition WaitSpec uses ElementCriteria.
 */
function convertWaitSpec(batchSpec: BatchWaitSpec): WaitSpec {
  return {
    type: batchSpec.type as WaitSpec['type'],
    query: batchSpec.query
      ? { text: batchSpec.query.text, role: batchSpec.query.role, ariaLabel: batchSpec.query.ariaLabel }
      : undefined,
    stateId: batchSpec.stateId,
    ms: batchSpec.ms,
    timeout: batchSpec.timeout,
  };
}

/**
 * Convert batch ActionStep definitions to ChainStep arrays.
 * Each ActionStep becomes an action step, optionally preceded/followed by wait steps.
 */
export function actionStepsToChainSteps(steps: ActionStep[]): ChainStep[] {
  const result: ChainStep[] = [];
  for (const step of steps) {
    if (step.waitBefore) {
      result.push({ type: 'wait', spec: convertWaitSpec(step.waitBefore) });
    }
    result.push({
      type: 'action',
      query: step.target,
      action: step.action,
      params: step.params,
    });
    if (step.waitAfter) {
      result.push({ type: 'wait', spec: convertWaitSpec(step.waitAfter) });
    }
  }
  return result;
}
