/**
 * Transition generator — converts traced navigation data into
 * TransitionDefinition[] for the AutomationEngine.
 *
 * Produces two types of transitions:
 * 1. In-page transitions: from traced handler navigation calls
 *    (lower cost, preferred by Dijkstra pathfinder)
 * 2. Sidebar transitions: universal fallback that ensures graph connectivity
 *    (higher cost, used when no direct path exists)
 *
 * Output requirements:
 * - TransitionAction.target must be precise enough for executor.findElement()
 * - The graph must be connected: every non-blocking state reachable from every other
 * - Transition names must be AI-readable
 */

import type {
  TransitionDefinition,
  TransitionAction,
} from "../../state/state-machine";
import type { ElementQuery } from "../../core/element-query";
import type { TracedTransition } from "../extraction/navigation-tracer";
import {
  stateId,
  transitionId,
  transitionName,
  sidebarTransitionId,
  sidebarTransitionName,
} from "./id-generator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input data for transition generation. */
export interface TransitionGeneratorInput {
  /** Traced navigation transitions from handler analysis. */
  tracedTransitions: TracedTransition[];
  /** All generated state IDs (for sidebar transition generation). */
  stateIds: string[];
  /** State ID → human-readable name mapping. */
  stateNames: Map<string, string>;
  /** IDs of blocking states (excluded from sidebar transitions). */
  blockingStateIds: Set<string>;
  /** Navigation event name → target state ID mapping. */
  eventTargetMap?: Map<string, string>;
  /** Source file path → route state ID mapping (for source state inference). */
  sourceFileToState?: Map<string, string>;
  /**
   * Route file line ranges: maps (routeFilePath, lineNumber) to the state ID
   * of the case clause that contains that line. Used when transitions are traced
   * from the route file itself (prop callbacks in switch cases).
   */
  routeLineToState?: {
    filePath: string;
    ranges: Array<{ startLine: number; endLine: number; stateId: string }>;
  };
}

/** Configuration for sidebar transition generation. */
export interface SidebarConfig {
  /** Element query to find sidebar nav items. Template: {text} is replaced with the item label. */
  navItemQuery: ElementQuery;
  /** Whether to generate sidebar transitions (default true). */
  enabled: boolean;
  /** Path cost for sidebar transitions (default 5.0). */
  pathCost: number;
}

const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
  navItemQuery: { attributes: { "data-nav-item": "" } },
  enabled: true,
  pathCost: 5.0,
};

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate TransitionDefinition[] from traced transitions and state data.
 *
 * @param input - Traced transitions and state metadata.
 * @param sidebarConfig - Optional sidebar transition configuration.
 */
export function generateTransitions(
  input: TransitionGeneratorInput,
  sidebarConfig: Partial<SidebarConfig> = {},
): TransitionDefinition[] {
  const config = { ...DEFAULT_SIDEBAR_CONFIG, ...sidebarConfig };
  const transitions: TransitionDefinition[] = [];

  // Generate in-page transitions from traced handler data
  const inPageTransitions = generateInPageTransitions(input);
  transitions.push(...inPageTransitions);

  // Generate sidebar transitions for graph connectivity
  if (config.enabled) {
    const sidebarTransitions = generateSidebarTransitions(input, config);
    transitions.push(...sidebarTransitions);
  }

  return deduplicateTransitions(transitions);
}

// ---------------------------------------------------------------------------
// In-page transitions
// ---------------------------------------------------------------------------

/**
 * Generate transitions from traced navigation handler calls.
 *
 * Each TracedTransition becomes a TransitionDefinition with:
 * - fromStates: the route where the handler was found
 * - activateStates: the target route
 * - exitStates: the source route (since tab navigation replaces content)
 * - actions: click on the source element
 */
function generateInPageTransitions(
  input: TransitionGeneratorInput,
): TransitionDefinition[] {
  const transitions: TransitionDefinition[] = [];
  const seen = new Set<string>();

  for (const traced of input.tracedTransitions) {
    // Resolve the target state ID
    const targetStateId = resolveTargetState(traced, input);
    if (!targetStateId) continue;

    // Determine the source state from the source file
    const sourceStateId = inferSourceState(traced, input);
    if (!sourceStateId) continue;

    // Deduplicate by source+target
    const key = `${sourceStateId}|${targetStateId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sourceName = input.stateNames.get(sourceStateId) ?? sourceStateId;
    const targetName = input.stateNames.get(targetStateId) ?? targetStateId;

    const action: TransitionAction = {
      target: traced.sourceElement,
      action: traced.action === "submit" ? "click" : traced.action,
      waitAfter: { type: "idle", timeout: 5000 },
    };

    transitions.push({
      id: transitionId(sourceStateId, targetStateId),
      name: transitionName(sourceName, targetName),
      fromStates: [sourceStateId],
      activateStates: [targetStateId],
      exitStates: [sourceStateId],
      actions: [action],
      pathCost: 1.0,
    });
  }

  return transitions;
}

// ---------------------------------------------------------------------------
// Sidebar transitions
// ---------------------------------------------------------------------------

/**
 * Generate sidebar transitions for navigation between pages.
 *
 * The sidebar is a persistent UI element (global-layout state) that is
 * always active. Clicking a sidebar nav item activates the target page
 * state and deactivates the current page state.
 *
 * Each transition has:
 * - fromStates: ["global-layout"] — the sidebar must be visible
 * - activateStates: [targetId] — the page to navigate to
 * - exitStates: all other tab states — deactivates the previous page
 *
 * The pathfinder sees: active = {global-layout, tab-current}. The sidebar
 * transition fires because global-layout is active. After execution:
 * tab-current exits, tab-target activates → {global-layout, tab-target}.
 */
function generateSidebarTransitions(
  input: TransitionGeneratorInput,
  config: SidebarConfig,
): TransitionDefinition[] {
  const transitions: TransitionDefinition[] = [];

  // Only base tab states (not app states or branch variants)
  const tabStates = input.stateIds.filter(
    (id) =>
      id.startsWith("tab-") &&
      !id.includes("--") &&
      !input.blockingStateIds.has(id),
  );

  const globalStateId = "global-layout";

  for (const targetId of tabStates) {
    const targetName = input.stateNames.get(targetId) ?? targetId;
    const routeId = targetId.replace(/^tab-/, "");

    const navItemQuery: ElementQuery = {
      ...config.navItemQuery,
      attributes: {
        ...config.navItemQuery.attributes,
        "data-nav-item": routeId,
      },
    };

    transitions.push({
      id: sidebarTransitionId(targetId),
      name: sidebarTransitionName(targetName),
      fromStates: [globalStateId],
      activateStates: [targetId],
      exitStates: tabStates.filter((id) => id !== targetId),
      actions: [
        {
          target: navItemQuery,
          action: "click",
          waitAfter: { type: "idle", timeout: 5000 },
        },
      ],
      pathCost: config.pathCost,
    });
  }

  return transitions;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve a TracedTransition's target to a state ID.
 *
 * For direct navigation (setActiveTab("settings")), the target is the route ID.
 * For event navigation, use the eventTargetMap to resolve.
 */
function resolveTargetState(
  traced: TracedTransition,
  input: TransitionGeneratorInput,
): string | undefined {
  if (traced.mechanism === "event") {
    // Look up event name → state ID mapping
    const mappedId = input.eventTargetMap?.get(traced.targetState);
    if (mappedId) return mappedId;
    // Fallback: try treating the event name as a route ID
    const directId = stateId(traced.targetState);
    if (input.stateIds.includes(directId)) return directId;
    return undefined;
  }

  // Direct or reference: targetState is the route ID
  const targetId = stateId(traced.targetState);
  if (input.stateIds.includes(targetId)) return targetId;

  return undefined;
}

/**
 * Infer the source state from a traced transition's source file.
 *
 * Uses the sourceFileToState mapping (built by the pipeline from component
 * resolution data) for accurate matching. Falls back to file path heuristic.
 */
function inferSourceState(
  traced: TracedTransition,
  input: TransitionGeneratorInput,
): string | undefined {
  // Method 1: Line-range matching for transitions traced from the route file.
  // Each case clause in the switch statement has a line range that maps to a state.
  if (input.routeLineToState) {
    const normalizedPath = traced.sourceFile.replace(/\\/g, "/");
    const routePath = input.routeLineToState.filePath.replace(/\\/g, "/");
    if (normalizedPath === routePath) {
      for (const range of input.routeLineToState.ranges) {
        if (traced.line >= range.startLine && traced.line <= range.endLine) {
          return range.stateId;
        }
      }
    }
  }

  // Method 2: Explicit source file → state mapping from component resolution
  if (input.sourceFileToState) {
    const mapped = input.sourceFileToState.get(traced.sourceFile);
    if (mapped) return mapped;

    const normalized = traced.sourceFile.replace(/\\/g, "/");
    const mappedNorm = input.sourceFileToState.get(normalized);
    if (mappedNorm) return mappedNorm;
  }

  // Method 3: Fallback heuristic — match file path against route IDs
  const filePath = traced.sourceFile.toLowerCase().replace(/\\/g, "/");
  for (const id of input.stateIds) {
    if (!id.startsWith("tab-")) continue;
    const routeId = id.replace(/^tab-/, "");
    if (routeId.length < 4) continue;
    const pattern = routeId.replace(/-/g, "");
    if (filePath.includes(pattern)) {
      return id;
    }
  }

  return undefined;
}

/**
 * Deduplicate transitions by ID.
 */
function deduplicateTransitions(
  transitions: TransitionDefinition[],
): TransitionDefinition[] {
  const seen = new Set<string>();
  const result: TransitionDefinition[] = [];

  for (const t of transitions) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      result.push(t);
    }
  }

  return result;
}
