/**
 * Workflow configuration schemas.
 *
 * Defines the shape of workflow definitions that combine state definitions,
 * transition definitions, and runtime settings into a single deployable unit.
 * Config types omit runtime-tracking fields from their corresponding
 * full types (observation counts, execution stats, timestamps).
 */

import type { State } from "../types/state";
import type { Transition } from "../types/transition";

// ---------------------------------------------------------------------------
// Workflow settings
// ---------------------------------------------------------------------------

/**
 * Runtime settings that control workflow execution behaviour.
 * All timeouts are in milliseconds.
 */
export interface WorkflowSettings {
  /** Default timeout for wait operations (ms). */
  defaultTimeout: number;
  /** Default timeout for idle-wait operations (ms). */
  defaultIdleTimeout: number;
  /** Default number of retry attempts for actions. */
  maxRetries: number;
  /** Default delay between retries (ms). */
  retryDelay: number;
  /** Whether to auto-wait for idle after every action. */
  waitForIdleAfterAction: boolean;
  /** Whether to capture a DOM snapshot when an action fails. */
  screenshotOnFailure: boolean;
  /** Whether to abort the entire workflow on the first error. */
  abortOnFirstFailure: boolean;
}

// ---------------------------------------------------------------------------
// Config types (definition-time, no runtime tracking fields)
// ---------------------------------------------------------------------------

/**
 * State definition for workflow configuration.
 * Omits runtime tracking fields (enteredAt, exitedAt, observationCount)
 * which are managed by the state machine at execution time.
 */
export type StateConfig = Omit<State, "enteredAt" | "exitedAt" | "observationCount">;

/**
 * Transition definition for workflow configuration.
 * Omits reliability tracking fields (successCount, failureCount,
 * averageDurationMs, lastExecutedAt) which are managed at execution time.
 */
export type TransitionConfig = Omit<
  Transition,
  "successCount" | "failureCount" | "averageDurationMs" | "lastExecutedAt"
>;

// ---------------------------------------------------------------------------
// Workflow config
// ---------------------------------------------------------------------------

/**
 * Complete workflow configuration combining states, transitions, and settings.
 * This is the top-level schema for defining an automation workflow.
 */
export interface WorkflowConfig {
  /** Unique workflow identifier. */
  id: string;
  /** Human-readable workflow name. */
  name: string;
  /** Optional description of what this workflow automates. */
  description?: string;
  /** Semantic version string (e.g., "1.0.0"). */
  version?: string;

  /** State definitions for this workflow. */
  states: StateConfig[];
  /** Transition definitions for this workflow. */
  transitions: TransitionConfig[];
  /** ID of the initial/starting state. */
  initialState?: string;

  /** Runtime execution settings. */
  settings: WorkflowSettings;
}

// ---------------------------------------------------------------------------
// Factory and merge functions
// ---------------------------------------------------------------------------

/**
 * Create a WorkflowSettings object with sensible defaults.
 *
 * Default values:
 * - defaultTimeout: 10000 ms
 * - defaultIdleTimeout: 5000 ms
 * - maxRetries: 2
 * - retryDelay: 500 ms
 * - waitForIdleAfterAction: true
 * - screenshotOnFailure: true
 * - abortOnFirstFailure: true
 */
export function createDefaultSettings(): WorkflowSettings {
  return {
    defaultTimeout: 10_000,
    defaultIdleTimeout: 5_000,
    maxRetries: 2,
    retryDelay: 500,
    waitForIdleAfterAction: true,
    screenshotOnFailure: true,
    abortOnFirstFailure: true,
  };
}

/**
 * Merge partial overrides into a base WorkflowSettings.
 * Only fields present in overrides replace the base values;
 * all other fields are preserved from the base.
 */
export function mergeSettings(
  base: WorkflowSettings,
  overrides: Partial<WorkflowSettings>,
): WorkflowSettings {
  return {
    defaultTimeout: overrides.defaultTimeout ?? base.defaultTimeout,
    defaultIdleTimeout: overrides.defaultIdleTimeout ?? base.defaultIdleTimeout,
    maxRetries: overrides.maxRetries ?? base.maxRetries,
    retryDelay: overrides.retryDelay ?? base.retryDelay,
    waitForIdleAfterAction: overrides.waitForIdleAfterAction ?? base.waitForIdleAfterAction,
    screenshotOnFailure: overrides.screenshotOnFailure ?? base.screenshotOnFailure,
    abortOnFirstFailure: overrides.abortOnFirstFailure ?? base.abortOnFirstFailure,
  };
}

/**
 * Hydrate a StateConfig into a full State by adding runtime tracking fields.
 * The observationCount is initialised to 0 and timestamps are left undefined.
 */
export function hydrateState(config: StateConfig): State {
  return {
    ...config,
    observationCount: 0,
  };
}

/**
 * Hydrate a TransitionConfig into a full Transition by adding reliability fields.
 * All counters start at 0 and averageDurationMs starts at 0.
 */
export function hydrateTransition(config: TransitionConfig): Transition {
  return {
    ...config,
    successCount: 0,
    failureCount: 0,
    averageDurationMs: 0,
  };
}
