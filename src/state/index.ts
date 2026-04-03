/**
 * State machine subsystem — re-exports all state modules.
 */

// Core state machine
export {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
  type TransitionAction,
  type StateCondition,
  type StateEvent,
} from "./state-machine";

// State detection
export { StateDetector, type RegistryLike } from "./state-detector";

// Pathfinding (original Dijkstra)
export { findPath, NoPathError } from "./pathfinder";

// Transition execution
export {
  executeTransition,
  navigateToState,
  type ActionExecutorLike,
  TransitionError,
} from "./transition-executor";

// Co-occurrence analysis
export {
  CoOccurrenceMatrix,
  type CoOccurrenceData,
} from "./co-occurrence";

// Automatic state discovery
export {
  StateDiscovery,
  type DiscoveryConfig,
  type DiscoveredState,
  type DiscoveredTransition,
} from "./state-discovery";

// Graph export/import
export {
  exportGraph,
  importGraph,
  toMermaid,
  toDot,
  type GraphFormat,
  type StateGraphData,
} from "./state-graph";

// Reliability tracking
export {
  ReliabilityTracker,
  type ReliabilityRecord,
} from "./reliability";

// Enhanced navigation
export {
  bfsSearch,
  astarSearch,
  navigateToAny,
  navigate,
  type SearchStrategy,
  type NavigationOptions,
  type NavigationResult,
} from "./navigation";

// Persistence
export {
  serialize,
  deserialize,
  mergeStateMachines,
  validate,
  type PersistedStateMachine,
} from "./persistence";
