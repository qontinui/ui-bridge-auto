/**
 * Mock ActionExecutorLike for testing action sequences and transitions.
 *
 * Records all executed actions and provides configurable element lookup.
 */

import type { ElementQuery } from "../core/element-query";
import type { ActionExecutorLike } from "../state/transition-executor";

export interface RecordedAction {
  elementId: string;
  action: string;
  params?: Record<string, unknown>;
}

export class MockActionExecutor implements ActionExecutorLike {
  /** All actions that have been executed, in order. */
  executedActions: RecordedAction[] = [];

  /** Map of query patterns to element IDs for findElement(). */
  private elementMap = new Map<string, string>();

  /** If set, executeAction will reject with this error. */
  private nextError: Error | null = null;

  /** Delay (ms) to simulate async action execution. */
  private actionDelay = 0;

  // ---------------------------------------------------------------------------
  // ActionExecutorLike interface
  // ---------------------------------------------------------------------------

  findElement(query: ElementQuery): { id: string } | null {
    // Try matching by id first
    if (query.id && typeof query.id === "string") {
      if (this.elementMap.has(query.id)) {
        return { id: this.elementMap.get(query.id)! };
      }
    }

    // Try matching by role
    if (query.role) {
      const key = `role:${query.role}`;
      if (this.elementMap.has(key)) {
        return { id: this.elementMap.get(key)! };
      }
    }

    // Try matching by text
    if (query.text) {
      const key = `text:${query.text}`;
      if (this.elementMap.has(key)) {
        return { id: this.elementMap.get(key)! };
      }
    }

    // Fallback: check for a wildcard mapping
    if (this.elementMap.has("*")) {
      return { id: this.elementMap.get("*")! };
    }

    return null;
  }

  async executeAction(
    elementId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<void> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      throw err;
    }

    this.executedActions.push({ elementId, action, params });

    if (this.actionDelay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.actionDelay));
    }
  }

  async waitForIdle(_timeout?: number): Promise<void> {
    // No-op in tests — immediately idle
  }

  findAllElements(query: ElementQuery): { id: string }[] {
    const results: { id: string }[] = [];

    // Check specific keys
    if (query.role) {
      const key = `role:${query.role}`;
      if (this.elementMap.has(key)) {
        results.push({ id: this.elementMap.get(key)! });
      }
    }
    if (query.text) {
      const key = `text:${query.text}`;
      if (this.elementMap.has(key)) {
        results.push({ id: this.elementMap.get(key)! });
      }
    }

    // If no specific matches, try wildcard
    if (results.length === 0 && this.elementMap.has("*")) {
      results.push({ id: this.elementMap.get("*")! });
    }

    return results;
  }

  /** Map of element ID to bounding rect for spatial assertions. */
  private rectMap = new Map<string, { x: number; y: number; width: number; height: number }>();

  getElementRect(id: string): { x: number; y: number; width: number; height: number } | null {
    return this.rectMap.get(id) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Register a query key → element ID mapping.
   * Key formats: exact ID string, "role:button", "text:Submit", or "*" for wildcard.
   */
  registerElement(queryKey: string, elementId: string): void {
    this.elementMap.set(queryKey, elementId);
  }

  /**
   * Make the next executeAction() call throw the given error.
   */
  setNextError(error: Error): void {
    this.nextError = error;
  }

  /**
   * Set a delay (ms) for executeAction() to simulate async operations.
   */
  setActionDelay(ms: number): void {
    this.actionDelay = ms;
  }

  /**
   * Register a bounding rect for an element ID (for spatial assertions).
   */
  registerRect(elementId: string, rect: { x: number; y: number; width: number; height: number }): void {
    this.rectMap.set(elementId, rect);
  }

  /**
   * Clear all recorded actions.
   */
  reset(): void {
    this.executedActions = [];
    this.elementMap.clear();
    this.rectMap.clear();
    this.nextError = null;
    this.actionDelay = 0;
  }
}
