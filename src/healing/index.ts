/**
 * Error recovery and self-healing subsystem.
 *
 * Provides error classification, element relocation, state recovery,
 * and pluggable recovery strategies for resilient automation.
 */

export {
  classifyError,
  addClassificationRule,
  resetClassificationRules,
  type ErrorClass,
  type ClassifiedError,
} from "./error-classifier";

export {
  ElementRelocator,
  type AlternativeMatch,
} from "./element-relocator";

export { StateRecovery } from "./state-recovery";

export {
  applyStrategy,
  selectStrategy,
  retryStrategy,
  fallbackStrategy,
  waitStrategy,
  type StrategyType,
  type RecoveryStrategy,
  type StrategyResult,
  type StrategyContext,
} from "./recovery-strategies";
