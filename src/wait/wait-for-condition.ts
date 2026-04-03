/**
 * Generic polling wait for arbitrary boolean conditions.
 *
 * Polls at a configurable interval (default 100 ms). Resolves when the
 * condition function returns true, rejects with TimeoutError on timeout
 * (default 10 000 ms).
 */

import { TimeoutError, type WaitOptions } from "./types";

export interface WaitForConditionOptions extends WaitOptions {
  /** The predicate to poll. May return a promise for async checks. */
  condition: () => boolean | Promise<boolean>;
  /** Polling interval in ms. Default 100. */
  interval?: number;
}

export async function waitForCondition(options: WaitForConditionOptions): Promise<void> {
  const { condition, timeout = 10_000, interval = 100, signal } = options;

  // Fast path: already satisfied.
  if (await condition()) return;

  return new Promise<void>((resolve, reject) => {
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      stopped = true;
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    }

    async function poll(): Promise<void> {
      if (stopped) return;
      try {
        const result = await condition();
        if (stopped) return;
        if (result) {
          cleanup();
          resolve();
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
        `waitForCondition timed out after ${timeout}ms`,
        timeout,
      ));
    }, timeout);

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError("waitForCondition aborted", 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError("waitForCondition aborted", 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // Kick off the first poll.
    pollTimer = setTimeout(poll, interval);
  });
}
