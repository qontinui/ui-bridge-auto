/**
 * Replay engine for executing recorded sessions.
 *
 * Takes a RecordingSession and replays action events through an
 * ActionExecutorLike, optionally verifying state changes and reporting
 * errors. Supports speed control and cancellation.
 */

import type { QueryableElement } from "../core/element-query";
import type { ActionExecutorLike } from "../state/transition-executor";
import type {
  RecordedEvent,
  RecordedAction,
  RecordedEventId,
  RecordingSession,
} from "./session-recorder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options controlling replay behavior. */
export interface ReplayOptions {
  /** Playback speed multiplier (1.0 = real-time, 2.0 = 2x faster). */
  speed: number;
  /** Minimum ms between actions. */
  pauseBetweenActions: number;
  /** Whether to verify states after actions. */
  verifyStates: boolean;
  /** Max ms to wait for state verification. */
  stateTimeout: number;
  /** Whether to stop on first error. */
  stopOnError: boolean;
  /** Callback invoked for each event during replay. */
  onEvent?: (event: RecordedEvent, index: number, total: number) => void;
}

/**
 * A single causal-trace divergence between an original recording and what was
 * observed (or could be observed) during replay.
 *
 * Divergences are non-fatal observations layered on top of the existing
 * `errors` channel — execution still proceeds. Consumers can use these to
 * grade replay fidelity, gate auto-healing, or flag flakey workflows.
 */
export interface ReplayDivergence {
  /** Index of the original event in `session.events` that diverged. */
  eventIndex: number;
  /** Category of divergence. */
  kind:
    | "missing"
    | "extra"
    | "causedByMismatch"
    | "predicateOutcomeMismatch"
    | "stateChangeMismatch";
  /** Relevant subset of the original event for this divergence. */
  expected: unknown;
  /** What replay actually observed; `null` when the expected event is missing. */
  actual: unknown;
  /** Human-readable summary suitable for logs / dev UI. */
  message: string;
}

/** Result of a replay execution. */
export interface ReplayResult {
  success: boolean;
  eventsReplayed: number;
  eventsTotal: number;
  errors: Array<{ eventIndex: number; error: string }>;
  /**
   * Causal-trace divergences detected during replay. Empty when the recording
   * is internally consistent and replay produced no shape-level surprises.
   * Independent of `errors`: a session can have zero errors and still report
   * divergences (or vice versa).
   */
  divergences: ReplayDivergence[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: ReplayOptions = {
  speed: 1.0,
  pauseBetweenActions: 500,
  verifyStates: true,
  stateTimeout: 5000,
  stopOnError: true,
};

// ---------------------------------------------------------------------------
// ReplayEngine
// ---------------------------------------------------------------------------

/**
 * Replays a recorded session by executing action events through an
 * ActionExecutorLike. Non-action events are reported but not executed.
 */
export class ReplayEngine {
  private cancelled = false;
  private replaying = false;

  constructor(
    private readonly executor: ActionExecutorLike,
    private readonly registry: { getAllElements(): QueryableElement[] },
  ) {}

  /**
   * Replay a recorded session.
   *
   * Iterates through all events in the session. Action events are executed
   * via the executor; other event types are skipped (but reported via the
   * onEvent callback). Returns a summary of the replay including any causal
   * divergences detected.
   *
   * Divergence detection (v1):
   *   - Validates static causal-chain integrity: every `causedBy` reference
   *     must point to an event recorded earlier in the same session. Any
   *     forward or dangling reference is reported as a `causedByMismatch`
   *     divergence before action execution begins.
   *
   * TODO (v2):
   *   - **Predicate-outcome divergence:** when the recording has
   *     `predicateEval` events caused by a replayed action, re-evaluate the
   *     predicate against the live snapshot and compare `matched`. Requires
   *     a predicate-evaluator dependency that v1 does not own.
   *   - **State-change shape divergence:** compare the *shape* (count and
   *     kind) of follow-up events caused by each replayed action against
   *     what was observed live. Requires hooking the executor or registry
   *     for in-replay event capture, which is out of scope for v1.
   */
  async replay(
    session: RecordingSession,
    options?: Partial<ReplayOptions>,
  ): Promise<ReplayResult> {
    const opts: ReplayOptions = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    const errors: Array<{ eventIndex: number; error: string }> = [];
    const divergences: ReplayDivergence[] = this.validateCausalChain(session);
    let eventsReplayed = 0;

    this.replaying = true;
    this.cancelled = false;

    try {
      for (let i = 0; i < session.events.length; i++) {
        if (this.cancelled) break;

        const event = session.events[i];

        // Notify callback
        opts.onEvent?.(event, i, session.events.length);

        if (event.type === "action") {
          const actionData = event.data as RecordedAction;

          try {
            // Find the target element
            const element = this.findElementById(actionData.elementId);
            if (!element) {
              throw new Error(
                `Element not found: ${actionData.elementId}`,
              );
            }

            await this.executor.executeAction(
              element.id,
              actionData.actionType,
              actionData.params,
            );
            eventsReplayed++;
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            errors.push({ eventIndex: i, error: message });

            if (opts.stopOnError) break;
          }

          // Pause between actions
          if (!this.cancelled && i < session.events.length - 1) {
            const delay = Math.max(
              1,
              Math.round(opts.pauseBetweenActions / opts.speed),
            );
            await this.sleep(delay);
          }
        }
        // Non-action events are skipped for execution but counted
      }
    } finally {
      this.replaying = false;
    }

    return {
      success: errors.length === 0 && !this.cancelled,
      eventsReplayed,
      eventsTotal: session.events.length,
      errors,
      divergences,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Validate the causal-chain integrity of a session.
   *
   * Walks events in recorded order and tracks the set of ids seen so far.
   * Every non-null `causedBy` must reference an id that has already been
   * seen — a forward reference (or a reference to an id that doesn't exist
   * at all) indicates the recording was assembled out-of-order or is
   * missing the parent event, and is reported as a `causedByMismatch`
   * divergence.
   *
   * `causedBy` of `undefined` or `null` is a root-cause marker and always
   * valid, so old fixtures recorded before the causal-trace work continue
   * to validate cleanly.
   */
  private validateCausalChain(
    session: RecordingSession,
  ): ReplayDivergence[] {
    const divergences: ReplayDivergence[] = [];
    const seen = new Set<RecordedEventId>();

    for (let i = 0; i < session.events.length; i++) {
      const event = session.events[i];
      const cause = event.causedBy;

      if (cause !== undefined && cause !== null && !seen.has(cause)) {
        divergences.push({
          eventIndex: i,
          kind: "causedByMismatch",
          expected: { id: event.id, causedBy: cause },
          actual: null,
          message:
            `Event ${event.id} (index ${i}) references causedBy=${cause}, ` +
            `which has not been seen earlier in the session.`,
        });
      }

      seen.add(event.id);
    }

    return divergences;
  }

  /** Cancel an in-progress replay. */
  cancel(): void {
    this.cancelled = true;
  }

  /** Whether a replay is currently in progress. */
  get isReplaying(): boolean {
    return this.replaying;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private findElementById(id: string): QueryableElement | null {
    const elements = this.registry.getAllElements();
    return elements.find((el) => el.id === id) ?? null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
