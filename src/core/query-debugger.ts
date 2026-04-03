/**
 * Query debugging utilities.
 *
 * Explains why a query matched or did not match an element by evaluating
 * each criterion independently. When a query returns no results,
 * `diagnoseNoResults` finds the closest-matching elements and suggests
 * which criteria to relax.
 */

import type { QueryableElement, ElementQuery } from "./element-query";
import type { QueryExplanation, CriteriaResult } from "../types/match";
import { similarity } from "./fuzzy-match";

// ---------------------------------------------------------------------------
// Explain
// ---------------------------------------------------------------------------

/**
 * Explain why an element did or didn't match a query.
 *
 * Evaluates every criterion in the query independently and records
 * whether it passed or failed, along with the actual and expected values.
 *
 * @param el - The element to evaluate.
 * @param query - The query to evaluate against.
 * @returns A `QueryExplanation` with per-criterion results.
 */
export function explainQueryMatch(
  el: QueryableElement,
  query: ElementQuery,
): QueryExplanation {
  const criteriaResults: CriteriaResult[] = [];
  const state = el.getState();
  const text = state.textContent ?? el.element.textContent ?? "";

  // --- ID ---
  if (query.id !== undefined) {
    const expected = typeof query.id === "string" ? query.id : query.id.toString();
    const passed = typeof query.id === "string"
      ? el.id === query.id
      : query.id.test(el.id);
    criteriaResults.push({
      criterion: `id === '${expected}'`,
      matched: passed,
      expected,
      actual: el.id,
    });
  }

  // --- Role ---
  if (query.role !== undefined) {
    const elRole =
      el.element.getAttribute("role") ||
      inferRoleForDebug(el.element.tagName, el.type);
    criteriaResults.push({
      criterion: `role === '${query.role}'`,
      matched: elRole === query.role,
      expected: query.role,
      actual: elRole,
    });
  }

  // --- Tag name ---
  if (query.tagName !== undefined) {
    const actual = el.element.tagName.toLowerCase();
    criteriaResults.push({
      criterion: `tagName === '${query.tagName}'`,
      matched: actual === query.tagName.toLowerCase(),
      expected: query.tagName.toLowerCase(),
      actual,
    });
  }

  // --- Exact text ---
  if (query.text !== undefined) {
    criteriaResults.push({
      criterion: `text === '${query.text}'`,
      matched: text.trim() === query.text.trim(),
      expected: query.text,
      actual: text.trim(),
    });
  }

  // --- Text contains ---
  if (query.textContains !== undefined) {
    criteriaResults.push({
      criterion: `textContains '${query.textContains}'`,
      matched: text.toLowerCase().includes(query.textContains.toLowerCase()),
      expected: query.textContains,
      actual: text,
    });
  }

  // --- Text pattern ---
  if (query.textPattern !== undefined) {
    criteriaResults.push({
      criterion: `textPattern ${query.textPattern}`,
      matched: query.textPattern.test(text),
      expected: query.textPattern.toString(),
      actual: text,
    });
  }

  // --- Fuzzy text ---
  if (query.fuzzyText !== undefined) {
    const threshold = query.fuzzyThreshold ?? 0.7;
    const sim = similarity(query.fuzzyText.toLowerCase(), text.toLowerCase());
    criteriaResults.push({
      criterion: `fuzzyText ~ '${query.fuzzyText}' (threshold=${threshold})`,
      matched: sim >= threshold,
      expected: `>= ${threshold}`,
      actual: sim.toFixed(3),
    });
  }

  // --- ARIA label ---
  if (query.ariaLabel !== undefined) {
    const ariaLabel = el.element.getAttribute("aria-label") ?? el.label ?? "";
    criteriaResults.push({
      criterion: `ariaLabel contains '${query.ariaLabel}'`,
      matched: ariaLabel.toLowerCase().includes(query.ariaLabel.toLowerCase()),
      expected: query.ariaLabel,
      actual: ariaLabel,
    });
  }

  // --- ARIA selected ---
  if (query.ariaSelected !== undefined) {
    const val = el.element.getAttribute("aria-selected") === "true";
    criteriaResults.push({
      criterion: `ariaSelected === ${query.ariaSelected}`,
      matched: val === query.ariaSelected,
      expected: String(query.ariaSelected),
      actual: String(val),
    });
  }

  // --- ARIA expanded ---
  if (query.ariaExpanded !== undefined) {
    const val = el.element.getAttribute("aria-expanded") === "true";
    criteriaResults.push({
      criterion: `ariaExpanded === ${query.ariaExpanded}`,
      matched: val === query.ariaExpanded,
      expected: String(query.ariaExpanded),
      actual: String(val),
    });
  }

  // --- ARIA pressed ---
  if (query.ariaPressed !== undefined) {
    const raw = el.element.getAttribute("aria-pressed");
    const val = raw === "mixed" ? "mixed" : raw === "true";
    criteriaResults.push({
      criterion: `ariaPressed === ${query.ariaPressed}`,
      matched: val === query.ariaPressed,
      expected: String(query.ariaPressed),
      actual: String(val),
    });
  }

  // --- Visible ---
  if (query.visible !== undefined) {
    criteriaResults.push({
      criterion: `visible === ${query.visible}`,
      matched: state.visible === query.visible,
      expected: String(query.visible),
      actual: String(state.visible),
    });
  }

  // --- Enabled ---
  if (query.enabled !== undefined) {
    criteriaResults.push({
      criterion: `enabled === ${query.enabled}`,
      matched: state.enabled === query.enabled,
      expected: String(query.enabled),
      actual: String(state.enabled),
    });
  }

  // --- Checked ---
  if (query.checked !== undefined) {
    criteriaResults.push({
      criterion: `checked === ${query.checked}`,
      matched: state.checked === query.checked,
      expected: String(query.checked),
      actual: String(state.checked),
    });
  }

  // --- Focused ---
  if (query.focused !== undefined) {
    criteriaResults.push({
      criterion: `focused === ${query.focused}`,
      matched: state.focused === query.focused,
      expected: String(query.focused),
      actual: String(state.focused),
    });
  }

  // --- Purpose ---
  if (query.purpose !== undefined) {
    const actual = el.element.getAttribute("data-purpose") ?? "";
    criteriaResults.push({
      criterion: `purpose === '${query.purpose}'`,
      matched: actual.toLowerCase() === query.purpose.toLowerCase(),
      expected: query.purpose,
      actual: actual || "(not set)",
    });
  }

  // --- Semantic type ---
  if (query.semanticType !== undefined) {
    const actual = el.element.getAttribute("data-semantic-type") ?? "";
    criteriaResults.push({
      criterion: `semanticType === '${query.semanticType}'`,
      matched: actual.toLowerCase() === query.semanticType.toLowerCase(),
      expected: query.semanticType,
      actual: actual || "(not set)",
    });
  }

  // --- Alias ---
  if (query.alias !== undefined) {
    const aliases = (el.element.getAttribute("data-aliases") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const matched = aliases.includes(query.alias.toLowerCase());
    criteriaResults.push({
      criterion: `alias includes '${query.alias}'`,
      matched,
      expected: query.alias,
      actual: aliases.length > 0 ? aliases.join(", ") : "(no aliases)",
    });
  }

  const allMatched = criteriaResults.length > 0
    ? criteriaResults.every((c) => c.matched)
    : true;

  return {
    elementId: el.id,
    elementLabel: el.label ?? "",
    matched: allMatched,
    criteriaResults,
  };
}

// ---------------------------------------------------------------------------
// Diagnose no results
// ---------------------------------------------------------------------------

/**
 * Diagnose why a query returned no results against a set of elements.
 *
 * Evaluates the query against every element, ranks them by how many
 * criteria they satisfied, and returns the closest matches along with
 * a human-readable suggestion for fixing the query.
 *
 * @param elements - The elements that were searched.
 * @param query - The query that returned no results.
 * @returns Diagnostic information including closest matches and suggestions.
 */
export function diagnoseNoResults(
  elements: QueryableElement[],
  query: ElementQuery,
): {
  totalElements: number;
  closestMatches: Array<{
    elementId: string;
    label: string;
    matchedCriteria: number;
    totalCriteria: number;
    failedOn: string;
  }>;
  suggestion: string;
} {
  if (elements.length === 0) {
    return {
      totalElements: 0,
      closestMatches: [],
      suggestion: "No elements in the registry. Wait for elements to be registered.",
    };
  }

  const scored: Array<{
    elementId: string;
    label: string;
    matchedCriteria: number;
    totalCriteria: number;
    failedOn: string;
    failedCriteria: string[];
  }> = [];

  for (const el of elements) {
    const explanation = explainQueryMatch(el, query);
    const total = explanation.criteriaResults.length;
    const matched = explanation.criteriaResults.filter((c) => c.matched).length;
    const failed = explanation.criteriaResults
      .filter((c) => !c.matched)
      .map((c) => c.criterion);

    scored.push({
      elementId: el.id,
      label: el.label ?? "",
      matchedCriteria: matched,
      totalCriteria: total,
      failedOn: failed[0] ?? "",
      failedCriteria: failed,
    });
  }

  // Sort by most criteria matched (descending)
  scored.sort((a, b) => {
    const aRatio = a.totalCriteria > 0 ? a.matchedCriteria / a.totalCriteria : 0;
    const bRatio = b.totalCriteria > 0 ? b.matchedCriteria / b.totalCriteria : 0;
    return bRatio - aRatio;
  });

  const closestMatches = scored.slice(0, 5).map((s) => ({
    elementId: s.elementId,
    label: s.label,
    matchedCriteria: s.matchedCriteria,
    totalCriteria: s.totalCriteria,
    failedOn: s.failedOn,
  }));

  // Find the most commonly failed criterion across all elements
  const failureCounts = new Map<string, number>();
  for (const s of scored) {
    for (const fc of s.failedCriteria) {
      failureCounts.set(fc, (failureCounts.get(fc) || 0) + 1);
    }
  }

  let suggestion = "No elements matched the query.";
  if (failureCounts.size > 0) {
    const sortedFailures = Array.from(failureCounts.entries())
      .sort((a, b) => b[1] - a[1]);
    const [mostFailed, count] = sortedFailures[0]!;
    const pct = Math.round((count / elements.length) * 100);

    suggestion = `The criterion ${mostFailed} failed on ${pct}% of elements (${count}/${elements.length}).`;

    if (scored[0] && scored[0].matchedCriteria > 0) {
      const best = scored[0];
      suggestion += ` Closest match: "${best.label || best.elementId}" (${best.matchedCriteria}/${best.totalCriteria} criteria matched).`;
      if (best.failedOn) {
        suggestion += ` Try relaxing the "${best.failedOn}" criterion.`;
      }
    }
  }

  return {
    totalElements: elements.length,
    closestMatches,
    suggestion,
  };
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format a QueryExplanation as a human-readable multi-line string.
 *
 * @param explanation - The explanation to format.
 * @returns A formatted string suitable for logging or display.
 */
export function formatExplanation(explanation: QueryExplanation): string {
  const lines: string[] = [];
  const status = explanation.matched ? "MATCHED" : "NOT MATCHED";
  const label = explanation.elementLabel
    ? ` "${explanation.elementLabel}"`
    : "";

  lines.push(`Element ${explanation.elementId}${label}: ${status}`);

  for (const c of explanation.criteriaResults) {
    const icon = c.matched ? "PASS" : "FAIL";
    const actualStr = c.actual !== undefined ? ` actual="${c.actual}"` : "";
    const expectedStr = c.expected !== undefined ? ` expected="${c.expected}"` : "";
    lines.push(`  [${icon}] ${c.criterion}:${expectedStr}${actualStr}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferRoleForDebug(tagName: string, type: string): string {
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
