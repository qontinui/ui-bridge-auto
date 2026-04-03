/**
 * Configuration modules for ui-bridge-auto.
 *
 * Re-exports all configuration types, factory functions, and merge utilities.
 */

// Workflow config
export type {
  WorkflowConfig,
  WorkflowSettings,
  StateConfig,
  TransitionConfig,
} from "./workflow";
export {
  createDefaultSettings,
  mergeSettings,
  hydrateState,
  hydrateTransition,
} from "./workflow";

// Action config
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
} from "./action-config";
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
} from "./action-config";

// Search config
export type { SearchConfig } from "./search-config";
export {
  createDefaultSearchConfig,
  mergeSearchConfig,
  validateSearchConfig,
} from "./search-config";
