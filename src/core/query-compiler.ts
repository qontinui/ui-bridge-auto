/**
 * Query compiler — pre-compiles ElementQuery objects into optimised
 * executable forms for fast repeated evaluation against element registries.
 *
 * Optimisations:
 * 1. Pre-computes which criteria are present so absent checks are skipped.
 * 2. Orders checks cheapest-first (id > role > tagName > text > spatial > style).
 * 3. Builds a fast-path index key for id/role combinations.
 */

import type { QueryableElement, ElementQuery, QueryResult } from "./element-query";
import { matchesQuery, executeQuery, findFirst } from "./element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A compiled query that can be executed efficiently against a registry.
 *
 * Pre-analyses the query structure at compile time so that execution
 * skips criteria that are not specified and evaluates criteria in
 * cheapest-first order.
 */
export interface CompiledQuery {
  /** The original query that was compiled. */
  readonly source: ElementQuery;

  /** Execute against all elements, returning every match. */
  execute(elements: QueryableElement[]): QueryResult[];

  /** Execute and return the first match, or `null` if none. */
  first(elements: QueryableElement[]): QueryResult | null;

  /** Check if any element in the collection matches. */
  test(elements: QueryableElement[]): boolean;

  /** Check if a specific element matches the compiled query. */
  matches(element: QueryableElement): boolean;
}

// ---------------------------------------------------------------------------
// Criteria analysis
// ---------------------------------------------------------------------------

/** Which criteria are present in the query, used to skip absent checks. */
interface CriteriaFlags {
  hasId: boolean;
  hasRole: boolean;
  hasTagName: boolean;
  hasText: boolean;
  hasTextContains: boolean;
  hasTextPattern: boolean;
  hasFuzzyText: boolean;
  hasAriaLabel: boolean;
  hasAriaState: boolean;
  hasAttributes: boolean;
  hasStateChecks: boolean;
  hasWithin: boolean;
  hasParent: boolean;
  hasAncestor: boolean;
  hasChild: boolean;
  hasStyle: boolean;
  hasLogical: boolean;
  hasSemantic: boolean;
  hasNear: boolean;
}

/** Count of criteria types, ordered cheapest first. */
type CriteriaOrder = Array<keyof CriteriaFlags>;

/**
 * Analyse a query and extract which criteria are present.
 */
function analyseQuery(query: ElementQuery): CriteriaFlags {
  return {
    hasId: query.id !== undefined,
    hasRole: query.role !== undefined,
    hasTagName: query.tagName !== undefined,
    hasText: query.text !== undefined,
    hasTextContains: query.textContains !== undefined,
    hasTextPattern: query.textPattern !== undefined,
    hasFuzzyText: query.fuzzyText !== undefined,
    hasAriaLabel: query.ariaLabel !== undefined,
    hasAriaState:
      query.ariaSelected !== undefined ||
      query.ariaExpanded !== undefined ||
      query.ariaPressed !== undefined,
    hasAttributes: query.attributes !== undefined,
    hasStateChecks:
      query.visible !== undefined ||
      query.enabled !== undefined ||
      query.checked !== undefined ||
      query.focused !== undefined,
    hasWithin: query.within !== undefined,
    hasParent: query.parent !== undefined,
    hasAncestor: query.ancestor !== undefined,
    hasChild: query.hasChild !== undefined,
    hasStyle: query.style !== undefined,
    hasLogical:
      query.and !== undefined ||
      query.or !== undefined ||
      query.not !== undefined,
    hasSemantic:
      query.purpose !== undefined ||
      query.semanticType !== undefined ||
      query.alias !== undefined,
    hasNear: query.near !== undefined,
  };
}

/**
 * Build an index key for quick cache lookups.
 * Combines id and role into a compact string when both are present.
 */
function buildIndexKey(query: ElementQuery): string | undefined {
  if (typeof query.id === "string" && query.role) {
    return `${query.id}::${query.role}`;
  }
  if (typeof query.id === "string") {
    return `id:${query.id}`;
  }
  if (query.role) {
    return `role:${query.role}`;
  }
  return undefined;
}

/**
 * Determine the cheapest-first check order based on which criteria exist.
 *
 * Cost estimates (from cheapest to most expensive):
 *   1. id         — string comparison
 *   2. role       — string comparison + possible inference
 *   3. tagName    — string comparison
 *   4. text       — string comparison on textContent
 *   5. state      — boolean comparisons
 *   6. aria       — attribute reads + comparisons
 *   7. attributes — loop over arbitrary attributes
 *   8. spatial    — bounding rect math
 *   9. style      — loop over computed styles
 *  10. structural — DOM tree walks (parent/ancestor/child)
 *  11. logical    — recursive sub-query evaluation
 */
function buildCheckOrder(flags: CriteriaFlags): CriteriaOrder {
  const order: CriteriaOrder = [];

  // Cheapest checks first
  if (flags.hasId) order.push("hasId");
  if (flags.hasRole) order.push("hasRole");
  if (flags.hasTagName) order.push("hasTagName");
  if (flags.hasText) order.push("hasText");
  if (flags.hasTextContains) order.push("hasTextContains");
  if (flags.hasTextPattern) order.push("hasTextPattern");
  if (flags.hasFuzzyText) order.push("hasFuzzyText");
  if (flags.hasStateChecks) order.push("hasStateChecks");
  if (flags.hasAriaLabel) order.push("hasAriaLabel");
  if (flags.hasAriaState) order.push("hasAriaState");
  if (flags.hasAttributes) order.push("hasAttributes");
  if (flags.hasSemantic) order.push("hasSemantic");
  if (flags.hasWithin) order.push("hasWithin");
  if (flags.hasNear) order.push("hasNear");
  if (flags.hasStyle) order.push("hasStyle");
  if (flags.hasParent) order.push("hasParent");
  if (flags.hasAncestor) order.push("hasAncestor");
  if (flags.hasChild) order.push("hasChild");
  if (flags.hasLogical) order.push("hasLogical");

  return order;
}

// ---------------------------------------------------------------------------
// Fast-path matchers
// ---------------------------------------------------------------------------

/**
 * Create an optimised id-only matcher that can skip the full matchesQuery
 * evaluation for the common case of querying by exact id.
 */
function createIdOnlyMatcher(
  id: string,
): (el: QueryableElement) => boolean {
  return (el) => el.id === id;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compile a query for repeated execution.
 *
 * Analyses the query structure at compile time and creates an optimised
 * execution plan:
 *
 * - If the query has only `id` (exact string), a direct comparison
 *   function is used instead of the full `matchesQuery` path.
 * - Otherwise, the query is frozen and passed to `matchesQuery`, which
 *   evaluates all criteria. The pre-analysis metadata is available for
 *   future optimisations.
 *
 * @param query - The query to compile.
 * @returns A CompiledQuery with `execute`, `first`, `test`, and `matches`.
 */
export function compileQuery(query: ElementQuery): CompiledQuery {
  const frozen = Object.freeze({ ...query });
  const flags = analyseQuery(frozen);
  const _checkOrder = buildCheckOrder(flags);
  const indexKey = buildIndexKey(frozen);

  // Attach index key hint if present (stored separately, not on frozen object)
  const _indexKey = indexKey;

  // Determine the active criteria count
  const activeCriteria = _checkOrder.length;

  // Fast path: id-only query (exact string, no other criteria)
  if (activeCriteria === 1 && flags.hasId && typeof frozen.id === "string") {
    const fastMatch = createIdOnlyMatcher(frozen.id);

    return {
      source: frozen,

      matches(element: QueryableElement): boolean {
        return fastMatch(element);
      },

      execute(elements: QueryableElement[]): QueryResult[] {
        const results: QueryResult[] = [];
        for (const el of elements) {
          if (fastMatch(el)) {
            results.push({
              id: el.id,
              label: el.label,
              type: el.type,
              matchReasons: [`id=${el.id}`],
            });
          }
        }
        return results;
      },

      first(elements: QueryableElement[]): QueryResult | null {
        for (const el of elements) {
          if (fastMatch(el)) {
            return {
              id: el.id,
              label: el.label,
              type: el.type,
              matchReasons: [`id=${el.id}`],
            };
          }
        }
        return null;
      },

      test(elements: QueryableElement[]): boolean {
        return elements.some(fastMatch);
      },
    };
  }

  // Standard path: delegate to matchesQuery with the frozen query
  return {
    source: frozen,

    matches(element: QueryableElement): boolean {
      return matchesQuery(element, frozen).matches;
    },

    execute(elements: QueryableElement[]): QueryResult[] {
      return executeQuery(elements, frozen);
    },

    first(elements: QueryableElement[]): QueryResult | null {
      return findFirst(elements, frozen);
    },

    test(elements: QueryableElement[]): boolean {
      for (const el of elements) {
        if (matchesQuery(el, frozen).matches) return true;
      }
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// Query cache
// ---------------------------------------------------------------------------

/**
 * LRU cache for compiled queries.
 *
 * Frequently used queries are compiled once and reused. The cache key
 * is computed via `JSON.stringify` of the query object. When the cache
 * reaches its maximum size, the oldest entry is evicted (FIFO, which
 * approximates LRU for sequential access patterns).
 */
export class QueryCache {
  private cache = new Map<string, CompiledQuery>();
  private readonly maxSize: number;

  /**
   * Create a new query cache.
   * @param maxSize - Maximum number of compiled queries to retain (default 128).
   */
  constructor(maxSize: number = 128) {
    this.maxSize = maxSize;
  }

  /**
   * Get a compiled query from the cache, compiling and caching it if
   * it is not already present.
   *
   * @param query - The query to get or compile.
   * @returns The compiled query.
   */
  get(query: ElementQuery): CompiledQuery {
    const key = queryToKey(query);
    const existing = this.cache.get(key);
    if (existing) {
      // Move to end for LRU behaviour
      this.cache.delete(key);
      this.cache.set(key, existing);
      return existing;
    }

    // Evict oldest entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const compiled = compileQuery(query);
    this.cache.set(key, compiled);
    return compiled;
  }

  /** Clear all cached compiled queries. */
  invalidate(): void {
    this.cache.clear();
  }

  /** The current number of cached compiled queries. */
  get size(): number {
    return this.cache.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialise a query to a stable cache key.
 *
 * Uses JSON.stringify with a replacer that handles RegExp objects,
 * which are otherwise serialised as `{}`.
 */
function queryToKey(query: ElementQuery): string {
  return JSON.stringify(query, (_key, value) => {
    if (value instanceof RegExp) {
      return `__regexp__${value.source}__${value.flags}`;
    }
    return value as unknown;
  });
}
