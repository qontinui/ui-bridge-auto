/**
 * Action system — chains, control flow, retry, and data operations.
 *
 * Re-exports all public APIs from the action module.
 */

// Action type metadata and validation
export {
  type ActionTypeMetadata,
  ACTION_METADATA,
  validateActionParams,
  getActionsByCategory,
} from './action-types';

// Core executor
export {
  type ActionExecutorConfig,
  ActionExecutor,
} from './action-executor';

// Core executor (extended options)
export {
  type ExecuteOptions,
} from './action-executor';

// Action chains
export {
  type ChainStep,
  type ChainContext,
  type ChainOptions,
  type ChainResult,
  type ChainExecutor,
  type ClickUntilCondition,
  createChainContext,
  ActionChain,
  actionStepsToChainSteps,
} from './action-chain';

// Fluent builder
export {
  ChainBuilder,
  ConditionalBuilder,
} from './action-builder';

// Control flow
export {
  loop,
  tryCatch,
  switchCase,
  repeatUntilElement,
  clickUntil,
  forEach,
  retryChain,
  priorityExecute,
} from './control-flow';

// Retry
export {
  type BackoffStrategy,
  type RetryOptions,
  type DelayOptions,
  createDefaultRetryOptions,
  computeDelay,
  withRetry,
} from './retry';

// Data operations
export {
  extractValue,
  extractToVariable,
  interpolate,
  evaluateExpression,
} from './data-operations';

// Hooks and circuit breaker
export {
  type ChainHooks,
  type CircuitBreakerConfig,
  CircuitBreaker,
} from './hooks';

// DOM action implementations (single source of truth for action execution)
export {
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
} from './dom-actions';

// DOM helpers
export {
  createMouseEvent,
  createMouseEventAt,
  elementFromPointSafe,
  sleep,
  getNativeSetter,
  resetReactValueTracker,
  getReactProps,
  notifyReactValueChange,
  findOpenDropdown,
  findDropdownOption,
  findScrollableElement,
  keyToCode,
  NON_PRINTABLE_KEYS,
  type MouseActionParams,
} from './dom-helpers';

// Default DOM executor
export { DefaultDOMExecutor } from './default-executor';

// Extended data operations
export {
  type StringOp,
  type MathOp,
  type CollectionOp,
  stringOp,
  mathOp,
  collectionOp,
  applyTransform,
  computeExpression,
  isStringOp,
  isMathOp,
  isCollectionOp,
} from './data-ops-extended';
