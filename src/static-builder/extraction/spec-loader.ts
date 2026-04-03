/**
 * Spec loader — reads UI Bridge spec files (.spec.uibridge.json) and
 * converts their element assertions into ElementQuery[] for state definitions.
 *
 * Spec files are the authoritative source for page elements. Each spec
 * describes what elements exist on a page using semantic criteria (role,
 * textContent, ariaLabel) that map directly to ElementQuery fields.
 *
 * This module provides a general capability: any application can provide
 * spec files to augment the statically-built state machine with precise
 * element data.
 *
 * Spec format:
 * {
 *   "metadata": { "component": "...", "pageUrl": "..." },
 *   "groups": [{
 *     "assertions": [{
 *       "target": { "criteria": { "role": "button", "textContent": "Stop" } }
 *     }]
 *   }]
 * }
 */

import type { ElementQuery } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A loaded spec file with its elements. */
export interface LoadedSpec {
  /** The spec file name (without extension). */
  specId: string;
  /** The page component name (from metadata.component). */
  component?: string;
  /** The page URL (from metadata.pageUrl). */
  pageUrl?: string;
  /** The spec description. */
  description?: string;
  /** Element queries extracted from assertions. */
  elements: ElementQuery[];
  /** Number of assertion groups. */
  groupCount: number;
  /** Total number of assertions. */
  assertionCount: number;
}

/** Raw spec file JSON structure. */
interface SpecFile {
  version?: string;
  description?: string;
  metadata?: {
    component?: string;
    pageUrl?: string;
    [key: string]: unknown;
  };
  groups?: SpecGroup[];
}

interface SpecGroup {
  id?: string;
  name?: string;
  assertions?: SpecAssertion[];
  [key: string]: unknown;
}

interface SpecAssertion {
  id?: string;
  enabled?: boolean;
  assertionType?: string;
  target?: {
    type?: string;
    criteria?: SpecCriteria;
    label?: string;
  };
  [key: string]: unknown;
}

interface SpecCriteria {
  role?: string;
  textContent?: string;
  textContains?: string;
  ariaLabel?: string;
  accessibleName?: string;
  selector?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load spec files from a directory and convert them to element queries.
 *
 * Reads all .spec.uibridge.json files, extracts element criteria from
 * each assertion, and returns LoadedSpec objects mapped by spec ID.
 *
 * @param specDir - Absolute path to the specs directory.
 * @param readFile - Function to read a file (injected for testability).
 * @param listFiles - Function to list files in a directory (injected for testability).
 * @returns Map from spec ID to LoadedSpec.
 */
export async function loadSpecs(
  specDir: string,
  readFile: (path: string) => Promise<string>,
  listFiles: (dir: string) => Promise<string[]>,
): Promise<Map<string, LoadedSpec>> {
  const specs = new Map<string, LoadedSpec>();
  const files = await listFiles(specDir);

  for (const file of files) {
    if (!file.endsWith(".spec.uibridge.json")) continue;

    const specId = file.replace(".spec.uibridge.json", "");
    const fullPath = `${specDir}/${file}`;

    try {
      const content = await readFile(fullPath);
      const parsed = JSON.parse(content) as SpecFile;
      const loaded = parseSpecFile(specId, parsed);
      specs.set(specId, loaded);
    } catch {
      // Skip files that can't be parsed
    }
  }

  return specs;
}

/**
 * Load specs synchronously (for use in the sync pipeline).
 */
export function loadSpecsSync(
  specDir: string,
  readFileSync: (path: string) => string,
  listFilesSync: (dir: string) => string[],
): Map<string, LoadedSpec> {
  const specs = new Map<string, LoadedSpec>();
  const files = listFilesSync(specDir);

  for (const file of files) {
    if (!file.endsWith(".spec.uibridge.json")) continue;

    const specId = file.replace(".spec.uibridge.json", "");
    const fullPath = `${specDir}/${file}`;

    try {
      const content = readFileSync(fullPath);
      const parsed = JSON.parse(content) as SpecFile;
      const loaded = parseSpecFile(specId, parsed);
      specs.set(specId, loaded);
    } catch {
      // Skip files that can't be parsed
    }
  }

  return specs;
}

/**
 * Map a spec ID to a route ID.
 *
 * Spec files are named after routes (e.g., active.spec.uibridge.json → "active").
 * Some specs have different naming (e.g., "graphql-dashboard-integration" doesn't
 * map to a route). The specId IS the route ID for most cases.
 */
export function specIdToRouteId(specId: string): string {
  return specId;
}

/**
 * Merge spec elements into state definitions.
 *
 * For each state, finds the matching spec (by route ID) and adds
 * the spec's elements to the state's requiredElements.
 *
 * @param specs - Loaded specs mapped by spec ID.
 * @param routeIdToStateId - Function to convert route ID to state ID.
 * @returns Map from state ID to additional ElementQuery[] from specs.
 */
export function specElementsByState(
  specs: Map<string, LoadedSpec>,
  routeIdToStateId: (routeId: string) => string,
): Map<string, ElementQuery[]> {
  const result = new Map<string, ElementQuery[]>();

  for (const [specId, spec] of specs) {
    const routeId = specIdToRouteId(specId);
    const stateId = routeIdToStateId(routeId);
    result.set(stateId, spec.elements);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a spec file JSON into a LoadedSpec.
 */
function parseSpecFile(specId: string, spec: SpecFile): LoadedSpec {
  const elements: ElementQuery[] = [];
  let assertionCount = 0;

  for (const group of spec.groups ?? []) {
    for (const assertion of group.assertions ?? []) {
      assertionCount++;

      // Skip disabled assertions
      if (assertion.enabled === false) continue;

      const criteria = assertion.target?.criteria;
      if (!criteria) continue;

      const query = criteriaToElementQuery(criteria);
      if (query) elements.push(query);
    }
  }

  return {
    specId,
    component: spec.metadata?.component,
    pageUrl: spec.metadata?.pageUrl,
    description: spec.description,
    elements,
    groupCount: spec.groups?.length ?? 0,
    assertionCount,
  };
}

/**
 * Convert spec criteria to an ElementQuery.
 *
 * Maps spec criteria fields to ElementQuery fields:
 * - role → role
 * - textContent → text
 * - textContains → textContains
 * - ariaLabel / accessibleName → ariaLabel
 */
function criteriaToElementQuery(criteria: SpecCriteria): ElementQuery | undefined {
  const query: ElementQuery = {};
  let hasField = false;

  if (criteria.role) {
    query.role = criteria.role;
    hasField = true;
  }

  if (criteria.textContent) {
    query.text = criteria.textContent;
    hasField = true;
  }

  if (criteria.textContains) {
    query.textContains = criteria.textContains;
    hasField = true;
  }

  if (criteria.ariaLabel || criteria.accessibleName) {
    query.ariaLabel = criteria.ariaLabel ?? criteria.accessibleName;
    hasField = true;
  }

  // Skip selector-only criteria (CSS selectors aren't ElementQuery fields)
  if (!hasField) return undefined;

  return query;
}
