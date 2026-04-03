/**
 * Core type system for ui-bridge-auto.
 *
 * Re-exports all types, interfaces, type guards, and utility functions
 * from the type modules. This is the single entry point for type imports.
 */

// Element model
export type {
  AutomationElement,
  ElementState,
  ElementRect,
  ElementType,
  ComputedStyleSubset,
  ElementSnapshot,
} from "./element";
export {
  ELEMENT_TYPES,
  isElementType,
  isAutomationElement,
  isElementState,
  isElementRect,
  isElementSnapshot,
} from "./element";

// State machine
export type {
  State,
  StateCondition,
  StateConditionProperty,
  StateConditionComparator,
  ActiveStateSet,
  StateLifecycle,
  StateChangeEvent,
} from "./state";
export {
  createEmptyStateSet,
  diffStateSets,
  getStateLifecycle,
  evaluateCondition,
} from "./state";

// Transitions
export type {
  Transition,
  TransitionAction,
  ActionType,
  WaitSpec,
  WaitType,
  TransitionResult,
} from "./transition";
export {
  transitionSuccessRate,
  recordTransitionExecution,
} from "./transition";

// Action records
export type {
  ActionRecord,
  ActionStatus,
  ActionExecutionOptions,
  PressTiming,
  RepetitionOptions,
  VerificationSpec,
} from "./action";
export {
  createActionRecord,
  markExecuting,
  markCompleted,
  markFailed,
  markCancelled,
  markSkipped,
  isTerminalStatus,
  createDefaultExecutionOptions,
} from "./action";

// Match results
export type {
  ElementCriteria,
  MatchResult,
  MultiMatchResult,
  QueryExplanation,
  CriteriaResult,
} from "./match";
export {
  noMatch,
  matched,
  explainMatch,
} from "./match";

// Regions and spatial
export type {
  ViewportRegion,
  NormalizedRegion,
  SpatialRelation,
  SpatialQuery,
} from "./region";
export {
  isInside,
  overlaps,
  distance,
  spatialRelation,
  normalizeRegion,
} from "./region";
