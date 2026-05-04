/**
 * Query result ranking.
 *
 * Scores and ranks elements by how well they match a query. Each matching
 * criterion contributes a weighted score, and the composite is normalised
 * to 0.0-1.0. This enables "best match" selection when multiple elements
 * satisfy a query.
 *
 * Scoring rules:
 *   - Exact text match:        +1.0
 *   - Exact id match:          +0.9
 *   - Role match:              +0.5
 *   - ARIA attribute (each):   +0.3
 *   - Partial text (contains): +0.6
 *   - Fuzzy text match:        +score * 0.4
 *   - Structural (parent/anc): +0.2
 *   - Style match:             +0.1
 *   - Total normalised to 0.0-1.0
 */

import type {
  QueryableElement,
  ElementQuery,
  QueryResult,
} from "./element-query";
import { matchesQuery } from "./element-query";
import { similarity } from "./fuzzy-match";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Individual score components. */
export interface ScoreBreakdown {
  /** Exact text match bonus. */
  exactText: number;
  /** Partial text match (textContains). */
  partialText: number;
  /** Fuzzy text match. */
  fuzzyText: number;
  /** Role matched. */
  roleMatch: number;
  /** ID matched. */
  idMatch: number;
  /** ARIA attributes matched. */
  ariaMatch: number;
  /** Semantic fields matched. */
  semanticMatch: number;
  /** Spatial criteria matched. */
  spatialMatch: number;
  /** Parent/ancestor matched. */
  structuralMatch: number;
}

/** A query result augmented with a composite score and breakdown. */
export interface RankedResult extends QueryResult {
  /** Composite match score (0.0-1.0). */
  score: number;
  /** Per-criterion score breakdown. */
  scores: ScoreBreakdown;
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/**
 * Compute a composite match score for a single element against a query.
 *
 * Only criteria present in the query contribute to the score. The raw
 * sum is normalised by the theoretical maximum for the given query so
 * that the result is always in [0.0, 1.0].
 *
 * @param el - The element to score.
 * @param query - The query to score against.
 * @returns A normalised score in [0.0, 1.0].
 */
export function computeMatchScore(
  el: QueryableElement,
  query: ElementQuery,
): number {
  const { score } = computeScoreBreakdown(el, query);
  return score;
}

/**
 * Compute the full score breakdown for an element against a query.
 *
 * Exported so the element-query module can attach a `ScoreBreakdown` to
 * every `RankedQueryResult` without re-implementing scoring.
 */
export function computeScoreBreakdown(
  el: QueryableElement,
  query: ElementQuery,
): { score: number; scores: ScoreBreakdown } {
  const state = el.getState();
  const text = state.textContent ?? el.element.textContent ?? "";

  const scores: ScoreBreakdown = {
    exactText: 0,
    partialText: 0,
    fuzzyText: 0,
    roleMatch: 0,
    idMatch: 0,
    ariaMatch: 0,
    semanticMatch: 0,
    spatialMatch: 0,
    structuralMatch: 0,
  };

  let rawScore = 0;
  let maxPossible = 0;

  // --- ID ---
  if (query.id !== undefined) {
    maxPossible += 0.9;
    if (typeof query.id === "string") {
      if (el.id === query.id) {
        scores.idMatch = 0.9;
        rawScore += 0.9;
      }
    } else {
      if (query.id.test(el.id)) {
        scores.idMatch = 0.9;
        rawScore += 0.9;
      }
    }
  }

  // --- Role ---
  if (query.role !== undefined) {
    maxPossible += 0.5;
    const elRole =
      el.element.getAttribute("role") ||
      inferRole(el.element.tagName, el.type);
    if (elRole === query.role) {
      scores.roleMatch = 0.5;
      rawScore += 0.5;
    }
  }

  // --- Tag name ---
  if (query.tagName !== undefined) {
    maxPossible += 0.4;
    if (el.element.tagName.toLowerCase() === query.tagName.toLowerCase()) {
      rawScore += 0.4;
    }
  }

  // --- Exact text ---
  if (query.text !== undefined) {
    maxPossible += 1.0;
    if (text.trim() === query.text.trim()) {
      scores.exactText = 1.0;
      rawScore += 1.0;
    }
  }

  // --- Partial text ---
  if (query.textContains !== undefined) {
    maxPossible += 0.6;
    if (text.toLowerCase().includes(query.textContains.toLowerCase())) {
      scores.partialText = 0.6;
      rawScore += 0.6;
    }
  }

  // --- Fuzzy text ---
  if (query.fuzzyText !== undefined) {
    maxPossible += 0.4;
    const sim = similarity(
      query.fuzzyText.toLowerCase(),
      text.toLowerCase(),
    );
    const contribution = sim * 0.4;
    scores.fuzzyText = contribution;
    rawScore += contribution;
  }

  // --- ARIA attributes ---
  const ariaChecks: Array<[string, unknown]> = [];
  if (query.ariaLabel !== undefined) ariaChecks.push(["aria-label", query.ariaLabel]);
  if (query.ariaSelected !== undefined) ariaChecks.push(["aria-selected", query.ariaSelected]);
  if (query.ariaExpanded !== undefined) ariaChecks.push(["aria-expanded", query.ariaExpanded]);
  if (query.ariaPressed !== undefined) ariaChecks.push(["aria-pressed", query.ariaPressed]);

  if (ariaChecks.length > 0) {
    const perAria = 0.3;
    maxPossible += ariaChecks.length * perAria;
    let ariaScore = 0;

    for (const [attr, expected] of ariaChecks) {
      const actual = el.element.getAttribute(attr);
      if (attr === "aria-label") {
        const label = actual ?? el.label ?? "";
        if (label.toLowerCase().includes((expected as string).toLowerCase())) {
          ariaScore += perAria;
        }
      } else if (typeof expected === "boolean") {
        if ((actual === "true") === expected) ariaScore += perAria;
      } else {
        // "mixed" check for aria-pressed
        if (actual === expected) ariaScore += perAria;
      }
    }

    scores.ariaMatch = ariaScore;
    rawScore += ariaScore;
  }

  // --- Semantic (purpose, semanticType, alias) ---
  const hasSemantic =
    query.purpose !== undefined ||
    query.semanticType !== undefined ||
    query.alias !== undefined;

  if (hasSemantic) {
    let semCount = 0;
    let semScore = 0;

    if (query.purpose !== undefined) {
      semCount++;
      const purpose = el.element.getAttribute("data-purpose") ?? "";
      if (purpose.toLowerCase() === query.purpose.toLowerCase()) semScore += 0.3;
    }
    if (query.semanticType !== undefined) {
      semCount++;
      const semType = el.element.getAttribute("data-semantic-type") ?? "";
      if (semType.toLowerCase() === query.semanticType.toLowerCase()) semScore += 0.3;
    }
    if (query.alias !== undefined) {
      semCount++;
      const aliases = (el.element.getAttribute("data-aliases") ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase());
      if (aliases.includes(query.alias.toLowerCase())) semScore += 0.3;
    }

    maxPossible += semCount * 0.3;
    scores.semanticMatch = semScore;
    rawScore += semScore;
  }

  // --- Structural ---
  if (query.parent !== undefined || query.ancestor !== undefined) {
    maxPossible += 0.2;

    let structMatch = false;
    if (query.parent) {
      const parentEl = el.element.parentElement;
      if (parentEl) {
        structMatch = matchesQueryOnRawElement(parentEl, query.parent);
      }
    }
    if (!structMatch && query.ancestor) {
      let current = el.element.parentElement;
      while (current) {
        if (matchesQueryOnRawElement(current, query.ancestor)) {
          structMatch = true;
          break;
        }
        current = current.parentElement;
      }
    }

    if (structMatch) {
      scores.structuralMatch = 0.2;
      rawScore += 0.2;
    }
  }

  // --- Style ---
  if (query.style && state.computedStyles) {
    maxPossible += 0.1;
    let allStylesMatch = true;

    for (const [prop, expected] of Object.entries(query.style)) {
      const actual = state.computedStyles[prop];
      if (actual === undefined) { allStylesMatch = false; break; }
      if (typeof expected === "string") {
        if (actual !== expected) { allStylesMatch = false; break; }
      } else {
        if (!expected.test(actual)) { allStylesMatch = false; break; }
      }
    }

    if (allStylesMatch) {
      rawScore += 0.1;
    }
  }

  // --- Spatial (within) ---
  if (query.within && state.rect) {
    maxPossible += 0.2;
    const r = state.rect;
    const w = query.within;
    if (
      r.x >= w.x && r.y >= w.y &&
      r.x + r.width <= w.x + w.width &&
      r.y + r.height <= w.y + w.height
    ) {
      scores.spatialMatch = 0.2;
      rawScore += 0.2;
    }
  }

  // Normalise
  const score = maxPossible > 0 ? Math.min(1.0, rawScore / maxPossible) : 0;

  return { score, scores };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank elements by how well they match a query. Higher score = better match.
 *
 * Only elements that pass the base `matchesQuery()` check are included
 * in the results. Results are sorted by descending score.
 *
 * @param elements - Elements to rank.
 * @param query - The query to rank against.
 * @param options - Optional configuration.
 * @returns Ranked results sorted by score (highest first).
 */
export function rankResults(
  elements: QueryableElement[],
  query: ElementQuery,
  options?: { fuzzyThreshold?: number },
): RankedResult[] {
  void options; // reserved for future fuzzy threshold tuning
  const ranked: RankedResult[] = [];

  for (const el of elements) {
    const { matches, reasons } = matchesQuery(el, query);
    if (!matches) continue;

    const { score, scores } = computeScoreBreakdown(el, query);

    ranked.push({
      id: el.id,
      label: el.label,
      type: el.type,
      matchReasons: reasons,
      score,
      scores,
    });
  }

  // Sort descending by score
  ranked.sort((a, b) => b.score - a.score);

  return ranked;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferRole(tagName: string, type: string): string {
  const tag = tagName.toLowerCase();
  if (tag === "button" || type === "button") return "button";
  if (tag === "a") return "link";
  if (tag === "input") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "img") return "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "nav") return "navigation";
  if (tag === "main") return "main";
  return type || tag;
}

function matchesQueryOnRawElement(
  el: HTMLElement,
  query: ElementQuery,
): boolean {
  if (query.tagName && el.tagName.toLowerCase() !== query.tagName.toLowerCase())
    return false;
  if (query.role) {
    const role = el.getAttribute("role") || inferRole(el.tagName, "");
    if (role !== query.role) return false;
  }
  if (query.text) {
    const text = el.textContent?.trim() ?? "";
    if (text !== query.text.trim()) return false;
  }
  return true;
}
