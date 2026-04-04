/**
 * Wait for an element's property to change from its initial value.
 *
 * Snapshots the property on invocation, then polls at a configurable interval.
 * Resolves with the new value once it differs from the snapshot, or rejects
 * with TimeoutError on timeout (default 10 000 ms).
 */

import type { QueryableElement } from '../core/element-query';
import { extractValue } from '../actions/data-operations';
import { TimeoutError } from './types';

export interface WaitForChangeOptions {
  /** The element to monitor. */
  element: QueryableElement;
  /** Property name to watch (uses extractValue). */
  property: string;
  /** Maximum wait time in ms (default 10000). */
  timeout?: number;
  /** Polling interval in ms (default 100). */
  interval?: number;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export async function waitForChange(options: WaitForChangeOptions): Promise<unknown> {
  const { element, property, timeout = 10_000, interval = 100, signal } = options;

  // Snapshot the initial value.
  const initial = extractValue(element, property);

  return new Promise<unknown>((resolve, reject) => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      stopped = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    }

    function valuesEqual(a: unknown, b: unknown): boolean {
      // Handle the common cases: primitives and JSON-serialisable objects.
      if (a === b) return true;
      if (a == null || b == null) return false;
      if (typeof a !== typeof b) return false;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a) === JSON.stringify(b);
        } catch {
          return false;
        }
      }
      return false;
    }

    function poll(): void {
      if (stopped) return;
      try {
        const current = extractValue(element, property);
        if (stopped) return;
        if (!valuesEqual(current, initial)) {
          cleanup();
          resolve(current);
        } else {
          pollTimer = setTimeout(poll, interval);
        }
      } catch (err) {
        if (stopped) return;
        cleanup();
        reject(err);
      }
    }

    // Timeout guard.
    timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(
        `waitForChange timed out after ${timeout}ms — property "${property}" did not change`,
        timeout,
      ));
    }, timeout);

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError("waitForChange aborted", 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError("waitForChange aborted", 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Kick off the first poll.
    pollTimer = setTimeout(poll, interval);
  });
}
