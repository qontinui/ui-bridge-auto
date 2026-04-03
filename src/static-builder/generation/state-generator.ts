/**
 * State generator — combines route elements, global elements, and branch
 * variants into StateDefinition[] for the AutomationEngine.
 *
 * Each route becomes a state. Branch variants within a route create
 * additional sub-states. App-level early returns (login, loading) create
 * blocking states.
 *
 * Output requirements:
 * - requiredElements must be precise enough for StateDetector.evaluate()
 * - State names must be AI-readable for agent decision-making
 * - The set of states must cover all reachable UI configurations
 */

import type { StateDefinition } from "../../state/state-machine";
import type { ElementQuery } from "../../core/element-query";
import type { RouteEntry } from "../parsing/route-extractor";
import type { ExtractedElement } from "../extraction/element-extractor";
import type { BranchEnumeration } from "../extraction/branch-enumerator";
import type { AppBranch } from "../extraction/global-layout-extractor";
import { stateId, appStateId, branchStateId, stateName } from "./id-generator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Component names that are wrappers/metadata — skip for AI-readable naming. */
const SKIP_FOR_NAMING = new Set([
  "PageRegistration",
  "Suspense",
  "React.Suspense",
  "LazyFallback",
  "ErrorBoundary",
  "RunSelectionProvider",
  "RunPageLayout",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input data for state generation. */
export interface StateGeneratorInput {
  /** Route entries from the route extractor. */
  routes: RouteEntry[];
  /** Extracted elements per route ID. */
  routeElements: Map<string, ExtractedElement[]>;
  /** Global layout elements (always present). */
  globalElements: ExtractedElement[];
  /** Branch enumerations per route ID. */
  routeBranches: Map<string, BranchEnumeration>;
  /** App-level blocking states (login, loading, etc.). */
  appBranches: AppBranch[];
  /** Navigation group mapping (route ID -> group name). */
  routeGroups?: Map<string, string>;
  /** Route ID -> page name overrides (from PageRegistration props). */
  routeNameOverrides?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Generate StateDefinition[] from extracted route and element data.
 *
 * For each route:
 * 1. Create a base state with global + page elements as requiredElements
 * 2. If the route has branch variants, create sub-states for each variant
 *
 * For app-level branches (login, loading):
 * 3. Create blocking states with excludedElements for the main layout
 */
export function generateStates(input: StateGeneratorInput): StateDefinition[] {
  const states: StateDefinition[] = [];

  const globalQueries = input.globalElements.map((el) => el.query);

  // Generate states for each route
  for (const route of input.routes) {
    const primaryId = route.caseValues[0];
    const routeElems = input.routeElements.get(primaryId) ?? [];
    const branches = input.routeBranches.get(primaryId);
    const group = input.routeGroups?.get(primaryId);

    // Get the primary component name for AI-readable naming.
    // Skip metadata/wrapper components and prefer the actual page component.
    // Use PageRegistration name if available (most accurate),
    // otherwise infer from component name, skipping wrapper components.
    const overrideName = input.routeNameOverrides?.get(primaryId);
    const componentName =
      route.componentNames.find((n) => !SKIP_FOR_NAMING.has(n)) ??
      route.componentNames[0];
    const name = overrideName ?? stateName(primaryId, componentName);

    // Select landmark elements for state detection (not all elements)
    const landmarkQueries = selectLandmarks(routeElems);

    // Base state
    const baseState: StateDefinition = {
      id: stateId(primaryId),
      name,
      requiredElements: [...globalQueries, ...landmarkQueries],
      group,
      pathCost: 1.0,
    };

    states.push(baseState);

    // Branch variant sub-states
    if (branches && branches.branchGroups.length > 0) {
      for (const branchGroup of branches.branchGroups) {
        for (const variant of branchGroup.variants) {
          if (variant.elements.length === 0) continue; // skip empty (absent) variants

          const variantQueries = variant.elements.map((el) => el.query);
          const variantState: StateDefinition = {
            id: branchStateId(primaryId, variant.conditionLabel),
            name: `${name} (${formatConditionLabel(variant.conditionLabel)})`,
            requiredElements: [
              ...globalQueries,
              ...landmarkQueries,
              ...variantQueries,
            ],
            group,
            pathCost: 1.5, // slightly higher cost — prefer base state in pathfinding
          };

          states.push(variantState);
        }
      }
    }

    // Register alias state IDs for fall-through cases
    for (let i = 1; i < route.caseValues.length; i++) {
      const aliasId = route.caseValues[i];
      const aliasState: StateDefinition = {
        id: stateId(aliasId),
        name: `${name} (${routeIdToWords(aliasId)})`,
        requiredElements: baseState.requiredElements,
        group,
        pathCost: 1.0,
      };
      states.push(aliasState);
    }
  }

  // Generate app-level blocking states
  for (const appBranch of input.appBranches) {
    const appQueries = appBranch.elements.map((el) => el.query);
    const appState: StateDefinition = {
      id: appStateId(appBranch.label),
      name: formatAppStateName(appBranch.label),
      requiredElements: appQueries,
      excludedElements: globalQueries.length > 0 ? globalQueries : undefined,
      blocking: appBranch.blocking,
      group: "app",
      pathCost: 10.0, // high cost — pathfinder should avoid routing through app states
    };
    states.push(appState);
  }

  return states;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Select landmark elements for state detection.
 *
 * Not every element should be a required element — too many creates fragile
 * detection. Select elements that are distinctive for this page:
 * - Elements with role (headings, regions, navigation landmarks)
 * - Elements with unique IDs
 * - Elements with data-content-role
 * - Interactive elements with aria-labels (buttons with distinct names)
 *
 * Cap at a reasonable number to avoid over-specification.
 */
function selectLandmarks(elements: ExtractedElement[]): ElementQuery[] {
  const landmarks: ElementQuery[] = [];
  const MAX_LANDMARKS = 8;

  // Priority 1: Elements with role (structural landmarks)
  for (const el of elements) {
    if (landmarks.length >= MAX_LANDMARKS) break;
    if (el.query.role && !el.interactive) {
      landmarks.push(el.query);
    }
  }

  // Priority 2: Elements with data-content-role
  for (const el of elements) {
    if (landmarks.length >= MAX_LANDMARKS) break;
    if (
      el.query.attributes?.["data-content-role"] &&
      !isDuplicate(el.query, landmarks)
    ) {
      landmarks.push(el.query);
    }
  }

  // Priority 3: Elements with unique IDs
  for (const el of elements) {
    if (landmarks.length >= MAX_LANDMARKS) break;
    if (el.query.id && !isDuplicate(el.query, landmarks)) {
      landmarks.push(el.query);
    }
  }

  // Priority 4: Interactive elements with aria-labels (for state uniqueness)
  for (const el of elements) {
    if (landmarks.length >= MAX_LANDMARKS) break;
    if (
      el.interactive &&
      el.query.ariaLabel &&
      !isDuplicate(el.query, landmarks)
    ) {
      landmarks.push(el.query);
    }
  }

  return landmarks;
}

/** Check if a query is already in the landmarks list. */
function isDuplicate(query: ElementQuery, landmarks: ElementQuery[]): boolean {
  const key = JSON.stringify(query);
  return landmarks.some((l) => JSON.stringify(l) === key);
}

/**
 * Format a condition label for display in state names.
 * "isToolkitOpen" → "Toolkit Open"
 * "data.items.length > 0" → "Has Items"
 */
function formatConditionLabel(label: string): string {
  // Strip boolean prefixes
  let cleaned = label
    .replace(/^!?\(/, "")
    .replace(/\)$/, "")
    .replace(/^(is|has|show|should)/i, "");

  // CamelCase to spaces
  cleaned = cleaned.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Clean up
  cleaned = cleaned.replace(/[^a-zA-Z0-9\s]/g, " ").trim();

  if (!cleaned) return label.slice(0, 20);

  // Title case
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Convert a route ID to readable words. */
function routeIdToWords(routeId: string): string {
  return routeId
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Format an app-level state name. */
function formatAppStateName(label: string): string {
  const names: Record<string, string> = {
    loading: "Loading",
    login: "Login Screen",
    setup: "Setup Wizard",
    error: "Error Screen",
    maintenance: "Maintenance Mode",
  };
  return (
    names[label] ?? `App: ${label.charAt(0).toUpperCase() + label.slice(1)}`
  );
}
