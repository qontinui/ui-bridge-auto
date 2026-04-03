/**
 * Match results and query diagnostics for element queries.
 *
 * All matching is deterministic — an element either matches or it does not.
 * There are no confidence scores or probabilistic results. Match reasons
 * provide full traceability for debugging.
 */

import type { AutomationElement } from "./element";

// ---------------------------------------------------------------------------
// Element criteria
// ---------------------------------------------------------------------------

/**
 * Minimal criteria to identify a DOM element.
 * A subset of the full ElementQuery used in state definitions and transition
 * actions where only a lightweight match specification is needed.
 */
export interface ElementCriteria {
  /** ARIA role or inferred role. */
  role?: string;
  /** Exact text content (trimmed). */
  text?: string;
  /** Substring match on text content (case-insensitive). */
  textContains?: string;
  /** ARIA label (case-insensitive substring match). */
  ariaLabel?: string;
  /** Element ID (exact string or pattern). */
  id?: string | RegExp;
  /** HTML attributes to check (exact string, pattern, or presence). */
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Single match result
// ---------------------------------------------------------------------------

/**
 * Result of querying for a single element.
 * The element field is populated only when found is true.
 */
export interface MatchResult {
  /** Whether a matching element was found. */
  found: boolean;
  /** The matched element, if found. */
  element?: AutomationElement;
  /** Human-readable reasons explaining why the element matched. */
  matchReasons: string[];
  /** How long the query took to execute (ms). */
  queryTime: number;
}

// ---------------------------------------------------------------------------
// Multi match result
// ---------------------------------------------------------------------------

/**
 * Result of querying for multiple elements matching the same criteria.
 */
export interface MultiMatchResult {
  /** Whether at least one matching element was found. */
  found: boolean;
  /** All matching elements, in document order. */
  elements: AutomationElement[];
  /** Number of matching elements. */
  count: number;
  /** Match reasons for each element (parallel array to elements). */
  matchReasons: string[][];
  /** How long the query took to execute (ms). */
  queryTime: number;
}

// ---------------------------------------------------------------------------
// Query explanation (diagnostics)
// ---------------------------------------------------------------------------

/**
 * Detailed per-criterion evaluation result for a single element.
 * Used to explain why an element did or did not match a query.
 */
export interface CriteriaResult {
  /** Human-readable description of the criterion (e.g., "role === 'button'"). */
  criterion: string;
  /** Whether this specific criterion was satisfied. */
  matched: boolean;
  /** The actual value found on the element, if applicable. */
  actual?: string;
  /** The expected value from the query, if applicable. */
  expected?: string;
}

/**
 * Full diagnostic explanation of how a query was evaluated against an element.
 * Contains per-criterion results to pinpoint exactly which criteria passed/failed.
 */
export interface QueryExplanation {
  /** Registry ID of the element being evaluated. */
  elementId: string;
  /** Human-readable label of the element. */
  elementLabel: string;
  /** Whether the element matched the overall query. */
  matched: boolean;
  /** Per-criterion evaluation results. */
  criteriaResults: CriteriaResult[];
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Create a MatchResult indicating no match was found.
 */
export function noMatch(queryTimeMs: number): MatchResult {
  return {
    found: false,
    matchReasons: [],
    queryTime: queryTimeMs,
  };
}

/**
 * Create a MatchResult for a successful match.
 */
export function matched(
  element: AutomationElement,
  reasons: string[],
  queryTimeMs: number,
): MatchResult {
  return {
    found: true,
    element,
    matchReasons: reasons,
    queryTime: queryTimeMs,
  };
}

/**
 * Evaluate an ElementCriteria against the properties of an AutomationElement.
 * Returns a QueryExplanation with per-criterion results.
 */
export function explainMatch(
  element: AutomationElement,
  criteria: ElementCriteria,
): QueryExplanation {
  const results: CriteriaResult[] = [];
  let allMatched = true;

  if (criteria.role !== undefined) {
    const actual = element.type;
    const ok = actual === criteria.role;
    if (!ok) allMatched = false;
    results.push({
      criterion: `role === '${criteria.role}'`,
      matched: ok,
      actual,
      expected: criteria.role,
    });
  }

  if (criteria.text !== undefined) {
    const actual = element.state.textContent.trim();
    const ok = actual === criteria.text.trim();
    if (!ok) allMatched = false;
    results.push({
      criterion: `text === '${criteria.text}'`,
      matched: ok,
      actual,
      expected: criteria.text,
    });
  }

  if (criteria.textContains !== undefined) {
    const actual = element.state.textContent.toLowerCase();
    const expected = criteria.textContains.toLowerCase();
    const ok = actual.includes(expected);
    if (!ok) allMatched = false;
    results.push({
      criterion: `textContains '${criteria.textContains}'`,
      matched: ok,
      actual: element.state.textContent,
      expected: criteria.textContains,
    });
  }

  if (criteria.ariaLabel !== undefined) {
    const actual = element.label.toLowerCase();
    const expected = criteria.ariaLabel.toLowerCase();
    const ok = actual.includes(expected);
    if (!ok) allMatched = false;
    results.push({
      criterion: `ariaLabel contains '${criteria.ariaLabel}'`,
      matched: ok,
      actual: element.label,
      expected: criteria.ariaLabel,
    });
  }

  if (criteria.id !== undefined) {
    const actual = element.id;
    let ok: boolean;
    if (typeof criteria.id === "string") {
      ok = actual === criteria.id;
      results.push({
        criterion: `id === '${criteria.id}'`,
        matched: ok,
        actual,
        expected: criteria.id,
      });
    } else {
      ok = criteria.id.test(actual);
      results.push({
        criterion: `id matches ${criteria.id}`,
        matched: ok,
        actual,
        expected: criteria.id.toString(),
      });
    }
    if (!ok) allMatched = false;
  }

  if (criteria.attributes !== undefined) {
    for (const [name, expected] of Object.entries(criteria.attributes)) {
      const actual = element.automationId && name === "data-testid"
        ? element.automationId
        : undefined;
      const ok = actual === expected;
      if (!ok) allMatched = false;
      results.push({
        criterion: `attr[${name}] === '${expected}'`,
        matched: ok,
        actual: actual ?? "(not found)",
        expected,
      });
    }
  }

  return {
    elementId: element.id,
    elementLabel: element.label,
    matched: allMatched,
    criteriaResults: results,
  };
}
