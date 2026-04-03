/**
 * Wait for an element matching an ElementQuery to appear in the registry.
 *
 * Event-driven: subscribes to 'element:registered' and 'element:stateChanged'
 * so it reacts immediately when the element appears rather than polling.
 * Resolves immediately if a matching element already exists.
 * Rejects with TimeoutError after the configured timeout (default 10 000 ms).
 */

import { ElementQuery, QueryResult, findFirst } from "../core/element-query";
import type { QueryableElement } from "../core/element-query";
import { TimeoutError, type Registry, type WaitOptions } from "./types";

export interface WaitForElementOptions extends WaitOptions {
  /** Element query to match against registered elements. */
  query: ElementQuery;
  /** The bridge registry to watch. */
  registry: Registry;
}

export async function waitForElement(options: WaitForElementOptions): Promise<QueryResult> {
  const { query, registry, timeout = 10_000, signal } = options;

  // Fast path: element already present.
  const existing = findFirst(
    registry.getAllElements() as QueryableElement[],
    query,
  );
  if (existing) return existing;

  return new Promise<QueryResult>((resolve, reject) => {
    const cleanups: (() => void)[] = [];

    function cleanup(): void {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    }

    function check(): void {
      const result = findFirst(
        registry.getAllElements() as QueryableElement[],
        query,
      );
      if (result) {
        cleanup();
        resolve(result);
      }
    }

    // Subscribe to relevant registry events.
    cleanups.push(registry.on("element:registered", check));
    cleanups.push(registry.on("element:stateChanged", check));

    // Timeout guard.
    const timer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(
        `waitForElement timed out after ${timeout}ms`,
        timeout,
      ));
    }, timeout);
    cleanups.push(() => clearTimeout(timer));

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError("waitForElement aborted", 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError("waitForElement aborted", 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  });
}
