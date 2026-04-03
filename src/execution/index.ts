/**
 * Execution engine — graph-based workflow execution.
 */

export { VariableContext } from './variable-context';

export type {
  Connection,
  ConnectionCondition,
  RouteResult,
} from './connection-router';
export { ConnectionRouter } from './connection-router';

export type {
  CriteriaType,
  SuccessCriteria,
  NodeResult,
} from './success-criteria';
export {
  evaluateCriteria,
  allMustPass,
  anyMustPass,
  percentageMustPass,
} from './success-criteria';

export type {
  ExecutionPhase,
  TrackerEvent,
} from './execution-tracker';
export { ExecutionTracker } from './execution-tracker';

export type {
  ExecutionControllerConfig,
} from './execution-controller';
export { ExecutionController } from './execution-controller';

export type {
  WorkflowGraph,
  WorkflowNode,
  ExecutionResult,
} from './graph-executor';
export { GraphExecutor } from './graph-executor';
