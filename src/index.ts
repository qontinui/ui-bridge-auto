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
  PressTiming,
  RepetitionOptions,
  VerificationSpec,
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
  ScrollConfig,
  MousePressConfig,
  KeyPressConfig,
  ActionDefaults,
} from "./config/action-config";
export {
  createDefaultActionConfig,
  mergeClickConfig,
  mergeTypeConfig,
  mergeSelectConfig,
  mergeWaitConfig,
  mergeScrollConfig,
  mergeMousePressConfig,
  mergeKeyPressConfig,
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
export { AutomationEngine, type EngineConfig } from "./core/engine";

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
} from "./state/pathfinder";
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
  navigateToAll,
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
export { waitForChange, type WaitForChangeOptions } from "./wait/wait-for-change";
export { waitForStable, type WaitForStableOptions } from "./wait/wait-for-stable";

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
  // DOM action implementations (canonical action execution)
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
} from "./actions";

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
} from "./execution";

// Server
export { createAutoHandlers, type AutoHandlersConfig } from "./server/endpoints";
export {
  NativeWsClient,
  NativeWsError,
  NativeWsTimeoutError,
  NativeWsClosedError,
  type NativeWsClientOptions,
  type WebSocketLike,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcEvent,
  type NativeBridgeSnapshotLike,
  type WaitForElementResult,
  type SequenceStep,
  type SequenceResult,
  type SubscriptionsList,
} from "./server/native-ws-client";

// Recording & replay
export {
  SessionRecorder,
  type RecordedEvent,
  type RecordedAction as SessionRecordedAction,
  type RecordedStateChange,
  type RecordedElementEvent,
  type RecordedSnapshot,
  type RecordingSession,
  ReplayEngine,
  type ReplayOptions,
  type ReplayResult,
  type ReplayDivergence,
  RecordingPipeline,
  PlaybookGenerator,
  type Playbook,
  type PlaybookStep,
} from "./recording";

// Error recovery & self-healing
export {
  classifyError,
  addClassificationRule,
  resetClassificationRules,
  type ErrorClass,
  type ClassifiedError,
  ElementRelocator,
  type AlternativeMatch,
  StateRecovery,
  applyStrategy,
  selectStrategy,
  retryStrategy,
  fallbackStrategy,
  waitStrategy,
  type StrategyType,
  type RecoveryStrategy,
  type StrategyResult,
  type StrategyContext,
} from "./healing";

// Resolution — ref IDs, escalation chain, telemetry
export {
  RefRegistry,
  type RefRegistryOptions,
  type RefId,
  type ResolvedRef,
  RefInvalidatedError,
  type RefInvalidationReason,
  type RefRecord,
  EscalatingResolver,
  type EscalatingResolverConfig,
  type EscalationTier,
  type EscalationEvent,
  type ResolutionTelemetryEmitter,
  type EscalationConfig,
  NoopTelemetryEmitter,
  CallbackTelemetryEmitter,
} from "./resolution";

// Static state machine builder — DEPRECATED: replaced by spec-driven generation.
// The static-builder module is no longer exported. Use spec-driven state machine
// generation instead.

// IR builder is intentionally NOT re-exported from the main entry. It is a
// build-time tool — vite-plugin.ts, metro-plugin.ts, build-project-ir.ts,
// cli.ts, and migrate-cli.ts depend on `node:fs`, `node:path`, and
// `ts-morph`, which must never reach a browser bundle. Consumers that need
// the IR builder (build configs, codemods, CLIs) import it explicitly via
// the subpath:
//
//   import { uiBridgeIRPlugin } from "@qontinui/ui-bridge-auto/ir-builder";
//   import { withUIBridgeIR } from "@qontinui/ui-bridge-auto/ir-builder";
//
// Pre-2026-05-01 this entry re-exported `./ir-builder`, which caused the
// runner's `vite build` to pull `ts-morph` into the browser bundle (8000+
// modules) and hang. See `qontinui-runner/vite.config.ts` for the source-
// resolution alias that exposed the leak.

// Visual — highlights, OCR assertions, coordinate translation, screenshot comparison
export {
  ElementHighlightManager,
  ACTION_HIGHLIGHT_COLORS,
  extractElementText,
  assertTextInElement,
  type TextExtractionResult,
  CoordinateTranslator,
  type WindowLike,
  InMemoryBaselineStore,
  ScreenshotAssertionManager,
  TesseractOCRProvider,
  type TesseractProviderOptions,
  IndexedDBBaselineStore,
  type IndexedDBStoreOptions,
  type HighlightOptions,
  type ActiveHighlight,
  type IOCRProvider,
  type TextRegion,
  type TextMatch,
  type TextAssertionOptions,
  type TextAssertionResult,
  type CoordinatePoint,
  type CoordinateSpace,
  type CoordinateTranslation,
  type ScrollInfo,
  type FrameOffset,
  type BaselineStore,
  type ScreenshotAssertionOptions,
  type ScreenshotAssertionResult,
} from "./visual";
