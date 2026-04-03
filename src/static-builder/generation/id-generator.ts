/**
 * ID generator — produces deterministic, human-readable identifiers
 * for states and transitions.
 *
 * IDs are stable across builds (same input → same output) and
 * self-documenting for both AI agents and human readers.
 *
 * Patterns:
 * - State: "tab-active", "tab-settings", "app-login"
 * - Branch variant: "tab-active--toolkit-open"
 * - Transition: "tab-active--to--tab-settings"
 * - Sidebar transition: "sidebar--to--tab-settings"
 */

// ---------------------------------------------------------------------------
// State IDs
// ---------------------------------------------------------------------------

/**
 * Generate a state ID from a route ID.
 * @example stateId("active") => "tab-active"
 * @example stateId("settings-ai") => "tab-settings-ai"
 */
export function stateId(routeId: string): string {
  return `tab-${routeId}`;
}

/**
 * Generate a state ID for an app-level state (login, loading, etc.).
 * @example appStateId("login") => "app-login"
 */
export function appStateId(label: string): string {
  return `app-${slugify(label)}`;
}

/**
 * Generate a state ID for a branch variant within a route.
 * @example branchStateId("active", "isToolkitOpen") => "tab-active--toolkit-open"
 */
export function branchStateId(routeId: string, conditionLabel: string): string {
  return `tab-${routeId}--${slugify(conditionLabel)}`;
}

// ---------------------------------------------------------------------------
// Transition IDs
// ---------------------------------------------------------------------------

/**
 * Generate a transition ID from source and target state IDs.
 * @example transitionId("tab-active", "tab-settings") => "tab-active--to--tab-settings"
 */
export function transitionId(fromStateId: string, toStateId: string): string {
  return `${fromStateId}--to--${toStateId}`;
}

/**
 * Generate a sidebar transition ID for a target state.
 * @example sidebarTransitionId("tab-settings") => "sidebar--to--tab-settings"
 */
export function sidebarTransitionId(toStateId: string): string {
  return `sidebar--to--${toStateId}`;
}

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

/**
 * Generate an AI-readable state name from a route ID.
 *
 * Converts kebab-case route IDs to Title Case with contextual improvements:
 * - "gui-automation" → "GUI Automation"
 * - "run-recap" → "Run Recap"
 * - "settings-ai" → "Settings AI"
 * - "active" → "Active Dashboard"
 *
 * @param routeId - The route ID string.
 * @param componentName - Optional component name for better naming.
 */
export function stateName(routeId: string, componentName?: string): string {
  // If we have a component name, derive from it
  if (componentName) {
    const fromComponent = componentNameToTitle(componentName);
    if (fromComponent) return fromComponent;
  }

  // Derive from route ID
  return routeIdToTitle(routeId);
}

/**
 * Generate a transition name from source and target state names.
 * @example transitionName("Active Dashboard", "Settings") => "Active Dashboard → Settings"
 */
export function transitionName(fromName: string, toName: string): string {
  return `${fromName} → ${toName}`;
}

/**
 * Generate a sidebar transition name.
 * @example sidebarTransitionName("Settings") => "Sidebar → Settings"
 */
export function sidebarTransitionName(toName: string): string {
  return `Sidebar → ${toName}`;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Common abbreviations that should stay uppercase. */
const UPPER_WORDS = new Set([
  "ai",
  "api",
  "ui",
  "gui",
  "llm",
  "mcp",
  "qa",
  "id",
  "sql",
  "css",
  "html",
  "url",
  "sdk",
  "cli",
  "http",
]);

/** Route IDs that have known better names. */
const ROUTE_NAME_OVERRIDES: Record<string, string> = {
  "gui-automation": "GUI Automation",
  active: "Active Dashboard",
  "run-recap": "Run Recap",
  "run-ai-output": "Run AI Output",
  "run-ai-data": "Run AI Data",
  ai: "AI Conversation",
  help: "Help",
  terminal: "Terminal",
};

/**
 * Convert a route ID to a title.
 * "settings-ai" → "Settings AI"
 */
function routeIdToTitle(routeId: string): string {
  if (ROUTE_NAME_OVERRIDES[routeId]) {
    return ROUTE_NAME_OVERRIDES[routeId];
  }

  return routeId
    .split("-")
    .map((word) =>
      UPPER_WORDS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * Convert a PascalCase component name to a title.
 * "ActiveDashboardPage" → "Active Dashboard"
 * "RunRecapTab" → "Run Recap"
 */
function componentNameToTitle(name: string): string | undefined {
  // Strip common suffixes
  const stripped = name
    .replace(/Page$/, "")
    .replace(/Tab$/, "")
    .replace(/Panel$/, "")
    .replace(/Dashboard$/, " Dashboard")
    .replace(/View$/, "");

  if (!stripped) return undefined;

  // Split PascalCase
  const words = stripped.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (!words) return undefined;

  // Apply uppercase rules
  return words
    .split(" ")
    .map((word) =>
      UPPER_WORDS.has(word.toLowerCase()) ? word.toUpperCase() : word,
    )
    .join(" ");
}

/**
 * Slugify a condition label for use in IDs.
 * "isToolkitOpen" → "toolkit-open"
 * "data.items.length > 0" → "data-items-length-gt-0"
 */
function slugify(label: string): string {
  let result = label
    .replace(/^(is|has|show|should)(?=[A-Z])/i, "") // Strip boolean prefixes only before uppercase
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase to kebab
    .replace(/[^a-zA-Z0-9]+/g, "-") // non-alphanumeric to dash
    .replace(/^-+|-+$/g, "") // trim leading/trailing dashes
    .toLowerCase()
    .slice(0, 40); // cap length

  // Fallback: if stripping emptied the result, use the original
  if (!result) {
    result =
      label
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 40) || "unknown";
  }

  return result;
}
