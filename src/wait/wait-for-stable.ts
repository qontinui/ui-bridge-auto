/**
 * Wait for an element's property to stop changing (stabilize).
 *
 * Polls the property at a configurable interval (default 50 ms). Each time
 * the value changes the quiet-period clock resets. Resolves with the stable
 * value once it has remained unchanged for at least `quietPeriodMs`
 * (default 500 ms). Rejects with TimeoutError on timeout (default 10 000 ms).
 */

import type { QueryableElement } from '../core/element-query';
import { extractValue } from '../actions/data-operations';
import { TimeoutError } from './types';

export interface WaitForStableOptions {
  /** The element to monitor. */
  element: QueryableElement;
  /** Property name to watch. */
  property: string;
  /** How long the property must remain unchanged (ms, default 500). */
  quietPeriodMs?: number;
  /** Maximum wait time in ms (default 10000). */
  timeout?: number;
  /** Polling interval in ms (default 50). */
  interval?: number;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export async function waitForStable(options: WaitForStableOptions): Promise<unknown> {
  const {
    element,
    property,
    quietPeriodMs = 500,
    timeout = 10_000,
    interval = 50,
    signal,
  } = options;

  return new Promise<unknown>((resolve, reject) => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    // Track the last-seen value and the time it was last observed to change.
    let lastValue: unknown = extractValue(element, property);
    let lastChangeTime: number = Date.now();

    function cleanup(): void {
      stopped = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    }

    function valuesEqual(a: unknown, b: unknown): boolean {
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

        if (!valuesEqual(current, lastValue)) {
          // Value changed — reset the quiet-period clock.
          lastValue = current;
          lastChangeTime = Date.now();
        }

        if (Date.now() - lastChangeTime >= quietPeriodMs) {
          // Stable long enough — done.
          cleanup();
          resolve(lastValue);
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
        `waitForStable timed out after ${timeout}ms — property "${property}" did not stabilize`,
        timeout,
      ));
    }, timeout);

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError("waitForStable aborted", 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError("waitForStable aborted", 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Kick off the first poll.
    pollTimer = setTimeout(poll, interval);
  });
}
