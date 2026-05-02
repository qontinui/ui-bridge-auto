/**
 * Session recording for capturing UI interactions.
 *
 * Records actions, state changes, element appearances/disappearances,
 * predicate evaluations, and element snapshots into a structured timeline.
 * Each event optionally carries a `causedBy` link to the event that
 * triggered it, forming a causal chain that can be deterministically
 * replayed.
 */

import type { ElementFingerprint } from "../discovery/element-fingerprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Identifier for a recorded event. Stable within a session; do not parse. */
export type RecordedEventId = string;

/** A single recorded event in a session timeline. */
export interface RecordedEvent {
  id: RecordedEventId;
  timestamp: number;
  type:
    | "action"
    | "stateChange"
    | "elementAppeared"
    | "elementDisappeared"
    | "snapshot"
    | "predicateEval";
  /**
   * The event that caused this event, or null for root events (user input,
   * scripted invocations). Optional for back-compat — old fixtures without
   * causality continue to deserialize.
   */
  causedBy?: RecordedEventId | null;
  data:
    | RecordedAction
    | RecordedStateChange
    | RecordedElementEvent
    | RecordedSnapshot
    | RecordedPredicateEval;
}

/** An action that was performed on an element. */
export interface RecordedAction {
  actionType: string;
  elementId: string;
  elementLabel?: string;
  elementFingerprint?: ElementFingerprint;
  params?: Record<string, unknown>;
  success: boolean;
  durationMs: number;
}

/** A state machine state change. */
export interface RecordedStateChange {
  entered: string[];
  exited: string[];
  activeStates: string[];
}

/** An element appearing or disappearing. */
export interface RecordedElementEvent {
  elementId: string;
  elementLabel?: string;
  fingerprint?: ElementFingerprint;
}

/** A snapshot of all visible elements. */
export interface RecordedSnapshot {
  elementIds: string[];
  elementCount: number;
  /** Optional richer capture for replay starting-state snapshots. */
  elementFingerprints?: ElementFingerprint[];
  /** Active state-machine states at snapshot time. */
  activeStateIds?: string[];
  /** Free-form annotations attached by the capture site. */
  annotations?: Record<string, unknown>;
}

/**
 * A predicate evaluation event — captures the outcome of a state-machine
 * predicate or required-elements check so replay can verify the same input
 * produces the same outcome.
 */
export interface RecordedPredicateEval {
  /** Identifier of the predicate (e.g. an IR `requiredElements` criterion id). */
  predicateId: string;
  /** Optional human-readable target description. */
  target?: string;
  /** Whether the predicate matched. */
  matched: boolean;
  /**
   * Reference to the snapshot the predicate was evaluated against. Lets
   * replay reproduce the exact input.
   */
  snapshotRef?: RecordedEventId;
}

/** A complete recording session. */
export interface RecordingSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  events: RecordedEvent[];
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let eventCounter = 0;

function nextSessionId(): string {
  return `session-${++sessionCounter}-${Date.now()}`;
}

function nextEventId(): RecordedEventId {
  return `evt-${++eventCounter}`;
}

// ---------------------------------------------------------------------------
// SessionRecorder
// ---------------------------------------------------------------------------

/**
 * Records UI interactions into a structured timeline.
 *
 * Call `start()` to begin a new session, record events with the `record*`
 * methods, and `stop()` to finalize. The session can then be exported to
 * JSON for persistence or passed to the ReplayEngine.
 *
 * Causality: each `record*` method returns the id of the event it just
 * recorded. Use `withCause(id, fn)` (or `withCauseAsync`) to mark every
 * event recorded inside `fn` as caused by `id`. An explicit `causedBy`
 * argument on the `record*` method overrides the ambient cause.
 */
export class SessionRecorder {
  private session: RecordingSession | null = null;
  private currentCauseId: RecordedEventId | null = null;

  /** Start a new recording session. Returns the session ID. */
  start(metadata?: Record<string, unknown>): string {
    if (this.session) {
      this.stop();
    }
    const id = nextSessionId();
    this.session = {
      id,
      startedAt: Date.now(),
      events: [],
      metadata,
    };
    this.currentCauseId = null;
    return id;
  }

  /** Stop the current session and return it. Throws if not recording. */
  stop(): RecordingSession {
    if (!this.session) {
      throw new Error("No recording session in progress");
    }
    this.session.endedAt = Date.now();
    const result = this.session;
    this.session = null;
    this.currentCauseId = null;
    return result;
  }

  /**
   * Record an action event. Actions are root causes by default
   * (causedBy = null) unless an ambient cause is set or one is supplied.
   */
  recordAction(
    action: RecordedAction,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("action", action, causedBy);
  }

  /** Record a state change event. */
  recordStateChange(
    change: RecordedStateChange,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("stateChange", change, causedBy);
  }

  /** Record an element appearing. */
  recordElementAppeared(
    event: RecordedElementEvent,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("elementAppeared", event, causedBy);
  }

  /** Record an element disappearing. */
  recordElementDisappeared(
    event: RecordedElementEvent,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("elementDisappeared", event, causedBy);
  }

  /** Record a snapshot of current elements. */
  recordSnapshot(
    snapshot: RecordedSnapshot,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("snapshot", snapshot, causedBy);
  }

  /** Record a predicate-evaluation event. */
  recordPredicateEval(
    evaluation: RecordedPredicateEval,
    causedBy?: RecordedEventId | null,
  ): RecordedEventId {
    return this.addEvent("predicateEval", evaluation, causedBy);
  }

  /**
   * Run `fn` with `eventId` as the ambient cause. Any events recorded
   * during `fn` (and its synchronous sub-calls) get `causedBy = eventId`
   * unless they pass an explicit override. The previous ambient cause is
   * restored on exit, including when `fn` throws.
   */
  withCause<T>(eventId: RecordedEventId | null, fn: () => T): T {
    const prev = this.currentCauseId;
    this.currentCauseId = eventId;
    try {
      return fn();
    } finally {
      this.currentCauseId = prev;
    }
  }

  /** Async variant of `withCause`. Restores ambient cause even on rejection. */
  async withCauseAsync<T>(
    eventId: RecordedEventId | null,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = this.currentCauseId;
    this.currentCauseId = eventId;
    try {
      return await fn();
    } finally {
      this.currentCauseId = prev;
    }
  }

  /** The ambient cause id, or null if none is set. */
  get ambientCause(): RecordedEventId | null {
    return this.currentCauseId;
  }

  /** Get the current session, or null if not recording. */
  get currentSession(): RecordingSession | null {
    return this.session;
  }

  /** Whether a recording is currently in progress. */
  get isRecording(): boolean {
    return this.session !== null;
  }

  /** Serialize a session to JSON. */
  static toJSON(session: RecordingSession): string {
    return JSON.stringify(session, null, 2);
  }

  /** Deserialize a session from JSON. */
  static fromJSON(json: string): RecordingSession {
    const parsed = JSON.parse(json) as RecordingSession;
    if (!parsed.id || !parsed.startedAt || !Array.isArray(parsed.events)) {
      throw new Error("Invalid recording session JSON");
    }
    return parsed;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private addEvent(
    type: RecordedEvent["type"],
    data: RecordedEvent["data"],
    causedByOverride?: RecordedEventId | null,
  ): RecordedEventId {
    if (!this.session) {
      throw new Error("No recording session in progress");
    }
    const id = nextEventId();
    const causedBy =
      causedByOverride !== undefined ? causedByOverride : this.currentCauseId;
    this.session.events.push({
      id,
      timestamp: Date.now(),
      type,
      causedBy,
      data,
    });
    return id;
  }
}
