/**
 * Semantic matching for elements based on purpose, type aliases, and
 * natural-language descriptions.
 *
 * Enables queries like "find the submit button" or "locate the login form"
 * by matching against semantic metadata attached to elements.
 */

import type { QueryableElement } from "./element-query";
import { isFuzzyMatch, similarity, tokenMatch } from "./fuzzy-match";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticQuery {
  /** Natural-language description of the desired element. */
  description: string;
  /** Maximum number of results to return (default: 10). */
  maxResults?: number;
  /** Minimum score to include in results (default: 0.3). */
  minScore?: number;
}

export interface SemanticResult {
  element: QueryableElement;
  score: number;
  matchedOn: string; // which field produced the best score
}

/**
 * Optional semantic metadata that may be attached to a QueryableElement.
 * These fields are not part of the base QueryableElement contract but are
 * commonly set by callers (and tests) to support natural-language matching.
 */
interface SemanticFields {
  purpose?: unknown;
  semanticType?: unknown;
  aliases?: unknown;
}

// ---------------------------------------------------------------------------
// Single-element semantic match
// ---------------------------------------------------------------------------

/**
 * Check whether a single element semantically matches a query string.
 *
 * Inspects the element's `purpose`, `semanticType`, `aliases`, and `label`
 * fields. Returns `true` if any of those fields fuzzy-match the query.
 */
export function matchesSemantic(
  element: QueryableElement,
  query: string,
  threshold: number = 0.55,
): boolean {
  const el = element as QueryableElement & SemanticFields;
  const lowerQuery = query.toLowerCase();

  // Check purpose
  if (el.purpose && typeof el.purpose === "string") {
    if (tokenMatch(lowerQuery, el.purpose) || isFuzzyMatch(lowerQuery, el.purpose.toLowerCase(), threshold)) {
      return true;
    }
  }

  // Check semanticType
  if (el.semanticType && typeof el.semanticType === "string") {
    if (isFuzzyMatch(lowerQuery, el.semanticType.toLowerCase(), threshold)) {
      return true;
    }
  }

  // Check aliases
  if (el.aliases && Array.isArray(el.aliases)) {
    for (const alias of el.aliases) {
      if (isFuzzyMatch(lowerQuery, String(alias).toLowerCase(), threshold)) {
        return true;
      }
    }
  }

  // Check label
  if (element.label) {
    if (isFuzzyMatch(lowerQuery, element.label.toLowerCase(), threshold)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Semantic search across a collection
// ---------------------------------------------------------------------------

/**
 * Search a collection of elements by a natural-language description.
 *
 * Scores each element against the description and returns the top matches
 * sorted by score descending.
 */
export function semanticSearch(
  elements: QueryableElement[],
  query: SemanticQuery,
): SemanticResult[] {
  const { description, maxResults = 10, minScore = 0.3 } = query;
  const lowerDesc = description.toLowerCase();
  const results: SemanticResult[] = [];

  for (const element of elements) {
    const { score, matchedOn } = computeSemanticScore(element, lowerDesc);
    if (score >= minScore) {
      results.push({ element, score, matchedOn });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSemanticScore(
  element: QueryableElement,
  lowerQuery: string,
): { score: number; matchedOn: string } {
  const el = element as QueryableElement & SemanticFields;
  let bestScore = 0;
  let matchedOn = "none";

  // Purpose (highest weight)
  if (el.purpose && typeof el.purpose === "string") {
    const s = similarity(lowerQuery, el.purpose.toLowerCase());
    const tokenBonus = tokenMatch(lowerQuery, el.purpose) ? 0.15 : 0;
    const total = Math.min(1.0, s + tokenBonus);
    if (total > bestScore) {
      bestScore = total;
      matchedOn = "purpose";
    }
  }

  // Semantic type
  if (el.semanticType && typeof el.semanticType === "string") {
    const s = similarity(lowerQuery, el.semanticType.toLowerCase());
    if (s > bestScore) {
      bestScore = s;
      matchedOn = "semanticType";
    }
  }

  // Aliases
  if (el.aliases && Array.isArray(el.aliases)) {
    for (const alias of el.aliases) {
      const s = similarity(lowerQuery, String(alias).toLowerCase());
      if (s > bestScore) {
        bestScore = s;
        matchedOn = "alias";
      }
    }
  }

  // Label
  if (element.label) {
    const s = similarity(lowerQuery, element.label.toLowerCase());
    if (s > bestScore) {
      bestScore = s;
      matchedOn = "label";
    }
  }

  return { score: bestScore, matchedOn };
}
