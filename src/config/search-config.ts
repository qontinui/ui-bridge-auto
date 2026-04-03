/**
 * Element search and query configuration.
 *
 * Controls how element queries are resolved — fuzzy matching thresholds,
 * case sensitivity, result limits, and whether hidden/disabled elements
 * are included in results.
 */

// ---------------------------------------------------------------------------
// Search config
// ---------------------------------------------------------------------------

/**
 * Configuration for element search and query operations.
 */
export interface SearchConfig {
  /** Maximum time (ms) to wait for an element to appear (default 5000). */
  defaultTimeout: number;
  /**
   * Levenshtein distance threshold for fuzzy text matching (0.0-1.0).
   * 0.0 = exact match only, 1.0 = match anything. Default 0.3.
   */
  fuzzyThreshold: number;
  /** Whether fuzzy text matching is enabled (default true). */
  fuzzyEnabled: boolean;
  /** Whether text matching is case-sensitive (default false). */
  caseSensitive: boolean;
  /** Maximum number of elements to return for multi-match queries (default 50). */
  maxResults: number;
  /** Whether to include visibility:hidden elements in results (default false). */
  includeHidden: boolean;
  /** Whether to include disabled elements in results (default true). */
  includeDisabled: boolean;
  /** Whether to prefer stable IDs over registry-generated IDs (default true). */
  preferStableIds: boolean;
}

// ---------------------------------------------------------------------------
// Factory and merge
// ---------------------------------------------------------------------------

/**
 * Create a SearchConfig with sensible defaults.
 *
 * Default values:
 * - defaultTimeout: 5000 ms
 * - fuzzyThreshold: 0.3
 * - fuzzyEnabled: true
 * - caseSensitive: false
 * - maxResults: 50
 * - includeHidden: false
 * - includeDisabled: true
 * - preferStableIds: true
 */
export function createDefaultSearchConfig(): SearchConfig {
  return {
    defaultTimeout: 5000,
    fuzzyThreshold: 0.3,
    fuzzyEnabled: true,
    caseSensitive: false,
    maxResults: 50,
    includeHidden: false,
    includeDisabled: true,
    preferStableIds: true,
  };
}

/**
 * Merge partial overrides into a base SearchConfig.
 * Only fields present in overrides replace the base values.
 */
export function mergeSearchConfig(
  base: SearchConfig,
  overrides: Partial<SearchConfig>,
): SearchConfig {
  return {
    defaultTimeout: overrides.defaultTimeout ?? base.defaultTimeout,
    fuzzyThreshold: overrides.fuzzyThreshold ?? base.fuzzyThreshold,
    fuzzyEnabled: overrides.fuzzyEnabled ?? base.fuzzyEnabled,
    caseSensitive: overrides.caseSensitive ?? base.caseSensitive,
    maxResults: overrides.maxResults ?? base.maxResults,
    includeHidden: overrides.includeHidden ?? base.includeHidden,
    includeDisabled: overrides.includeDisabled ?? base.includeDisabled,
    preferStableIds: overrides.preferStableIds ?? base.preferStableIds,
  };
}

/**
 * Validate a SearchConfig and return any errors found.
 * Returns an empty array if the config is valid.
 */
export function validateSearchConfig(config: SearchConfig): string[] {
  const errors: string[] = [];

  if (config.defaultTimeout <= 0) {
    errors.push("defaultTimeout must be a positive number");
  }

  if (config.fuzzyThreshold < 0 || config.fuzzyThreshold > 1) {
    errors.push("fuzzyThreshold must be between 0.0 and 1.0");
  }

  if (config.maxResults <= 0) {
    errors.push("maxResults must be a positive number");
  }

  if (!Number.isInteger(config.maxResults)) {
    errors.push("maxResults must be an integer");
  }

  return errors;
}
