/**
 * Static state machine builder — public API.
 *
 * Analyzes React/TypeScript source code to produce StateDefinition[]
 * and TransitionDefinition[] for use with the AutomationEngine.
 */

// Pipeline
export { buildStateMachine, buildStateMachineAsync } from "./pipeline";
export type { BuildResult, UncertainItem, PipelineContext } from "./pipeline";

// Config
export type { BuilderConfig } from "./config";
export { resolveConfig } from "./config";

// Parsing
export type { RouteEntry } from "./parsing/route-extractor";
export { extractRoutes } from "./parsing/route-extractor";
export { loadProject } from "./parsing/source-loader";
export type { LoadedProject } from "./parsing/source-loader";
export type { ResolvedComponent } from "./parsing/import-resolver";
export {
  resolveComponent,
  resolveRouteComponents,
} from "./parsing/import-resolver";
export type { ParsedComponent, HookCall } from "./parsing/component-parser";
export { parseComponent, unwrapProviders } from "./parsing/component-parser";

// Extraction
export type { ExtractedElement } from "./extraction/element-extractor";
export {
  extractElements,
  extractElementsFromRoots,
} from "./extraction/element-extractor";
export type {
  GlobalLayout,
  AppBranch,
} from "./extraction/global-layout-extractor";
export {
  extractGlobalLayout,
  extractGlobalElementQueries,
} from "./extraction/global-layout-extractor";
export type {
  BranchVariant,
  BranchEnumeration,
  BranchGroup,
} from "./extraction/branch-enumerator";
export {
  enumerateBranches,
  enumerateEarlyReturns,
} from "./extraction/branch-enumerator";
export type { TracedHandler, TracedCall } from "./extraction/handler-tracer";
export { traceHandlers } from "./extraction/handler-tracer";
export type { TracedTransition } from "./extraction/navigation-tracer";
export {
  traceNavigationTransitions,
  traceNavigationInRoots,
} from "./extraction/navigation-tracer";

// Generation
export {
  stateId,
  appStateId,
  branchStateId,
  transitionId,
  sidebarTransitionId,
  stateName,
  transitionName,
  sidebarTransitionName,
} from "./generation/id-generator";
export type { StateGeneratorInput } from "./generation/state-generator";
export { generateStates } from "./generation/state-generator";
export type {
  TransitionGeneratorInput,
  SidebarConfig,
} from "./generation/transition-generator";
export { generateTransitions } from "./generation/transition-generator";

// Output
export type { WorkflowEmitterOptions } from "./output/workflow-emitter";
export {
  emitWorkflowConfig,
  emitWorkflowConfigJSON,
} from "./output/workflow-emitter";
export {
  emitPersistedStateMachine,
  emitPersistedStateMachineJSON,
} from "./output/persisted-emitter";

// Enhancement
export type {
  AIConfig,
  AIEnhancementResult,
  DynamicNavigationResult,
  InferredElementsResult,
  ImprovedLabelResult,
} from "./enhancement/ai-types";
export type { AIClient, AIEnhancementOptions } from "./enhancement/ai-analyzer";
export {
  enhanceWithAI,
  enhanceWithClient,
  createMockClient,
} from "./enhancement/ai-analyzer";
