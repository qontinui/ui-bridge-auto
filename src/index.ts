/**
 * @qontinui/ui-bridge-auto — DOM-based automation library.
 *
 * Root entry point. This barrel re-exports from each public subpath barrel so
 * legacy consumers that import from `@qontinui/ui-bridge-auto` keep working.
 * NEW consumers should import from a subpath instead — pulling the root entry
 * forces the bundler to include the entire DOM execution engine even for
 * consumers that only need types or drift comparison.
 *
 * Public subpaths:
 *   - `@qontinui/ui-bridge-auto/types`       — zero-dep core types (browser-safe)
 *   - `@qontinui/ui-bridge-auto/drift`       — drift comparator + hypothesis engine
 *   - `@qontinui/ui-bridge-auto/regression`  — Section 9 regression suite generator
 *   - `@qontinui/ui-bridge-auto/diagnosis`   — Section 10 self-diagnosis composer
 *   - `@qontinui/ui-bridge-auto/visual`      — visual / OCR / screenshot assertions
 *   - `@qontinui/ui-bridge-auto/runtime`     — DOM execution engine (heaviest path)
 *
 * Items that don't have a dedicated subpath (server, recording, healing,
 * resolution, counterfactual, config) are still exported here.
 */

// =============================================================================
// Subpath re-exports — legacy root surface
// =============================================================================

// Core types
// NOTE: `types/transition.ts` exports a `TransitionAction` interface (the
// type-level action descriptor) and `state/state-machine.ts` also exports a
// `TransitionAction` (the runtime call signature). The legacy root entry
// aliased the former as `TransitionActionDef`, so we mirror that alias here
// and re-export everything else from the types barrel verbatim. The runtime
// `TransitionAction` is exported below via `export * from "./runtime"`.
export type {
  AutomationElement,
  ElementState,
  ElementRect,
  ComputedStyleSubset,
  ElementSnapshot,
  ElementType,
  State,
  StateCondition,
  StateConditionProperty,
  StateConditionComparator,
  ActiveStateSet,
  StateLifecycle,
  StateChangeEvent,
  Transition,
  TransitionAction as TransitionActionDef,
  ActionType,
  WaitSpec as TransitionWaitSpec,
  WaitType,
  TransitionResult,
  ActionRecord,
  ActionStatus,
  ActionExecutionOptions,
  PressTiming,
  RepetitionOptions,
  VerificationSpec,
  ElementCriteria,
  MatchResult,
  MultiMatchResult,
  QueryExplanation,
  CriteriaResult,
  ViewportRegion,
  NormalizedRegion,
  SpatialRelation,
  SpatialQuery,
} from "./types";
export {
  ELEMENT_TYPES,
  isElementType,
  isAutomationElement,
  isElementState,
  isElementRect,
  isElementSnapshot,
  createEmptyStateSet,
  diffStateSets,
  getStateLifecycle,
  evaluateCondition,
  transitionSuccessRate,
  recordTransitionExecution,
  createActionRecord,
  markExecuting,
  markCompleted,
  markFailed,
  markCancelled,
  markSkipped,
  isTerminalStatus,
  createDefaultExecutionOptions,
  noMatch,
  matched,
  explainMatch,
  isInside,
  overlaps,
  distance,
  spatialRelation,
  normalizeRegion,
} from "./types";

// Drift — Section 7
// Note: also re-exports `compareSpecToRuntime` + `RuntimeSnapshot` from the
// IR-builder's drift comparator. These live in `./ir-builder/drift` (a pure-
// types module, no Node-only deps) so they're safe to surface from the
// browser-bundled root entry. The full `./ir-builder` barrel must NOT be
// re-exported here — see the subpath docs in `package.json`.
export type { DriftEntry, DriftReport, RuntimeSnapshot } from "./ir-builder/drift";
export { compareSpecToRuntime } from "./ir-builder/drift";
export * from "./drift";

// Regression — Section 9
export * from "./regression";

// Self-diagnosis — Section 10
export * from "./diagnosis";

// Visual / OCR / screenshot — Sections 8 + 9
export * from "./visual";

// DOM runtime — engine, state machine, actions, waits, batches, execution
// `runtime` re-exports `TransitionAction` from `state/state-machine`, while
// `types` exports `TransitionAction as TransitionActionDef` (different type).
// To preserve the legacy root signature where `TransitionAction` resolved to
// the runtime variant, re-export everything from `runtime` AFTER `types`.
export * from "./runtime";

// =============================================================================
// Subsystems without a dedicated subpath (yet)
// =============================================================================

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

// Counterfactual / model-checking — Section 6
export {
  exploreCounterfactual,
  CounterfactualError,
  buildCausalIndex,
  forwardClosure,
  backwardClosure,
  type CausalIndex,
  type Perturbation,
  type DivergenceKind,
  type RegressionFailureKind,
  type DivergenceLike,
  type CounterfactualDivergence,
  type FragilityScore,
  type CounterfactualReport,
} from "./counterfactual";

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

// Section 8 helper — overlay candidate predicate. Surfaces here for
// backwards-compat with the legacy root export (the visual barrel re-exports
// it via `overlayDetectorPredicate`, but the discovery-side raw helper is
// what existing callers reach for).
export { isOverlayCandidate } from "./discovery/overlay-detector";

// Visual-drift legacy alias kept on root for byte-stable consumers.
export { asDriftReport as visualDriftReportToDriftReport } from "./visual";

// =============================================================================
// Static state machine builder — DEPRECATED, no longer exported. Use spec-
// driven state machine generation instead. See `runtime` subpath.
//
// IR builder is intentionally NOT re-exported here. It is a build-time tool —
// vite-plugin.ts, build-project-ir.ts, cli.ts, and migrate-cli.ts depend on
// `node:fs`, `node:path`, and `ts-morph`, which must never reach a browser
// bundle. Consumers that need the IR builder import it explicitly via:
//
//   import { uiBridgeIRPlugin } from "@qontinui/ui-bridge-auto/ir-builder";
// =============================================================================
