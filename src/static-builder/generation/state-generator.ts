/**
 * State generator — uses co-occurrence analysis to produce StateDefinition[]
 * with non-overlapping elements.
 *
 * In model-based GUI automation, each element belongs to exactly ONE state.
 * Multiple states are active simultaneously on any screen. States are
 * discovered by grouping elements that always appear together (identical
 * presence signature across routes).
 *
 * Example: if sidebar elements appear in ALL routes, they form one state.
 * If dashboard elements appear only in the "active" route, they form
 * another state. On the Active Dashboard screen, both states are active.
 *
 * For app-level branches (login, loading), blocking states are created
 * with excludedElements for the main layout.
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
  /**
   * Extracted elements per route ID. App shell elements (sidebar, header)
   * should be included in EVERY route's list — the co-occurrence grouper
   * will naturally create a state for them.
   */
  routeElements: Map<string, ExtractedElement[]>;
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
 * Uses co-occurrence grouping: elements are grouped by their presence
 * signature (which routes they appear in). Elements with identical
 * signatures form one state with non-overlapping requiredElements.
 */
export function generateStates(input: StateGeneratorInput): StateDefinition[] {
  const states: StateDefinition[] = [];

  const routeIds = input.routes.map((r) => r.caseValues[0]);

  // Build route metadata for naming
  const routeNameMap = new Map<string, string>();
  for (const route of input.routes) {
    const primaryId = route.caseValues[0];
    const overrideName = input.routeNameOverrides?.get(primaryId);
    const componentName =
      route.componentNames.find((n) => !SKIP_FOR_NAMING.has(n)) ??
      route.componentNames[0];
    routeNameMap.set(primaryId, overrideName ?? stateName(primaryId, componentName));
  }

  // ---- Step 1: Build presence map ----
  // For each element, track which screens it appears on. A "screen" is a
  // route + branch condition combination. Elements from all sources (route
  // elements, branch variants, sibling elements) go through the same pipeline.
  //
  // The presence map key is the serialized ElementQuery. The value tracks
  // which route IDs the element appears in. Co-occurrence grouping then
  // creates states from elements with identical presence signatures.
  const presenceMap = new Map<string, { query: ElementQuery; routeIds: Set<string> }>();

  const addToPresence = (query: ElementQuery, routeId: string) => {
    const key = JSON.stringify(query);
    const existing = presenceMap.get(key);
    if (existing) {
      existing.routeIds.add(routeId);
    } else {
      presenceMap.set(key, { query, routeIds: new Set([routeId]) });
    }
  };

  for (const route of input.routes) {
    const routeId = route.caseValues[0];

    // Route elements (including sibling elements added by the pipeline)
    const routeElems = input.routeElements.get(routeId) ?? [];
    for (const el of routeElems) addToPresence(el.query, routeId);

    // Branch variant elements — these appear on the same route
    const branches = input.routeBranches.get(routeId);
    if (branches) {
      for (const group of branches.branchGroups) {
        for (const variant of group.variants) {
          for (const el of variant.elements) addToPresence(el.query, routeId);
        }
      }
    }
  }

  // ---- Step 2: Group by presence signature ----
  // Elements appearing in the exact same set of routes form one state.
  const signatureGroups = new Map<string, ElementQuery[]>();
  for (const { query, routeIds } of presenceMap.values()) {
    const sig = [...routeIds].sort().join("|");
    const group = signatureGroups.get(sig);
    if (group) {
      group.push(query);
    } else {
      signatureGroups.set(sig, [query]);
    }
  }

  // ---- Step 3: Create states from groups ----
  for (const [sig, queries] of signatureGroups) {
    if (queries.length === 0) continue;

    const sigRoutes = sig.split("|");
    const isGlobal = sigRoutes.length === routeIds.length && routeIds.length > 1;
    const isSingleRoute = sigRoutes.length === 1;

    let id: string;
    let name: string;
    let group: string | undefined;
    let pathCost: number;

    if (isGlobal) {
      // Elements present in ALL routes — persistent UI (sidebar, header, footer)
      id = "global-layout";
      name = "Global Navigation";
      group = "global";
      pathCost = 0;
    } else if (isSingleRoute) {
      // Elements unique to one route — the page content state
      const routeId = sigRoutes[0];
      id = stateId(routeId);
      name = routeNameMap.get(routeId) ?? routeIdToWords(routeId);
      group = input.routeGroups?.get(routeId);
      pathCost = 1.0;
    } else {
      // Elements shared by a subset of routes — e.g., a shared panel
      const routeNames = sigRoutes
        .map((r) => routeNameMap.get(r) ?? r)
        .slice(0, 3)
        .join(", ");
      id = `shared-${sigRoutes.join("-").slice(0, 40)}`;
      name = `Shared (${routeNames}${sigRoutes.length > 3 ? ", ..." : ""})`;
      group = "shared";
      pathCost = 0.5;
    }

    states.push({ id, name, requiredElements: queries, group, pathCost });
  }

  // Ensure every route has a state, even if no elements were extracted.
  // This preserves naming, transitions, and alias support for empty routes.
  const existingRouteStateIds = new Set(states.map((s) => s.id));
  for (const route of input.routes) {
    const routeId = route.caseValues[0];
    const sid = stateId(routeId);
    if (!existingRouteStateIds.has(sid)) {
      states.push({
        id: sid,
        name: routeNameMap.get(routeId) ?? routeIdToWords(routeId),
        requiredElements: [],
        group: input.routeGroups?.get(routeId),
        pathCost: 1.0,
      });
    }
  }

  // Branch variant elements are already included in the presence map (Step 1).
  // The co-occurrence grouper handles them: variant elements that appear in
  // only one route get the same signature as that route's base elements,
  // and variant elements unique to a specific branch condition get their own
  // signature if they don't appear in other routes.

  // ---- Step 5: Register alias IDs on the primary state ----
  // Fall-through switch cases (e.g., "runs" and "history" rendering the same
  // component) map to the SAME state. We don't create duplicate states —
  // instead, store alias IDs so transitions can reference either name.
  // The primary state already has the correct elements from co-occurrence.
  // Alias IDs are unused in the state definition but recorded for transition
  // generation (sidebar transitions reference route IDs).

  // ---- Step 6: App-level blocking states ----
  // Blocking states (login, loading) exclude elements that appear in all routes,
  // since those elements indicate the normal app layout is active.
  const allRoutesSig = [...routeIds].sort().join("|");
  const allRoutesElements = signatureGroups.get(allRoutesSig) ?? [];

  for (const appBranch of input.appBranches) {
    const appQueries = appBranch.elements.map((el) => el.query);
    states.push({
      id: appStateId(appBranch.label),
      name: formatAppStateName(appBranch.label),
      requiredElements: appQueries,
      excludedElements: allRoutesElements.length > 0 ? allRoutesElements : undefined,
      blocking: appBranch.blocking,
      group: "app",
      pathCost: 10.0,
    });
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

  // Priority 0: data-page-id (definitive state identifier, always include)
  for (const el of elements) {
    if (el.query.attributes?.["data-page-id"]) {
      landmarks.push(el.query);
    }
  }

  // Priority 1: Elements with role or ariaLabel (structural landmarks)
  for (const el of elements) {
    if (landmarks.length >= MAX_LANDMARKS) break;
    if ((el.query.role || el.query.ariaLabel) && !el.interactive && !isDuplicate(el.query, landmarks)) {
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
