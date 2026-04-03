/**
 * Action records and results for tracking execution history.
 *
 * Every action executed by the automation engine produces an ActionRecord
 * that captures timing, element context, state transitions, and any
 * extracted values. These records form the execution log.
 */

import type { ActionType } from "./transition";
import type { ElementCriteria } from "./match";

// ---------------------------------------------------------------------------
// Action status
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of an action execution.
 * - "pending": action is queued but not yet started
 * - "executing": action is currently in progress
 * - "completed": action finished successfully
 * - "failed": action encountered an error
 * - "cancelled": action was cancelled before completion
 * - "skipped": action was skipped (e.g., precondition not met)
 */
export type ActionStatus =
  | "pending"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

// ---------------------------------------------------------------------------
// Action record
// ---------------------------------------------------------------------------

/**
 * A record of a single action execution.
 * Created when an action is initiated and updated as it progresses.
 */
export interface ActionRecord {
  /** Unique execution ID for this action instance. */
  id: string;
  /** The action verb that was executed. */
  type: ActionType;
  /** Registry ID of the element the action was performed on. */
  elementId: string;
  /** Human-readable label of the target element, if available. */
  elementLabel?: string;
  /** Action-specific parameters (e.g., { text: "hello" } for "type"). */
  params?: Record<string, unknown>;

  /** Epoch timestamp when execution started. */
  startedAt: number;
  /** Epoch timestamp when execution completed (success or failure). */
  completedAt?: number;
  /** Total execution duration (ms). Set when completedAt is set. */
  durationMs?: number;

  /** Current execution status. */
  status: ActionStatus;
  /** Error message if status is "failed". */
  error?: string;

  /** IDs of active states before the action was executed. */
  statesBefore?: string[];
  /** IDs of active states after the action completed. */
  statesAfter?: string[];

  /** Key-value pairs extracted from the element or page after action. */
  extractedValues?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Press timing
// ---------------------------------------------------------------------------

/** Fine-grained mouse press timing for click-like actions. */
export interface PressTiming {
  /** How long to hold the mouse button down (ms). Default 0 (instant). */
  pressDurationMs?: number;
  /** Pause after pressing the button, before release (ms). Default 0. */
  pauseAfterPressMs?: number;
  /** Pause after releasing the button (ms). Default 0. */
  pauseAfterReleaseMs?: number;
}

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

/** Repetition configuration for actions. */
export interface RepetitionOptions {
  /** Number of times to repeat the action. */
  count: number;
  /** Pause between repetitions (ms). Default 0. */
  pauseBetweenMs?: number;
  /** Maximum repetitions before aborting. Default equals count. */
  maxRepetitions?: number;
}

// ---------------------------------------------------------------------------
// Post-action verification
// ---------------------------------------------------------------------------

/** Post-action verification — waits for a condition after the action completes. */
export interface VerificationSpec {
  /** What to verify after the action. */
  type: "elementAppears" | "elementVanishes" | "stateChange";
  /** Element criteria for element-based verification. */
  query?: ElementCriteria;
  /** State ID for state-change verification. */
  stateId?: string;
  /** Maximum time (ms) to wait for verification (default 5000). */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Action execution options
// ---------------------------------------------------------------------------

/**
 * Configuration options for executing a single action.
 * Controls timeouts, retries, and pre/post-action behaviour.
 */
export interface ActionExecutionOptions {
  /** Maximum time (ms) to wait for the action to complete (default 5000). */
  timeout?: number;
  /** Number of retry attempts on failure (default 0). */
  retryCount?: number;
  /** Delay (ms) between retry attempts (default 500). */
  retryDelayMs?: number;
  /** Whether to wait for UI idle after the action (default true). */
  waitForIdle?: boolean;
  /** Maximum time (ms) to wait for idle after the action (default 5000). */
  idleTimeout?: number;
  /** Whether to scroll the element into view before acting (default true). */
  scrollIntoView?: boolean;
  /** Element that must exist before the action can begin. */
  precondition?: ElementCriteria;
  /** Pause (ms) before performing the action. Default 0. */
  pauseBeforeAction?: number;
  /** Pause (ms) after performing the action (after idle wait). Default 0. */
  pauseAfterAction?: number;
  /** Mouse press timing for click-like actions. */
  pressTiming?: PressTiming;
  /** Repetition configuration for this action. */
  repetition?: RepetitionOptions;
  /** Post-action verification condition. */
  verification?: VerificationSpec;
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Create a new ActionRecord in "pending" status.
 */
export function createActionRecord(
  id: string,
  type: ActionType,
  elementId: string,
  elementLabel?: string,
  params?: Record<string, unknown>,
): ActionRecord {
  return {
    id,
    type,
    elementId,
    elementLabel,
    params,
    startedAt: Date.now(),
    status: "pending",
  };
}

/**
 * Mark an ActionRecord as started (executing).
 * Mutates the record in place and returns it for chaining.
 */
export function markExecuting(record: ActionRecord): ActionRecord {
  record.status = "executing";
  record.startedAt = Date.now();
  return record;
}

/**
 * Mark an ActionRecord as completed successfully.
 * Mutates the record in place and returns it for chaining.
 */
export function markCompleted(
  record: ActionRecord,
  extractedValues?: Record<string, unknown>,
): ActionRecord {
  record.status = "completed";
  record.completedAt = Date.now();
  record.durationMs = record.completedAt - record.startedAt;
  if (extractedValues) {
    record.extractedValues = extractedValues;
  }
  return record;
}

/**
 * Mark an ActionRecord as failed with an error.
 * Mutates the record in place and returns it for chaining.
 */
export function markFailed(record: ActionRecord, error: string): ActionRecord {
  record.status = "failed";
  record.completedAt = Date.now();
  record.durationMs = record.completedAt - record.startedAt;
  record.error = error;
  return record;
}

/**
 * Mark an ActionRecord as cancelled.
 * Mutates the record in place and returns it for chaining.
 */
export function markCancelled(record: ActionRecord): ActionRecord {
  record.status = "cancelled";
  record.completedAt = Date.now();
  record.durationMs = record.completedAt - record.startedAt;
  return record;
}

/**
 * Mark an ActionRecord as skipped with an optional reason.
 * Mutates the record in place and returns it for chaining.
 */
export function markSkipped(record: ActionRecord, reason?: string): ActionRecord {
  record.status = "skipped";
  record.completedAt = Date.now();
  record.durationMs = record.completedAt - record.startedAt;
  if (reason) {
    record.error = reason;
  }
  return record;
}

/**
 * Check whether an action is in a terminal status (completed, failed, cancelled, skipped).
 */
export function isTerminalStatus(status: ActionStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "skipped"
  );
}

/**
 * Create default ActionExecutionOptions with standard values.
 */
export function createDefaultExecutionOptions(): ActionExecutionOptions {
  return {
    timeout: 5000,
    retryCount: 0,
    retryDelayMs: 500,
    waitForIdle: true,
    idleTimeout: 5000,
    scrollIntoView: true,
    pauseBeforeAction: 0,
    pauseAfterAction: 0,
  };
}
