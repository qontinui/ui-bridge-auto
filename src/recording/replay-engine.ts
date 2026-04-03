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

/** Result of a replay execution. */
export interface ReplayResult {
  success: boolean;
  eventsReplayed: number;
  eventsTotal: number;
  errors: Array<{ eventIndex: number; error: string }>;
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
   * onEvent callback). Returns a summary of the replay.
   */
  async replay(
    session: RecordingSession,
    options?: Partial<ReplayOptions>,
  ): Promise<ReplayResult> {
    const opts: ReplayOptions = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();
    const errors: Array<{ eventIndex: number; error: string }> = [];
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
      durationMs: Date.now() - startTime,
    };
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
