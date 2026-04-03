/**
 * @qontinui/ui-bridge-auto — DOM-based automation library.
 *
 * Public API re-exports for all subsystems.
 */

// Types — element model
export type {
  AutomationElement,
  ElementState,
  ElementRect,
  ComputedStyleSubset,
  ElementSnapshot,
  ElementType,
} from "./types/element";
export {
  ELEMENT_TYPES,
  isElementType,
  isAutomationElement,
  isElementState,
  isElementRect,
  isElementSnapshot,
} from "./types/element";

// Types — state machine
export type {
  State,
  StateCondition,
  StateConditionProperty,
  StateConditionComparator,
  ActiveStateSet,
  StateLifecycle,
  StateChangeEvent,
} from "./types/state";
export {
  createEmptyStateSet,
  diffStateSets,
  getStateLifecycle,
  evaluateCondition,
} from "./types/state";

// Types — transitions
export type {
  Transition,
  TransitionAction as TransitionActionDef,
  ActionType,
  WaitSpec as TransitionWaitSpec,
  WaitType,
  TransitionResult,
} from "./types/transition";
export {
  transitionSuccessRate,
  recordTransitionExecution,
} from "./types/transition";

// Types — action records
export type {
  ActionRecord,
  ActionStatus,
  ActionExecutionOptions,
} from "./types/action";
export {
  createActionRecord,
  markExecuting,
  markCompleted,
  markFailed,
  markCancelled,
  markSkipped,
  isTerminalStatus,
  createDefaultExecutionOptions,
} from "./types/action";

// Types — match results
export type {
  ElementCriteria,
  MatchResult,
  MultiMatchResult,
  QueryExplanation,
  CriteriaResult,
} from "./types/match";
export {
  noMatch,
  matched,
  explainMatch,
} from "./types/match";

// Types — regions and spatial
export type {
  ViewportRegion,
  NormalizedRegion,
  SpatialRelation,
  SpatialQuery,
} from "./types/region";
export {
  isInside,
  overlaps,
  distance,
  spatialRelation,
  normalizeRegion,
} from "./types/region";

// Config — workflow
export type {
  WorkflowConfig,
  WorkflowSettings,
  StateConfig,
  TransitionConfig,
} from "./config/workflow";
export {
  createDefaultSettings,
  mergeSettings,
  hydrateState,
  hydrateTransition,
} from "./config/workflow";

// Config — action defaults
export type {
  ClickConfig,
  TypeConfig,
  SelectConfig,
  WaitConfig,
  ScrollIntoViewConfig,
  ActionDefaults,
} from "./config/action-config";
export {
  createDefaultActionConfig,
  mergeClickConfig,
  mergeTypeConfig,
  mergeSelectConfig,
  mergeWaitConfig,
  mergeActionDefaults,
} from "./config/action-config";

// Config — search
export type { SearchConfig } from "./config/search-config";
export {
  createDefaultSearchConfig,
  mergeSearchConfig,
  validateSearchConfig,
} from "./config/search-config";

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

// Core — fuzzy matching
export {
  levenshteinDistance,
  similarity,
  isFuzzyMatch,
  bestFuzzyMatch,
  tokenMatch,
} from "./core/fuzzy-match";

// Core — semantic matching
export {
  type SemanticQuery,
  type SemanticResult,
  matchesSemantic,
  semanticSearch,
} from "./core/semantic-match";

// Core — spatial queries
export {
  type NearQuery,
  elementCenter,
  elementDistance,
  findNear,
  computeRelation,
  findByRelation,
} from "./core/spatial-query";

// Core — query ranking
export {
  type ScoreBreakdown,
  type RankedResult,
  computeMatchScore,
  rankResults,
} from "./core/query-ranking";

// Core — query compiler
export {
  type CompiledQuery,
  compileQuery,
  QueryCache,
} from "./core/query-compiler";

// Core — query debugger
export {
  explainQueryMatch,
  diagnoseNoResults,
  formatExplanation,
} from "./core/query-debugger";

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

// State — co-occurrence analysis
export {
  CoOccurrenceMatrix,
  type CoOccurrenceData,
} from "./state/co-occurrence";

// State — automatic discovery
export {
  StateDiscovery,
  type DiscoveryConfig,
  type DiscoveredState,
  type DiscoveredTransition,
} from "./state/state-discovery";

// State — graph export/import
export {
  exportGraph,
  importGraph,
  toMermaid,
  toDot,
  type GraphFormat,
  type StateGraphData,
} from "./state/state-graph";

// State — reliability tracking
export {
  ReliabilityTracker,
  type ReliabilityRecord,
} from "./state/reliability";

// State — enhanced navigation
export {
  bfsSearch,
  astarSearch,
  navigateToAny,
  navigate,
  type SearchStrategy,
  type NavigationOptions,
  type NavigationResult,
} from "./state/navigation";

// State — persistence
export {
  serialize,
  deserialize,
  mergeStateMachines,
  validate,
  type PersistedStateMachine,
} from "./state/persistence";

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

// Actions
export {
  type ActionTypeMetadata,
  ACTION_METADATA,
  validateActionParams,
  getActionsByCategory,
  type ActionExecutorConfig,
  type ExecuteOptions,
  ActionExecutor,
  type ChainStep,
  type ChainContext,
  type ChainOptions,
  type ChainResult,
  type ChainExecutor,
  createChainContext,
  ActionChain,
  ChainBuilder,
  ConditionalBuilder,
  loop,
  tryCatch,
  switchCase,
  repeatUntilElement,
  type RetryOptions,
  type DelayOptions,
  createDefaultRetryOptions,
  computeDelay,
  withRetry,
  extractValue,
  extractToVariable,
  interpolate,
  evaluateExpression,
} from "./actions";

// Server
export { createAutoHandlers } from "./server/endpoints";
