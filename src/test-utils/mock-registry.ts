/**
 * Mock implementation of RegistryLike for testing.
 *
 * Supports adding/removing elements, emitting events, and subscribing
 * to events via `on()`.
 */

import type { QueryableElement, QueryableElementState } from "../core/element-query";
import type { RegistryLike } from "../state/state-detector";

export class MockRegistry implements RegistryLike {
  private elements = new Map<string, QueryableElement>();
  private listeners = new Map<string, Set<(event: { type: string; data: unknown }) => void>>();

  // ---------------------------------------------------------------------------
  // RegistryLike interface
  // ---------------------------------------------------------------------------

  getAllElements(): QueryableElement[] {
    return Array.from(this.elements.values());
  }

  on(
    type: string,
    listener: (event: { type: string; data: unknown }) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Test helpers
  // ---------------------------------------------------------------------------

  /**
   * Add an element to the registry and emit `element:registered`.
   */
  addElement(el: QueryableElement): void {
    this.elements.set(el.id, el);
    this.emitEvent("element:registered", { elementId: el.id });
  }

  /**
   * Remove an element and emit `element:unregistered`.
   */
  removeElement(id: string): void {
    this.elements.delete(id);
    this.emitEvent("element:unregistered", { elementId: id });
  }

  /**
   * Update an element's state by merging partial updates into the element's
   * getState() return value. Emits `element:stateChanged`.
   */
  updateElement(id: string, updates: Partial<QueryableElementState>): void {
    const el = this.elements.get(id);
    if (!el) return;

    const prevGetState = el.getState;
    el.getState = () => ({ ...prevGetState(), ...updates });
    this.emitEvent("element:stateChanged", { elementId: id });
  }

  /**
   * Emit an event to all subscribed listeners.
   */
  emitEvent(type: string, data?: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const payload = { type, data: data ?? null };
    for (const listener of set) {
      listener(payload);
    }
  }

  /**
   * Get a specific element by ID.
   */
  getElement(id: string): QueryableElement | undefined {
    return this.elements.get(id);
  }

  /**
   * Clear all elements and listeners.
   */
  reset(): void {
    this.elements.clear();
    this.listeners.clear();
  }

  /**
   * Return the number of listeners for a given event type.
   */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}
