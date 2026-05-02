/**
 * Structural element query language for DOM-based automation.
 *
 * Unlike CSS selectors, these queries use semantic DOM properties that the
 * UI Bridge registry already extracts. Queries are resolved against the
 * in-memory registry — no DOM traversal needed.
 */

import { isFuzzyMatch } from "./fuzzy-match";
import type { ScoreBreakdown, RankedResult } from "./query-ranking";
import { rankResults, computeScoreBreakdown } from "./query-ranking";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElementQuery {
  // Identity
  id?: string | RegExp;
  role?: string;
  tagName?: string;

  // Content matching
  text?: string;
  textContains?: string;
  textPattern?: RegExp;

  // Accessibility
  ariaLabel?: string;
  ariaSelected?: boolean;
  ariaExpanded?: boolean;
  ariaPressed?: boolean | "mixed";

  // Data & HTML attributes
  attributes?: Record<string, string | RegExp | boolean>;

  // Element state
  visible?: boolean;
  enabled?: boolean;
  checked?: boolean;
  focused?: boolean;

  // Spatial (viewport coordinates)
  within?: { x: number; y: number; width: number; height: number };

  /**
   * Visibility-aware scoring (Section 8). When set, ranking penalises
   * candidates whose `visibilityRatio` (computed externally and threaded
   * through `el.getState().computedStyles?.["visibility-ratio"]` or via the
   * `state.value` carrier) falls short of `minRatio`. The boolean form
   * `true` is shorthand for `{ minRatio: 1.0 }`.
   *
   * NOTE: this is a SCORING criterion only. Use `visible` (boolean) to
   * FILTER. Visibility scoring keeps invisible elements in the result set
   * so consumers can surface them as ambiguities.
   */
  visibilityRatio?: boolean | { minRatio: number };

  // Structural (DOM tree — queries resolved recursively)
  parent?: ElementQuery;
  ancestor?: ElementQuery;
  hasChild?: ElementQuery;

  // Computed styles
  style?: Record<string, string | RegExp>;

  // Logical combinators
  and?: ElementQuery[];
  or?: ElementQuery[];
  not?: ElementQuery;

  // Fuzzy matching
  /** Fuzzy text match with configurable threshold. */
  fuzzyText?: string;
  /** Threshold for fuzzy matching (0.0-1.0, default 0.7). */
  fuzzyThreshold?: number;

  // Semantic
  /** Match element's purpose (data-purpose attribute). */
  purpose?: string;
  /** Match element's semanticType (data-semantic-type attribute). */
  semanticType?: string;
  /** Match any of element's aliases (data-aliases attribute). */
  alias?: string;

  // Spatial (relative to another element)
  /** Find elements near another element matched by a sub-query. */
  near?: { query: ElementQuery; maxDistance: number };

  // Index hint (for compiled queries)
  /** @internal Index key hint set by the query compiler. */
  _compiledIndex?: string;
}

export interface QueryResult {
  id: string;
  label: string | undefined;
  type: string;
  matchReasons: string[];
}

/**
 * A query result augmented with a confidence score breakdown.
 *
 * Returned by `executeQuery` so callers can surface match confidence and
 * choose between near-equal candidates. The `score` is the same per-criterion
 * `ScoreBreakdown` produced by `query-ranking`.
 */
export interface RankedQueryResult extends QueryResult {
  /** Per-criterion score breakdown produced by `computeScoreBreakdown`. */
  score: ScoreBreakdown;
}

/** Options for `findFirst` controlling ambiguity reporting. */
export interface FindFirstOptions {
  /**
   * Maximum number of near-miss candidates to include in `ambiguities`.
   * Defaults to 5.
   */
  maxAmbiguities?: number;

  /**
   * Minimum composite score (0.0-1.0) for a near-miss to be included in
   * `ambiguities`. Defaults to 0.5.
   */
  ambiguityThreshold?: number;
}

/**
 * Result of `findFirst`. Surfaces the chosen match alongside the score
 * breakdown that produced it and any near-miss ambiguities so callers
 * can decide whether the match was confident.
 */
export interface FindFirstResult {
  /** The chosen match, or `null` if no element matched the query. */
  match: QueryResult | null;
  /** Score breakdown for the chosen match (or `null` when there is none). */
  score: ScoreBreakdown | null;
  /**
   * Other matching candidates ranked by descending composite score that
   * passed `ambiguityThreshold`. Excludes the chosen match.
   */
  ambiguities: RankedResult[];
}

// ---------------------------------------------------------------------------
// Registry element shape (minimal interface to avoid hard dependency)
// ---------------------------------------------------------------------------

export interface QueryableElement {
  id: string;
  element: HTMLElement;
  type: string;
  label?: string;
  getState: () => QueryableElementState;
  getIdentifier?: () => { selector?: string; xpath?: string; htmlId?: string };
}

export interface QueryableElementState {
  visible?: boolean;
  enabled?: boolean;
  focused?: boolean;
  checked?: boolean;
  textContent?: string;
  value?: string | number | boolean;
  rect?: { x: number; y: number; width: number; height: number };
  computedStyles?: Record<string, string>;
  /**
   * Pre-computed visibility ratio in [0, 1] (Section 8). 1.0 = fully visible
   * inside the viewport with no occluders; 0 = fully off-screen or covered.
   * Populated by registry adapters that have already run
   * `computeVisibility`; absent on adapters that have not — `visibilityRatio`
   * scoring treats `undefined` as "no signal" (zero contribution).
   */
  visibilityRatio?: number;
}

// ---------------------------------------------------------------------------
// Query engine
// ---------------------------------------------------------------------------

export function matchesQuery(
  el: QueryableElement,
  query: ElementQuery,
): { matches: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const state = el.getState();

  // --- Identity ---
  if (query.id !== undefined) {
    if (typeof query.id === "string") {
      if (el.id !== query.id) return { matches: false, reasons };
    } else {
      if (!query.id.test(el.id)) return { matches: false, reasons };
    }
    reasons.push(`id=${el.id}`);
  }

  if (query.role !== undefined) {
    const elRole =
      el.element.getAttribute("role") || inferRole(el.element.tagName, el.type);
    if (elRole !== query.role) return { matches: false, reasons };
    reasons.push(`role=${elRole}`);
  }

  if (query.tagName !== undefined) {
    if (el.element.tagName.toLowerCase() !== query.tagName.toLowerCase())
      return { matches: false, reasons };
    reasons.push(`tag=${query.tagName}`);
  }

  // --- Content ---
  const text = state.textContent ?? el.element.textContent ?? "";

  if (query.text !== undefined) {
    if (text.trim() !== query.text.trim()) return { matches: false, reasons };
    reasons.push(`text="${query.text}"`);
  }

  if (query.textContains !== undefined) {
    if (!text.toLowerCase().includes(query.textContains.toLowerCase()))
      return { matches: false, reasons };
    reasons.push(`textContains="${query.textContains}"`);
  }

  if (query.textPattern !== undefined) {
    if (!query.textPattern.test(text)) return { matches: false, reasons };
    reasons.push(`textPattern=${query.textPattern}`);
  }

  // --- Accessibility ---
  if (query.ariaLabel !== undefined) {
    const ariaLabel = el.element.getAttribute("aria-label") ?? el.label ?? "";
    if (!ariaLabel.toLowerCase().includes(query.ariaLabel.toLowerCase()))
      return { matches: false, reasons };
    reasons.push(`ariaLabel="${ariaLabel}"`);
  }

  if (query.ariaSelected !== undefined) {
    const val = el.element.getAttribute("aria-selected") === "true";
    if (val !== query.ariaSelected) return { matches: false, reasons };
    reasons.push(`ariaSelected=${val}`);
  }

  if (query.ariaExpanded !== undefined) {
    const val = el.element.getAttribute("aria-expanded") === "true";
    if (val !== query.ariaExpanded) return { matches: false, reasons };
    reasons.push(`ariaExpanded=${val}`);
  }

  if (query.ariaPressed !== undefined) {
    const raw = el.element.getAttribute("aria-pressed");
    const val = raw === "mixed" ? "mixed" : raw === "true";
    if (val !== query.ariaPressed) return { matches: false, reasons };
    reasons.push(`ariaPressed=${val}`);
  }

  // --- Attributes ---
  if (query.attributes) {
    for (const [name, expected] of Object.entries(query.attributes)) {
      const actual = el.element.getAttribute(name);
      if (typeof expected === "boolean") {
        if (expected && actual === null) return { matches: false, reasons };
        if (!expected && actual !== null) return { matches: false, reasons };
      } else if (typeof expected === "string") {
        if (actual !== expected) return { matches: false, reasons };
      } else {
        if (actual === null || !expected.test(actual))
          return { matches: false, reasons };
      }
      reasons.push(`attr[${name}]`);
    }
  }

  // --- State ---
  if (query.visible !== undefined) {
    if (state.visible !== query.visible) return { matches: false, reasons };
    reasons.push(`visible=${state.visible}`);
  }

  if (query.enabled !== undefined) {
    if (state.enabled !== query.enabled) return { matches: false, reasons };
    reasons.push(`enabled=${state.enabled}`);
  }

  if (query.checked !== undefined) {
    if (state.checked !== query.checked) return { matches: false, reasons };
    reasons.push(`checked=${state.checked}`);
  }

  if (query.focused !== undefined) {
    if (state.focused !== query.focused) return { matches: false, reasons };
    reasons.push(`focused=${state.focused}`);
  }

  // --- Spatial ---
  if (query.within && state.rect) {
    const r = state.rect;
    const w = query.within;
    if (r.x < w.x || r.y < w.y || r.x + r.width > w.x + w.width || r.y + r.height > w.y + w.height)
      return { matches: false, reasons };
    reasons.push("within-bounds");
  }

  // --- Computed styles ---
  if (query.style && state.computedStyles) {
    for (const [prop, expected] of Object.entries(query.style)) {
      const actual = state.computedStyles[prop];
      if (actual === undefined) return { matches: false, reasons };
      if (typeof expected === "string") {
        if (actual !== expected) return { matches: false, reasons };
      } else {
        if (!expected.test(actual)) return { matches: false, reasons };
      }
      reasons.push(`style.${prop}`);
    }
  }

  // --- Fuzzy text ---
  if (query.fuzzyText !== undefined) {
    const threshold = query.fuzzyThreshold ?? 0.7;
    if (!isFuzzyMatch(query.fuzzyText.toLowerCase(), text.toLowerCase(), threshold))
      return { matches: false, reasons };
    reasons.push(`fuzzyText~"${query.fuzzyText}"`);
  }

  // --- Semantic: purpose ---
  if (query.purpose !== undefined) {
    const purpose = el.element.getAttribute("data-purpose") ?? el.element.dataset?.purpose ?? "";
    if (purpose.toLowerCase() !== query.purpose.toLowerCase())
      return { matches: false, reasons };
    reasons.push(`purpose="${purpose}"`);
  }

  // --- Semantic: semanticType ---
  if (query.semanticType !== undefined) {
    const semType = el.element.getAttribute("data-semantic-type") ?? el.element.dataset?.semanticType ?? "";
    if (semType.toLowerCase() !== query.semanticType.toLowerCase())
      return { matches: false, reasons };
    reasons.push(`semanticType="${semType}"`);
  }

  // --- Semantic: alias ---
  if (query.alias !== undefined) {
    const aliases = (el.element.getAttribute("data-aliases") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!aliases.includes(query.alias.toLowerCase()))
      return { matches: false, reasons };
    reasons.push(`alias="${query.alias}"`);
  }

  // --- Structural ---
  if (query.parent) {
    const parentEl = el.element.parentElement;
    if (!parentEl) return { matches: false, reasons };
    const parentMatch = matchesQueryOnRawElement(parentEl, query.parent);
    if (!parentMatch) return { matches: false, reasons };
    reasons.push("parent-match");
  }

  if (query.ancestor) {
    let current = el.element.parentElement;
    let found = false;
    while (current) {
      if (matchesQueryOnRawElement(current, query.ancestor)) {
        found = true;
        break;
      }
      current = current.parentElement;
    }
    if (!found) return { matches: false, reasons };
    reasons.push("ancestor-match");
  }

  if (query.hasChild) {
    const children = Array.from(el.element.children) as HTMLElement[];
    const hasMatch = children.some((child) =>
      matchesQueryOnRawElement(child, query.hasChild!),
    );
    if (!hasMatch) return { matches: false, reasons };
    reasons.push("has-child-match");
  }

  // --- Logical combinators ---
  if (query.not) {
    const negResult = matchesQuery(el, query.not);
    if (negResult.matches) return { matches: false, reasons };
    reasons.push("not-excluded");
  }

  if (query.and) {
    for (const sub of query.and) {
      const subResult = matchesQuery(el, sub);
      if (!subResult.matches) return { matches: false, reasons };
    }
    reasons.push("and-all-matched");
  }

  if (query.or) {
    const anyMatch = query.or.some((sub) => matchesQuery(el, sub).matches);
    if (!anyMatch) return { matches: false, reasons };
    reasons.push("or-one-matched");
  }

  return { matches: true, reasons };
}

/**
 * Execute a query against a collection of registered elements.
 *
 * Handles cross-element criteria (like `near`) that matchesQuery cannot
 * evaluate alone. Each result carries a `ScoreBreakdown` describing how
 * each criterion contributed, and the array is sorted by descending
 * composite score so callers can read the best match first.
 */
export function executeQuery(
  elements: QueryableElement[],
  query: ElementQuery,
): RankedQueryResult[] {
  // First pass: evaluate single-element criteria
  const candidates: Array<{ el: QueryableElement; reasons: string[] }> = [];
  for (const el of elements) {
    const { matches, reasons } = matchesQuery(el, query);
    if (matches) {
      candidates.push({ el, reasons });
    }
  }

  // Second pass: evaluate cross-element criteria (near)
  let results = candidates;
  if (query.near) {
    const refResults = executeQuery(elements, query.near.query);
    if (refResults.length === 0) {
      return []; // Reference element not found — no matches
    }
    const refEl = elements.find((e) => e.id === refResults[0].id);
    if (refEl) {
      const refState = refEl.getState();
      const refRect = refState.rect;
      if (refRect) {
        results = candidates.filter(({ el, reasons }) => {
          const elState = el.getState();
          const elRect = elState.rect;
          if (!elRect) return false;
          const dist = rectDistance(elRect, refRect);
          if (dist <= query.near!.maxDistance) {
            reasons.push(`near(${refResults[0].id}, ${Math.round(dist)}px)`);
            return true;
          }
          return false;
        });
      }
    }
  }

  // Augment each match with a ScoreBreakdown and sort by composite score.
  const ranked = results.map(({ el, reasons }) => {
    const { score, scores } = computeScoreBreakdown(el, query);
    return {
      id: el.id,
      label: el.label,
      type: el.type,
      matchReasons: reasons,
      score: scores,
      _composite: score,
    };
  });

  ranked.sort((a, b) => b._composite - a._composite);

  return ranked.map(({ _composite: _, ...rest }) => rest);
}

/** Edge-to-edge distance between two rects (0 if overlapping). */
function rectDistance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the first element matching the query.
 *
 * Returns a `FindFirstResult` containing the chosen match, the score
 * breakdown that produced it, and any near-miss ambiguities. Internally
 * delegates to `rankResults` so ambiguities come for free; the cross-element
 * `near` criterion routes through `executeQuery` to preserve its semantics.
 *
 * @param elements - Elements to search.
 * @param query - The query to match against.
 * @param options - Configuration for ambiguity reporting.
 */
export function findFirst(
  elements: QueryableElement[],
  query: ElementQuery,
  options?: FindFirstOptions,
): FindFirstResult {
  const maxAmbiguities = options?.maxAmbiguities ?? 5;
  const ambiguityThreshold = options?.ambiguityThreshold ?? 0.5;

  if (query.near) {
    // Cross-element criteria require the executeQuery path.
    const results = executeQuery(elements, query);
    if (results.length === 0) {
      return { match: null, score: null, ambiguities: [] };
    }
    const [chosen, ...rest] = results;
    const { match, score } = stripScore(chosen);
    const ambiguities = rest
      .map((r) => toRankedResult(r, query, elements))
      .filter((r): r is RankedResult => r !== null && r.score >= ambiguityThreshold)
      .slice(0, maxAmbiguities);
    return { match, score, ambiguities };
  }

  const ranked = rankResults(elements, query);
  if (ranked.length === 0) {
    return { match: null, score: null, ambiguities: [] };
  }

  const [chosen, ...rest] = ranked;
  const match: QueryResult = {
    id: chosen.id,
    label: chosen.label,
    type: chosen.type,
    matchReasons: chosen.matchReasons,
  };
  const ambiguities = rest
    .filter((r) => r.score >= ambiguityThreshold)
    .slice(0, maxAmbiguities);

  return { match, score: chosen.scores, ambiguities };
}

/** Strip the per-criterion score off a `RankedQueryResult` to a bare `QueryResult`. */
function stripScore(result: RankedQueryResult): {
  match: QueryResult;
  score: ScoreBreakdown;
} {
  const { score, ...rest } = result;
  return { match: rest, score };
}

/** Convert a `RankedQueryResult` (no composite) into a `RankedResult` (with composite). */
function toRankedResult(
  result: RankedQueryResult,
  query: ElementQuery,
  elements: QueryableElement[],
): RankedResult | null {
  const el = elements.find((e) => e.id === result.id);
  if (!el) return null;
  const { score } = computeScoreBreakdown(el, query);
  return {
    id: result.id,
    label: result.label,
    type: result.type,
    matchReasons: result.matchReasons,
    score,
    scores: result.score,
  };
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
  if (query.textContains) {
    const text = el.textContent?.toLowerCase() ?? "";
    if (!text.includes(query.textContains.toLowerCase())) return false;
  }
  if (query.ariaLabel) {
    const label = el.getAttribute("aria-label") ?? "";
    if (!label.toLowerCase().includes(query.ariaLabel.toLowerCase()))
      return false;
  }
  if (query.attributes) {
    for (const [name, expected] of Object.entries(query.attributes)) {
      const actual = el.getAttribute(name);
      if (typeof expected === "boolean") {
        if (expected && actual === null) return false;
        if (!expected && actual !== null) return false;
      } else if (typeof expected === "string") {
        if (actual !== expected) return false;
      } else {
        if (actual === null || !expected.test(actual)) return false;
      }
    }
  }
  return true;
}
