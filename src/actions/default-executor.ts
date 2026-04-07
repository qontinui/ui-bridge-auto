/**
 * Default DOM executor — concrete ActionExecutorLike implementation that
 * uses the dom-actions module for action execution and matchesQuery for
 * element resolution.
 *
 * This is the standard executor for applications using ui-bridge-auto
 * with a live DOM registry. Consumers create one instance and pass it
 * to AutomationEngine or ActionChain.
 */

import type { ActionExecutorLike } from "../state/transition-executor";
import type { ElementQuery } from "../core/element-query";
import { matchesQuery } from "../core/element-query";
import type { RegistryLike } from "../state/state-detector";
import { performAction } from "./dom-actions";

// ---------------------------------------------------------------------------
// DefaultDOMExecutor
// ---------------------------------------------------------------------------

export class DefaultDOMExecutor implements ActionExecutorLike {
  private readonly registry: RegistryLike;

  constructor(registry: RegistryLike) {
    this.registry = registry;
  }

  /**
   * Find an element matching an ElementQuery in the live registry.
   *
   * For attribute-based queries (the static builder's primary format),
   * also falls back to document.querySelector with CSS attribute selectors.
   */
  findElement(query: ElementQuery): { id: string } | null {
    // 1. Try matching against registry elements
    const elements = this.registry.getAllElements();
    for (const el of elements) {
      if (matchesQuery(el, query).matches) {
        return { id: el.id };
      }
    }

    // 2. Fallback: attribute-based CSS selector (static builder format)
    const attrs = query.attributes as Record<string, string> | undefined;
    if (attrs && typeof attrs === "object" && typeof document !== "undefined") {
      const selector = Object.entries(attrs)
        .map(([k, v]) => `[${k}="${CSS.escape(String(v))}"]`)
        .join("");
      const el = document.querySelector<HTMLElement>(selector);
      if (el?.isConnected) {
        // Check if element is in the registry under a different query
        for (const regEl of elements) {
          if (regEl.element === el) return { id: regEl.id };
        }
        // Not in registry — use selector as temporary ID
        return { id: `dom:${selector}` };
      }
    }

    // 3. Fallback: tagName + text match via DOM scan
    if (query.tagName && query.text && typeof document !== "undefined") {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(query.tagName));
      for (const el of candidates) {
        if (el.textContent?.trim() === query.text && el.isConnected) {
          for (const regEl of elements) {
            if (regEl.element === el) return { id: regEl.id };
          }
          return { id: `dom:${query.tagName}:${query.text}` };
        }
      }
    }

    return null;
  }

  /**
   * Find all elements matching a query.
   */
  findAllElements(query: ElementQuery): { id: string }[] {
    const results: { id: string }[] = [];
    for (const el of this.registry.getAllElements()) {
      if (matchesQuery(el, query).matches) {
        results.push({ id: el.id });
      }
    }
    return results;
  }

  /**
   * Batch-find multiple elements at once. Single pass over registry elements
   * checks all queries simultaneously, then falls back to DOM queries for
   * any unmatched attribute-based queries.
   */
  findElements(queries: ElementQuery[]): Map<string, { id: string } | null> {
    const results = new Map<string, { id: string } | null>();
    const keys = queries.map((q) => JSON.stringify(q));
    const elements = this.registry.getAllElements();

    // Single pass: check each registry element against all unresolved queries
    const unresolved = new Set(keys.map((_, i) => i));
    for (const el of elements) {
      for (const idx of unresolved) {
        if (matchesQuery(el, queries[idx]).matches) {
          results.set(keys[idx], { id: el.id });
          unresolved.delete(idx);
        }
      }
      if (unresolved.size === 0) break;
    }

    // Fallback: attribute-based CSS selectors for unmatched queries
    if (typeof document !== "undefined") {
      for (const idx of unresolved) {
        const query = queries[idx];
        const key = keys[idx];
        const found = this.findElement(query);
        results.set(key, found);
      }
    } else {
      for (const idx of unresolved) {
        results.set(keys[idx], null);
      }
    }

    return results;
  }

  /**
   * Get element bounding rect.
   */
  getElementRect(id: string): { x: number; y: number; width: number; height: number } | null {
    const el = this.resolveHTMLElement(id);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  /**
   * Execute an action on an element by ID.
   */
  async executeAction(
    elementId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    const el = this.resolveHTMLElement(elementId);
    if (!el || !el.isConnected) {
      throw new Error(`Element not found or disconnected: ${elementId}`);
    }
    await performAction(el, action, params);
  }

  /**
   * Wait for the UI to settle after an action.
   * Uses a brief delay as a pragmatic default; consumers can override
   * with registry-event-based idle detection.
   */
  async waitForIdle(timeout = 5000): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, Math.min(timeout, 300)));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private resolveHTMLElement(id: string): HTMLElement | null {
    // Temporary DOM selector IDs (from findElement fallback)
    if (id.startsWith("dom:")) {
      const rest = id.slice(4);
      // Could be a CSS selector or tagName:text
      if (rest.startsWith("[")) {
        return document.querySelector<HTMLElement>(rest);
      }
      const colonIdx = rest.indexOf(":");
      if (colonIdx > 0) {
        const tag = rest.slice(0, colonIdx);
        const text = rest.slice(colonIdx + 1);
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(tag));
        for (const el of candidates) {
          if (el.textContent?.trim() === text) return el;
        }
      }
      return null;
    }

    // Registry lookup
    const elements = this.registry.getAllElements();
    for (const el of elements) {
      if (el.id === id) return el.element;
    }
    return null;
  }
}
