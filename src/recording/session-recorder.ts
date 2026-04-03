/**
 * Session recording for capturing UI interactions.
 *
 * Records actions, state changes, element appearances/disappearances, and
 * element snapshots into a structured timeline. Sessions can be serialized
 * to JSON for persistence and later replay.
 */

import type { ElementFingerprint } from "../discovery/element-fingerprint";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single recorded event in a session timeline. */
export interface RecordedEvent {
  id: string;
  timestamp: number;
  type:
    | "action"
    | "stateChange"
    | "elementAppeared"
    | "elementDisappeared"
    | "snapshot";
  data:
    | RecordedAction
    | RecordedStateChange
    | RecordedElementEvent
    | RecordedSnapshot;
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

function nextEventId(): string {
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
 */
export class SessionRecorder {
  private session: RecordingSession | null = null;

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
    return result;
  }

  /** Record an action event. */
  recordAction(action: RecordedAction): void {
    this.addEvent("action", action);
  }

  /** Record a state change event. */
  recordStateChange(change: RecordedStateChange): void {
    this.addEvent("stateChange", change);
  }

  /** Record an element appearing. */
  recordElementAppeared(event: RecordedElementEvent): void {
    this.addEvent("elementAppeared", event);
  }

  /** Record an element disappearing. */
  recordElementDisappeared(event: RecordedElementEvent): void {
    this.addEvent("elementDisappeared", event);
  }

  /** Record a snapshot of current elements. */
  recordSnapshot(snapshot: RecordedSnapshot): void {
    this.addEvent("snapshot", snapshot);
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
  ): void {
    if (!this.session) {
      throw new Error("No recording session in progress");
    }
    this.session.events.push({
      id: nextEventId(),
      timestamp: Date.now(),
      type,
      data,
    });
  }
}
