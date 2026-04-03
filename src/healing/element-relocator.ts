/**
 * Element relocation for self-healing automation.
 *
 * When an element moves, changes ID, or is replaced in the DOM, the
 * relocator attempts to find it using structural fingerprints, fuzzy
 * text matching, role+position heuristics, and ARIA labels.
 */

import type { QueryableElement, ElementQuery } from "../core/element-query";
import type { ElementFingerprint } from "../discovery/element-fingerprint";
import {
  computeFingerprint,
  fingerprintMatch,
} from "../discovery/element-fingerprint";
import { isFuzzyMatch } from "../core/fuzzy-match";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a findAlternative search. */
export interface AlternativeMatch {
  element: QueryableElement;
  confidence: number;
  matchType: "fingerprint" | "fuzzyText" | "role+position" | "ariaLabel";
}

// ---------------------------------------------------------------------------
// ElementRelocator
// ---------------------------------------------------------------------------

/**
 * Locates elements that have moved or changed identity in the DOM.
 *
 * Uses multiple strategies to find elements:
 * 1. Structural fingerprint matching (tag, role, text hash, ARIA label)
 * 2. Fuzzy text matching
 * 3. Role + position matching
 * 4. ARIA label matching
 */
export class ElementRelocator {
  constructor(
    private readonly registry: { getAllElements(): QueryableElement[] },
  ) {}

  /**
   * Find an element that matches a known fingerprint.
   *
   * Computes fingerprints for all registry elements and returns the first
   * one that matches via fingerprintMatch.
   */
  relocate(fingerprint: ElementFingerprint): QueryableElement | null {
    const elements = this.registry.getAllElements();

    for (const el of elements) {
      const fp = computeFingerprint(el.element);
      if (fingerprintMatch(fingerprint, fp)) {
        return el;
      }
    }

    return null;
  }

  /**
   * Find an element by its previous ID, falling back to fingerprint match.
   *
   * First checks if an element with the given ID still exists. If not,
   * and a fingerprint is provided, attempts fingerprint-based relocation.
   */
  relocateById(
    previousId: string,
    fingerprint?: ElementFingerprint,
  ): QueryableElement | null {
    const elements = this.registry.getAllElements();

    // Try direct ID match first
    const byId = elements.find((el) => el.id === previousId);
    if (byId) return byId;

    // Fall back to fingerprint
    if (fingerprint) {
      return this.relocate(fingerprint);
    }

    return null;
  }

  /**
   * Find the best alternative match for a query that returned no results.
   *
   * Tries multiple matching strategies in order of reliability:
   * 1. Fingerprint match (if query has enough structural info)
   * 2. ARIA label match
   * 3. Fuzzy text match
   * 4. Role + position match
   */
  findAlternative(query: ElementQuery): AlternativeMatch | null {
    const elements = this.registry.getAllElements();
    if (elements.length === 0) return null;

    // Strategy 1: ARIA label match
    if (query.ariaLabel) {
      for (const el of elements) {
        const ariaLabel = el.element.getAttribute("aria-label") ?? "";
        if (
          ariaLabel &&
          ariaLabel.toLowerCase() === query.ariaLabel!.toLowerCase()
        ) {
          return { element: el, confidence: 0.9, matchType: "ariaLabel" };
        }
      }
    }

    // Strategy 2: Fuzzy text match
    if (query.text || query.textContains || query.fuzzyText) {
      const searchText = query.text ?? query.textContains ?? query.fuzzyText ?? "";
      if (searchText) {
        let bestMatch: QueryableElement | null = null;
        let bestScore = 0;

        for (const el of elements) {
          const elText = el.getState().textContent ?? "";
          if (!elText) continue;

          if (isFuzzyMatch(searchText, elText, 0.6)) {
            // Rough confidence based on length similarity
            const lenRatio =
              Math.min(searchText.length, elText.length) /
              Math.max(searchText.length, elText.length);
            const score = 0.5 + lenRatio * 0.3;

            if (score > bestScore) {
              bestScore = score;
              bestMatch = el;
            }
          }
        }

        if (bestMatch) {
          return {
            element: bestMatch,
            confidence: bestScore,
            matchType: "fuzzyText",
          };
        }
      }
    }

    // Strategy 3: Role + position match
    if (query.role) {
      const roleCandidates = elements.filter((el) => {
        const role =
          el.element.getAttribute("role") ?? inferRoleFromTag(el.element);
        return role === query.role;
      });

      if (roleCandidates.length === 1) {
        return {
          element: roleCandidates[0],
          confidence: 0.7,
          matchType: "role+position",
        };
      }

      if (roleCandidates.length > 1) {
        // Return the first visible one with a lower confidence
        const visible = roleCandidates.find(
          (el) => el.getState().visible,
        );
        if (visible) {
          return {
            element: visible,
            confidence: 0.5,
            matchType: "role+position",
          };
        }
      }
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function inferRoleFromTag(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "input":
      return "textbox";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    default:
      return tag;
  }
}
