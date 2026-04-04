/**
 * Fluent builder API for composing action chains.
 *
 * Provides a readable, chainable interface for constructing sequences of
 * DOM actions, waits, branches, extractions, and assertions without
 * manually assembling ChainStep arrays.
 */

import type { ElementQuery } from '../core/element-query';
import type { ActionType, WaitSpec } from '../types/transition';
import type { ChainStep, ChainContext, ChainOptions, ChainResult, ClickUntilCondition } from './action-chain';
import { ActionChain } from './action-chain';
import type { ActionExecutorLike } from '../state/transition-executor';
import type { FlowRegistry } from '../batch/flow';
import type { ChainHooks, CircuitBreakerConfig } from './hooks';
import { CircuitBreaker } from './hooks';

// ---------------------------------------------------------------------------
// ChainBuilder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for composing action chains.
 *
 * Accepts any ActionExecutorLike, including MockActionExecutor in tests.
 *
 * Usage:
 * ```ts
 * const result = await new ChainBuilder(executor)
 *   .click({ role: 'button', text: 'Login' })
 *   .type({ ariaLabel: 'Username' }, 'admin')
 *   .type({ ariaLabel: 'Password' }, 'secret')
 *   .click({ role: 'button', text: 'Submit' })
 *   .waitForElement({ text: 'Welcome' })
 *   .execute();
 * ```
 */
export class ChainBuilder {
  private readonly _steps: ChainStep[] = [];
  private readonly _executor: ActionExecutorLike;
  private readonly _flowRegistry?: FlowRegistry;
  private _hooks?: ChainHooks;
  private _circuitBreaker?: CircuitBreaker;

  constructor(executor: ActionExecutorLike, flowRegistry?: FlowRegistry) {
    this._executor = executor;
    this._flowRegistry = flowRegistry;
  }

  /**
   * Set lifecycle hooks for this chain's execution.
   */
  withHooks(hooks: ChainHooks): ChainBuilder {
    this._hooks = hooks;
    return this;
  }

  /**
   * Enable a circuit breaker for action steps in this chain.
   */
  withCircuitBreaker(config: CircuitBreakerConfig): ChainBuilder {
    this._circuitBreaker = new CircuitBreaker(config);
    return this;
  }

  /**
   * Add a click action.
   */
  click(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'click' });
    return this;
  }

  /**
   * Add a double-click action.
   */
  doubleClick(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'doubleClick' });
    return this;
  }

  /**
   * Add a right-click action.
   */
  rightClick(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'rightClick' });
    return this;
  }

  /**
   * Add a type action. Optionally clear the field first.
   * The text is stored as `params.value` for consistency with other value-bearing actions.
   */
  type(
    query: ElementQuery,
    text: string,
    options?: { clear?: boolean },
  ): ChainBuilder {
    if (options?.clear) {
      this._steps.push({ type: 'action', query, action: 'clear' });
    }
    this._steps.push({
      type: 'action',
      query,
      action: 'type',
      params: { value: text },
    });
    return this;
  }

  /**
   * Add a select action to choose a dropdown option.
   */
  select(query: ElementQuery, value: string): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'select',
      params: { value },
    });
    return this;
  }

  /**
   * Add a check action. If `checked` is false, adds an uncheck instead.
   */
  check(query: ElementQuery, checked = true): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: checked ? 'check' : 'uncheck',
    });
    return this;
  }

  /**
   * Add a hover action.
   */
  hover(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'hover' });
    return this;
  }

  /**
   * Add a focus action.
   */
  focus(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'focus' });
    return this;
  }

  /**
   * Add a blur action.
   */
  blur(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'blur' });
    return this;
  }

  /**
   * Add a submit action.
   */
  submit(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'submit' });
    return this;
  }

  /**
   * Add a setValue action.
   */
  setValue(query: ElementQuery, value: string): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'setValue',
      params: { value },
    });
    return this;
  }

  /**
   * Add a sendKeys action.
   */
  sendKeys(query: ElementQuery, keys: string): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'sendKeys',
      params: { keys },
    });
    return this;
  }

  /**
   * Add a middle-click action.
   */
  middleClick(query: ElementQuery): ChainBuilder {
    this._steps.push({ type: 'action', query, action: 'middleClick' });
    return this;
  }

  /**
   * Add a mouse-down (press and hold) action.
   */
  mouseDown(
    query: ElementQuery,
    button?: 'left' | 'right' | 'middle',
  ): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'mouseDown',
      params: button ? { button } : undefined,
    });
    return this;
  }

  /**
   * Add a mouse-up (release) action.
   */
  mouseUp(
    query: ElementQuery,
    button?: 'left' | 'right' | 'middle',
  ): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'mouseUp',
      params: button ? { button } : undefined,
    });
    return this;
  }

  /**
   * Add a key-down (press and hold key) action.
   */
  keyDown(
    query: ElementQuery,
    keys: string,
    modifiers?: string[],
  ): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'keyDown',
      params: { keys, ...(modifiers ? { modifiers } : {}) },
    });
    return this;
  }

  /**
   * Add a key-up (release key) action.
   */
  keyUp(
    query: ElementQuery,
    keys: string,
    options?: { releaseModifiersFirst?: boolean },
  ): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'keyUp',
      params: {
        keys,
        ...(options?.releaseModifiersFirst != null
          ? { releaseModifiersFirst: options.releaseModifiersFirst }
          : {}),
      },
    });
    return this;
  }

  /**
   * Add a directional scroll action.
   */
  scroll(
    query: ElementQuery,
    options?: {
      direction?: 'up' | 'down' | 'left' | 'right';
      amount?: number;
      smooth?: boolean;
    },
  ): ChainBuilder {
    this._steps.push({
      type: 'action',
      query,
      action: 'scroll',
      params: {
        direction: options?.direction ?? 'down',
        amount: options?.amount ?? 3,
        smooth: options?.smooth ?? true,
      },
    });
    return this;
  }

  /**
   * Add a wait-for-vanish step — waits for an element to disappear from the DOM.
   */
  waitForVanish(query: ElementQuery, timeout?: number): ChainBuilder {
    const spec: WaitSpec = {
      type: 'vanish',
      query: { text: query.text, role: query.role, ariaLabel: query.ariaLabel },
      timeout,
    };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a wait-for-change step — waits for an element property to change.
   */
  waitForChange(query: ElementQuery, property: string, timeout?: number): ChainBuilder {
    const spec: WaitSpec = {
      type: 'change',
      query: { text: query.text, role: query.role, ariaLabel: query.ariaLabel },
      property,
      timeout,
    };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a wait-for-stable step — waits for an element property to stop changing.
   */
  waitForStable(
    query: ElementQuery,
    property: string,
    timeout?: number,
    quietPeriodMs?: number,
  ): ChainBuilder {
    const spec: WaitSpec = {
      type: 'stable',
      query: { text: query.text, role: query.role, ariaLabel: query.ariaLabel },
      property,
      timeout,
      quietPeriodMs,
    };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a clickUntil step — repeatedly clicks until a condition is met.
   */
  clickUntil(
    query: ElementQuery,
    condition: ClickUntilCondition,
    options?: {
      maxRepetitions?: number;
      pauseBetweenMs?: number;
      timeout?: number;
    },
  ): ChainBuilder {
    this._steps.push({
      type: 'clickUntil',
      query,
      condition,
      maxRepetitions: options?.maxRepetitions,
      pauseBetweenMs: options?.pauseBetweenMs,
      timeout: options?.timeout,
    });
    return this;
  }

  /**
   * Annotate the last action step with repetition.
   * Fluent modifier — modifies the most-recently-pushed action step.
   */
  repeat(count: number, pauseBetweenMs?: number): ChainBuilder {
    const lastStep = this._steps[this._steps.length - 1];
    if (lastStep && lastStep.type === 'action') {
      lastStep.repetition = { count, pauseBetweenMs };
    }
    return this;
  }

  /**
   * Add a transform step — apply a data operation to a chain variable.
   * Auto-detects string/math/collection operation based on value type.
   */
  transform(variable: string, operation: string, ...args: unknown[]): ChainBuilder {
    this._steps.push({ type: 'transform', variable, operation, args });
    return this;
  }

  /**
   * Add a compute step — evaluate an arithmetic expression and store the result.
   * Expression format: "varA + varB", "price * quantity", "count - 1".
   * Tokens are resolved as variable names or literal numbers.
   */
  compute(expression: string, variable: string): ChainBuilder {
    this._steps.push({ type: 'compute', expression, variable });
    return this;
  }

  /**
   * Set a variable in the chain context.
   */
  set(variable: string, value: unknown): ChainBuilder {
    this._steps.push({ type: 'setVariable', variable, value });
    return this;
  }

  /**
   * Signal a break from the current forEach loop.
   */
  break(): ChainBuilder {
    this._steps.push({ type: 'setVariable', variable: '_break', value: true });
    return this;
  }

  /**
   * Signal a continue (skip to next iteration) in a forEach loop.
   */
  continue(): ChainBuilder {
    this._steps.push({ type: 'setVariable', variable: '_continue', value: true });
    return this;
  }

  /**
   * Execute steps in an isolated variable scope.
   * Variables created inside the scope are discarded when it exits.
   */
  scope(
    configure: (b: ChainBuilder) => void,
    initialVars?: Record<string, unknown>,
  ): ChainBuilder {
    const subBuilder = new ChainBuilder(this._executor);
    configure(subBuilder);
    this._steps.push({ type: 'scope', steps: subBuilder.steps(), initialVars });
    return this;
  }

  /**
   * Iterate over a collection variable, executing steps for each item.
   * Sets the item variable and _index/_length per iteration.
   * Use .break() and .continue() inside the loop body.
   */
  forEach(
    collection: string,
    itemVariable: string,
    configure: (b: ChainBuilder) => void,
    options?: { maxIterations?: number },
  ): ChainBuilder {
    const subBuilder = new ChainBuilder(this._executor);
    configure(subBuilder);
    this._steps.push({
      type: 'forEach',
      collection,
      itemVariable,
      steps: subBuilder.steps(),
      maxIterations: options?.maxIterations,
    });
    return this;
  }

  /**
   * Retry a block of steps on failure.
   * Retries the entire sequence as a unit up to maxAttempts times.
   */
  retryBlock(
    configure: (b: ChainBuilder) => void,
    options?: { maxAttempts?: number; delayMs?: number },
  ): ChainBuilder {
    const subBuilder = new ChainBuilder(this._executor);
    configure(subBuilder);
    this._steps.push({
      type: 'retryBlock',
      steps: subBuilder.steps(),
      maxAttempts: options?.maxAttempts,
      delayMs: options?.delayMs,
    });
    return this;
  }

  /**
   * Try alternative step sequences in priority order.
   * Executes the first alternative; if it fails, tries the next, and so on.
   */
  priority(...alternatives: ((b: ChainBuilder) => void)[]): ChainBuilder {
    const altSteps = alternatives.map((configure) => {
      const subBuilder = new ChainBuilder(this._executor);
      configure(subBuilder);
      return subBuilder.steps();
    });
    this._steps.push({ type: 'priority', alternatives: altSteps });
    return this;
  }

  /**
   * Add a generic action with arbitrary params.
   */
  action(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
  ): ChainBuilder {
    this._steps.push({ type: 'action', query, action, params });
    return this;
  }

  /**
   * Add a wait-for-idle step.
   */
  waitForIdle(timeout?: number): ChainBuilder {
    const spec: WaitSpec = { type: 'idle', timeout };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a wait-for-element step.
   */
  waitForElement(query: ElementQuery, timeout?: number): ChainBuilder {
    const spec: WaitSpec = {
      type: 'element',
      query: { text: query.text, role: query.role, ariaLabel: query.ariaLabel },
      timeout,
    };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a wait-for-state step.
   */
  waitForState(stateId: string, timeout?: number): ChainBuilder {
    const spec: WaitSpec = { type: 'state', stateId, timeout };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a timed wait step.
   */
  wait(ms: number): ChainBuilder {
    const spec: WaitSpec = { type: 'time', ms };
    this._steps.push({ type: 'wait', spec });
    return this;
  }

  /**
   * Add a conditional branch.
   * Returns a ConditionalBuilder to define the then/else branches.
   */
  if(condition: (ctx: ChainContext) => boolean): ConditionalBuilder {
    return new ConditionalBuilder(this, this._executor, condition);
  }

  /**
   * Extract a value from an element into a named variable.
   */
  extract(
    query: ElementQuery,
    property: string,
    variable: string,
  ): ChainBuilder {
    this._steps.push({ type: 'extract', query, property, variable });
    return this;
  }

  /**
   * Assert an element property equals an expected value.
   */
  assert(
    query: ElementQuery,
    property: string,
    expected: unknown,
  ): ChainBuilder {
    this._steps.push({ type: 'assert', query, property, expected });
    return this;
  }

  /**
   * Assert that the number of elements matching a query equals the expected count.
   * Requires findAllElements on the executor.
   */
  assertCount(query: ElementQuery, expected: number): ChainBuilder {
    this._steps.push({ type: 'assert', query, property: 'count', expected });
    return this;
  }

  /**
   * Assert that element A has a spatial relation to element B.
   * Relations: 'above', 'below', 'leftOf', 'rightOf'.
   * Requires getElementRect on the executor.
   */
  assertRelation(
    queryA: ElementQuery,
    relation: 'above' | 'below' | 'leftOf' | 'rightOf',
    queryB: ElementQuery,
  ): ChainBuilder {
    this._steps.push({
      type: 'assert',
      query: queryA,
      property: 'spatialRelation',
      expected: { relation, query: queryB },
    });
    return this;
  }

  /**
   * Run a named flow as a scoped sub-chain.
   * Requires a FlowRegistry to be passed to the ChainBuilder constructor.
   */
  runFlow(flowName: string, params?: Record<string, unknown>): ChainBuilder {
    this._steps.push({ type: 'runFlow', flowName, params });
    return this;
  }

  /**
   * Execute the built chain.
   */
  async execute(options?: ChainOptions): Promise<ChainResult> {
    const chain = new ActionChain(this._executor);
    const mergedOptions: ChainOptions = {
      ...options,
      flowRegistry: options?.flowRegistry ?? this._flowRegistry,
      hooks: options?.hooks ?? this._hooks,
      circuitBreaker: options?.circuitBreaker ?? this._circuitBreaker,
    };
    return chain.execute(this._steps, mergedOptions);
  }

  /**
   * Get the built steps for inspection or serialization.
   */
  steps(): ChainStep[] {
    return [...this._steps];
  }

  /**
   * Append a raw ChainStep. Used internally by ConditionalBuilder.
   * @internal
   */
  _pushStep(step: ChainStep): void {
    this._steps.push(step);
  }
}

// ---------------------------------------------------------------------------
// ConditionalBuilder
// ---------------------------------------------------------------------------

/**
 * Builder for conditional (if/then/else) chain branches.
 *
 * Usage:
 * ```ts
 * builder
 *   .if((ctx) => ctx.variables.loggedIn === true)
 *     .then((b) => b.click({ text: 'Dashboard' }))
 *     .else((b) => b.click({ text: 'Login' }))
 *   .click({ text: 'Continue' });
 * ```
 */
export class ConditionalBuilder {
  private readonly parent: ChainBuilder;
  private readonly executor: ActionExecutorLike;
  private readonly condition: (ctx: ChainContext) => boolean;
  private ifTrueSteps: ChainStep[] = [];
  private ifFalseSteps: ChainStep[] | undefined;

  constructor(
    parent: ChainBuilder,
    executor: ActionExecutorLike,
    condition: (ctx: ChainContext) => boolean,
  ) {
    this.parent = parent;
    this.executor = executor;
    this.condition = condition;
  }

  /**
   * Define the steps to execute when the condition is true.
   * Each configure function receives a fresh ChainBuilder; its steps
   * are collected into the "then" branch.
   */
  then(...configure: ((b: ChainBuilder) => void)[]): ConditionalBuilder {
    const subBuilder = new ChainBuilder(this.executor);
    for (const fn of configure) {
      fn(subBuilder);
    }
    this.ifTrueSteps = subBuilder.steps();
    return this;
  }

  /**
   * Define the steps to execute when the condition is false.
   * Finalizes the conditional and returns the parent builder for continued chaining.
   */
  else(...configure: ((b: ChainBuilder) => void)[]): ChainBuilder {
    const subBuilder = new ChainBuilder(this.executor);
    for (const fn of configure) {
      fn(subBuilder);
    }
    this.ifFalseSteps = subBuilder.steps();
    this.finalize();
    return this.parent;
  }

  /**
   * Finalize the conditional without an else branch.
   * Returns the parent builder for continued chaining.
   */
  endIf(): ChainBuilder {
    this.finalize();
    return this.parent;
  }

  /** Push the completed branch step into the parent builder. */
  private finalize(): void {
    this.parent._pushStep({
      type: 'branch',
      condition: this.condition,
      ifTrue: this.ifTrueSteps,
      ifFalse: this.ifFalseSteps,
    });
  }
}
