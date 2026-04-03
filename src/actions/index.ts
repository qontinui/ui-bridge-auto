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
  createChainContext,
  ActionChain,
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
} from './control-flow';

// Retry
export {
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
