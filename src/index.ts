/**
 * @qontinui/ui-bridge-auto — DOM-based automation library.
 *
 * Public API re-exports for all subsystems.
 */

// Core
export {
  type ElementQuery,
  type QueryResult,
  type QueryableElement,
  matchesQuery,
  executeQuery,
  findFirst,
} from "./core/element-query";
export { AutomationEngine } from "./core/engine";

// State
export {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
  type TransitionAction,
} from "./state/state-machine";
export { StateDetector, type RegistryLike } from "./state/state-detector";
export { findPath, NoPathError } from "./state/pathfinder";
export {
  executeTransition,
  navigateToState,
  type ActionExecutorLike,
  TransitionError,
} from "./state/transition-executor";

// Wait
export { TimeoutError, type WaitOptions } from "./wait/types";
export { waitForElement } from "./wait/wait-for-element";
export { waitForState } from "./wait/wait-for-state";
export { waitForIdle } from "./wait/wait-for-idle";
export { waitForCondition } from "./wait/wait-for-condition";

// Batch
export {
  type ActionStep,
  type WaitSpec,
  type SequenceOptions,
  type ActionResult,
  executeSequence,
} from "./batch/action-sequence";
export { type FlowDefinition, FlowRegistry } from "./batch/flow";

// Discovery
export { OverlayDetector } from "./discovery/overlay-detector";
export { generateStableId } from "./discovery/stable-id";
export {
  type ElementFingerprint,
  computeFingerprint,
  fingerprintMatch,
} from "./discovery/element-fingerprint";

// Server
export { createAutoHandlers } from "./server/endpoints";
