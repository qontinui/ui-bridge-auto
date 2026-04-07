/**
 * Core action executor that operates on registry elements.
 *
 * Finds elements by structural queries, validates action parameters,
 * executes actions through a pluggable performAction callback, and
 * records execution history as ActionRecords.
 */

import type { ElementQuery, QueryableElement, QueryResult } from '../core/element-query';
import { findFirst } from '../core/element-query';
import type { ActionType } from '../types/transition';
import type { ActionRecord, ActionExecutionOptions, VerificationSpec } from '../types/action';
import {
  createActionRecord,
  markExecuting,
  markFailed,
  createDefaultExecutionOptions,
} from '../types/action';
import { withRetry, type RetryOptions } from './retry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended execution options that include retry configuration. */
export interface ExecuteOptions extends Partial<ActionExecutionOptions> {
  /** Retry configuration for transient failures. */
  retry?: Partial<RetryOptions>;
}

/** Configuration for the ActionExecutor. */
export interface ActionExecutorConfig {
  /** Registry to find elements. */
  registry: { getAllElements(): QueryableElement[] };
  /** Function to perform the actual DOM action. */
  performAction: (
    elementId: string,
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<void>;
  /** Function to wait for idle after an action. */
  waitForIdle?: (timeout?: number) => Promise<void>;
  /** Default execution options. */
  defaults?: Partial<ActionExecutionOptions>;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Executes DOM actions on elements found by structural queries.
 *
 * Workflow per action:
 * 1. Find element by query (with optional retry if not found immediately).
 * 2. Validate action params.
 * 3. Create an ActionRecord.
 * 4. Execute the action via the configured performAction callback (with optional retry).
 * 5. Optionally wait for idle.
 * 6. Record timing and result.
 * 7. Return the ActionRecord.
 */
export class ActionExecutor {
  private readonly config: ActionExecutorConfig;
  private readonly defaultOptions: ActionExecutionOptions;
  private history: ActionRecord[] = [];
  private nextId = 1;

  constructor(config: ActionExecutorConfig) {
    this.config = config;
    this.defaultOptions = {
      ...createDefaultExecutionOptions(),
      ...config.defaults,
    };
  }

  /**
   * Execute an action on an element found by query.
   *
   * @param query - Structural query to locate the target element.
   * @param action - The DOM action verb to perform.
   * @param params - Action-specific parameters (e.g., `{ value: "hello" }`).
   * @param options - Execution options (timeouts, retries, etc.).
   * @returns The completed ActionRecord with timing and status.
   */
  async execute(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<ActionRecord> {
    const opts = this.mergeOptions(options);
    const retryOpts = options?.retry;

    // Find the target element, retrying if configured.
    const found = await this.findWithRetry(query, opts);
    if (!found) {
      const record = this.createRecord(action, 'not-found', undefined, params);
      markFailed(record, `No element found matching query: ${JSON.stringify(query)}`);
      this.history.push(record);
      return record;
    }

    return this.executeOnElement(found.id, found.label, action, params, opts, retryOpts);
  }

  /**
   * Execute an action on an element by its registry ID.
   *
   * @param elementId - The registry ID of the target element.
   * @param action - The DOM action verb to perform.
   * @param params - Action-specific parameters.
   * @param options - Execution options.
   * @returns The completed ActionRecord.
   */
  async executeById(
    elementId: string,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<ActionRecord> {
    const opts = this.mergeOptions(options);
    const retryOpts = options?.retry;

    // Verify element exists in registry.
    const elements = this.config.registry.getAllElements();
    const el = elements.find((e) => e.id === elementId);
    if (!el) {
      const record = this.createRecord(action, elementId, undefined, params);
      markFailed(record, `Element with ID "${elementId}" not found in registry.`);
      this.history.push(record);
      return record;
    }

    return this.executeOnElement(elementId, el.label, action, params, opts, retryOpts);
  }

  /**
   * Get all recorded action executions.
   */
  getHistory(): ActionRecord[] {
    return [...this.history];
  }

  /**
   * Clear execution history.
   */
  clearHistory(): void {
    this.history = [];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Internal method to execute an action on a known element.
   */
  private async executeOnElement(
    elementId: string,
    elementLabel: string | undefined,
    action: ActionType,
    params: Record<string, unknown> | undefined,
    opts: ActionExecutionOptions,
    retryOpts?: Partial<RetryOptions>,
  ): Promise<ActionRecord> {
    const record = this.createRecord(action, elementId, elementLabel, params);
    markExecuting(record);

    try {
      // Pre-action pause.
      if (opts.pauseBeforeAction && opts.pauseBeforeAction > 0) {
        await this.delay(opts.pauseBeforeAction);
      }

      // Merge press timing into params so the DOM driver can use it.
      const mergedParams =
        opts.pressTiming
          ? { ...params, _pressTiming: opts.pressTiming }
          : params;

      const doAction = () => this.config.performAction(elementId, action, mergedParams);

      if (retryOpts) {
        // Wrap execution in retry logic.
        await withRetry(doAction, retryOpts);
      } else {
        // Execute with timeout only.
        await this.withTimeout(
          doAction(),
          opts.timeout ?? 5000,
          `Action "${action}" on element "${elementId}" timed out after ${opts.timeout ?? 5000}ms`,
        );
      }

      // Wait for idle if requested.
      if (opts.waitForIdle && this.config.waitForIdle) {
        await this.config.waitForIdle(opts.idleTimeout);
      }

      // Post-action pause.
      if (opts.pauseAfterAction && opts.pauseAfterAction > 0) {
        await this.delay(opts.pauseAfterAction);
      }

      // Post-action verification.
      if (opts.verification) {
        await this.verifyPostAction(opts.verification);
      }

      // Mark as completed and set "success" status for consumer compatibility.
      record.completedAt = Date.now();
      record.durationMs = record.completedAt - record.startedAt;
      // Set status to "success" — this extends ActionStatus at the value level.
      (record as unknown as Record<string, unknown>).status = 'success';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markFailed(record, message);
    }

    this.history.push(record);
    return record;
  }

  /**
   * Find an element by query, retrying up to retryCount times.
   */
  private async findWithRetry(
    query: ElementQuery,
    opts: ActionExecutionOptions,
  ): Promise<QueryResult | null> {
    const maxAttempts = (opts.retryCount ?? 0) + 1;
    const delay = opts.retryDelayMs ?? 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const elements = this.config.registry.getAllElements();

      // Try exact query first.
      let result = findFirst(elements, query);
      if (result) return result;

      // Fallback: if query has `text`, also try matching by ariaLabel
      // (many form elements have labels but no textContent).
      if (query.text && !query.ariaLabel) {
        result = findFirst(elements, { ...query, text: undefined, ariaLabel: query.text });
        if (result) return result;
      }

      if (attempt < maxAttempts - 1) {
        await this.delay(delay);
      }
    }

    return null;
  }

  /**
   * Wrap a promise with a timeout.
   */
  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then((v) => {
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  /**
   * Create a new ActionRecord with an auto-incremented ID.
   */
  private createRecord(
    action: ActionType,
    elementId: string,
    elementLabel: string | undefined,
    params: Record<string, unknown> | undefined,
  ): ActionRecord {
    const id = `action-${this.nextId++}`;
    return createActionRecord(id, action, elementId, elementLabel, params);
  }

  /**
   * Merge caller-provided options with defaults.
   */
  private mergeOptions(
    options?: ExecuteOptions,
  ): ActionExecutionOptions {
    if (!options) return { ...this.defaultOptions };
    const { retry: _retry, ...rest } = options;
    return { ...this.defaultOptions, ...rest };
  }

  /**
   * Verify a post-action condition by polling until met or timed out.
   */
  private async verifyPostAction(spec: VerificationSpec): Promise<void> {
    const timeout = spec.timeout ?? 5000;
    const interval = 100;
    const started = Date.now();

    while (Date.now() - started < timeout) {
      const elements = this.config.registry.getAllElements();

      if (spec.type === 'elementAppears' && spec.query) {
        const found = findFirst(elements, spec.query);
        if (found) return;
      } else if (spec.type === 'elementVanishes' && spec.query) {
        const found = findFirst(elements, spec.query);
        if (!found) return;
      } else if (spec.type === 'stateChange') {
        // State change verification is handled by callers with state machine access.
        // The executor doesn't have state machine context, so treat as immediately satisfied.
        return;
      }

      await this.delay(interval);
    }

    throw new Error(
      `Post-action verification "${spec.type}" timed out after ${timeout}ms`,
    );
  }

  /**
   * Simple delay utility.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
