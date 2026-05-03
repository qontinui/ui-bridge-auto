/**
 * Runtime subpath — DOM execution engine.
 *
 * Public surface for the live automation runtime: the element query engine,
 * AutomationEngine, state machine + detector + pathfinder, action executors,
 * waits, batches, and the graph-based execution controller. Consumers that
 * only need types or drift comparison should NOT import from this subpath
 * (use `./types` or `./drift` instead) — pulling `./runtime` brings in the
 * full DOM-side runtime.
 */

// Core query engine
export {
  type ElementQuery,
  type QueryResult,
  type RankedQueryResult,
  type FindFirstOptions,
  type FindFirstResult,
  type QueryableElement,
  matchesQuery,
  executeQuery,
  findFirst,
} from "../core/element-query";
export { AutomationEngine, type EngineConfig } from "../core/engine";

// Core — fuzzy matching
export {
  levenshteinDistance,
  similarity,
  isFuzzyMatch,
  bestFuzzyMatch,
  tokenMatch,
} from "../core/fuzzy-match";

// Core — semantic matching
export {
  type SemanticQuery,
  type SemanticResult,
  matchesSemantic,
  semanticSearch,
} from "../core/semantic-match";

// Core — spatial queries
export {
  type NearQuery,
  elementCenter,
  elementDistance,
  findNear,
  computeRelation,
  findByRelation,
} from "../core/spatial-query";

// Core — query ranking
export {
  type ScoreBreakdown,
  type RankedResult,
  computeMatchScore,
  rankResults,
} from "../core/query-ranking";

// Core — query compiler
export {
  type CompiledQuery,
  compileQuery,
  QueryCache,
} from "../core/query-compiler";

// Core — query debugger
export {
  explainQueryMatch,
  diagnoseNoResults,
  formatExplanation,
} from "../core/query-debugger";

// State machine
export {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
  type TransitionAction,
} from "../state/state-machine";
export { StateDetector, type RegistryLike } from "../state/state-detector";
export {
  findPath,
  NoPathError,
  PathNode,
  applyTransition as applyStateTransition,
  getAvailableTransitions,
  reconstructPath,
  bfs,
  dijkstra,
  astar,
  type Path,
} from "../state/pathfinder";
export {
  executeTransition,
  navigateToState,
  type ActionExecutorLike,
  TransitionError,
} from "../state/transition-executor";

// State — co-occurrence analysis
export {
  CoOccurrenceMatrix,
  type CoOccurrenceData,
} from "../state/co-occurrence";

// State — automatic discovery
export {
  StateDiscovery,
  type DiscoveryConfig,
  type DiscoveredState,
  type DiscoveredTransition,
} from "../state/state-discovery";

// State — graph export/import
export {
  exportGraph,
  importGraph,
  toMermaid,
  toDot,
  type GraphFormat,
  type StateGraphData,
} from "../state/state-graph";

// State — reliability tracking
export {
  ReliabilityTracker,
  type ReliabilityRecord,
} from "../state/reliability";

// State — enhanced navigation
export {
  bfsSearch,
  astarSearch,
  navigateToAny,
  navigateToAll,
  navigate,
  type SearchStrategy,
  type NavigationOptions,
  type NavigationResult,
} from "../state/navigation";

// State — persistence
export {
  serialize,
  deserialize,
  mergeStateMachines,
  validate,
  type PersistedStateMachine,
} from "../state/persistence";

// Wait
export { TimeoutError, type WaitOptions } from "../wait/types";
export { waitForElement } from "../wait/wait-for-element";
export { waitForState } from "../wait/wait-for-state";
export { waitForIdle } from "../wait/wait-for-idle";
export { waitForCondition } from "../wait/wait-for-condition";
export { waitForChange, type WaitForChangeOptions } from "../wait/wait-for-change";
export { waitForStable, type WaitForStableOptions } from "../wait/wait-for-stable";

// Batch
export {
  type ActionStep,
  type WaitSpec,
  type SequenceOptions,
  type ActionResult,
  executeSequence,
} from "../batch/action-sequence";
export { type FlowDefinition, FlowRegistry } from "../batch/flow";

// Discovery
export { OverlayDetector } from "../discovery/overlay-detector";
export { generateStableId } from "../discovery/stable-id";
export {
  type ElementFingerprint,
  computeFingerprint,
  fingerprintMatch,
} from "../discovery/element-fingerprint";

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
  type ClickUntilCondition,
  createChainContext,
  ActionChain,
  actionStepsToChainSteps,
  ChainBuilder,
  ConditionalBuilder,
  loop,
  tryCatch,
  switchCase,
  repeatUntilElement,
  clickUntil,
  forEach,
  retryChain,
  priorityExecute,
  type ChainHooks,
  type CircuitBreakerConfig,
  CircuitBreaker,
  type BackoffStrategy,
  type RetryOptions,
  type DelayOptions,
  createDefaultRetryOptions,
  computeDelay,
  withRetry,
  extractValue,
  extractToVariable,
  interpolate,
  evaluateExpression,
  type StringOp,
  type MathOp,
  type CollectionOp,
  stringOp,
  mathOp,
  collectionOp,
  applyTransform,
  computeExpression,
  // DOM action implementations
  DefaultDOMExecutor,
  performClick,
  performDoubleClick,
  performRightClick,
  performMiddleClick,
  performType,
  performSendKeys,
  performClear,
  performSelect,
  performFocus,
  performBlur,
  performHover,
  performScroll,
  performScrollIntoView,
  performCheck,
  performToggle,
  performDrag,
  performSetValue,
  performSubmit,
  performReset,
  performAutocomplete,
  performAction,
  type TypeParams,
  type SendKeysParams,
  type SelectParams,
  type ScrollParams,
  type ScrollIntoViewParams,
  type DragParams,
  type AutocompleteParams,
  type MouseActionParams,
  // DOM helpers
  createMouseEvent,
  createMouseEventAt,
  elementFromPointSafe,
  sleep,
  findOpenDropdown,
  findDropdownOption,
  findScrollableElement,
} from "../actions";

// Execution engine
export {
  VariableContext,
  type Connection,
  type ConnectionCondition,
  type RouteResult,
  ConnectionRouter,
  type CriteriaType,
  type SuccessCriteria,
  type NodeResult,
  evaluateCriteria,
  allMustPass,
  anyMustPass,
  percentageMustPass,
  type ExecutionPhase,
  type TrackerEvent,
  ExecutionTracker,
  type ExecutionControllerConfig,
  ExecutionController,
  type WorkflowGraph,
  type WorkflowNode,
  type ExecutionResult,
  GraphExecutor,
} from "../execution";
