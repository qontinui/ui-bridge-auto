/**
 * Recording & replay subsystem.
 *
 * Captures UI interactions into structured sessions, replays them,
 * processes them into state machine definitions, and generates
 * reusable playbooks.
 */

export {
  SessionRecorder,
  type RecordedEvent,
  type RecordedAction,
  type RecordedStateChange,
  type RecordedElementEvent,
  type RecordedSnapshot,
  type RecordingSession,
} from "./session-recorder";

export {
  ReplayEngine,
  type ReplayOptions,
  type ReplayResult,
  type ReplayDivergence,
} from "./replay-engine";

export { RecordingPipeline } from "./recording-pipeline";

export {
  PlaybookGenerator,
  type Playbook,
  type PlaybookStep,
} from "./playbook-generator";
