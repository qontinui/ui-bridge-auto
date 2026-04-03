/**
 * Wait for the UI to settle (no pending network requests, DOM mutations
 * stopped, no loading indicators).
 *
 * When an IdleDetector is provided, delegates entirely to it.
 * Otherwise falls back to a simple heuristic: subscribe to registry change
 * events and resolve once no events fire for a quiet period.
 */

import { TimeoutError, type IdleDetector, type Registry, type WaitOptions } from "./types";

export interface WaitForIdleOptions extends WaitOptions {
  /** Optional idle detector. When omitted the registry fallback is used. */
  detector?: IdleDetector;
  /** Registry used by the fallback heuristic. Required when detector is omitted. */
  registry?: Registry;
  /**
   * Quiet period (ms) for the registry fallback heuristic.
   * The UI is considered idle once no registry events fire for this duration.
   * Default 500 ms.
   */
  quietPeriod?: number;
  /** Optional signal names forwarded to IdleDetector.waitForIdle. */
  signals?: string[];
}

export async function waitForIdle(options: WaitForIdleOptions): Promise<void> {
  const { detector, registry, timeout = 10_000, quietPeriod = 500, signal, signals } = options;

  // --- Delegate path ---
  if (detector) {
    if (detector.isIdle()) return;

    const result = detector.waitForIdle({ timeout, signals });

    // Wrap with abort support if a signal was provided.
    if (signal) {
      return raceWithAbort(result, signal, "waitForIdle aborted");
    }
    return result;
  }

  // --- Registry fallback path ---
  if (!registry) {
    throw new Error(
      "waitForIdle requires either an IdleDetector or a Registry",
    );
  }

  return new Promise<void>((resolve, reject) => {
    const cleanups: (() => void)[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    }

    function resetQuiet(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, quietPeriod);
    }

    // Any registry activity resets the quiet timer.
    cleanups.push(registry.on("element:registered", resetQuiet));
    cleanups.push(registry.on("element:unregistered", resetQuiet));
    cleanups.push(registry.on("element:stateChanged", resetQuiet));
    cleanups.push(registry.on("dom:settled", resetQuiet));
    cleanups.push(registry.on("network:idle", resetQuiet));

    // Start the first quiet window immediately.
    resetQuiet();

    // Timeout guard.
    const timer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(
        `waitForIdle timed out after ${timeout}ms`,
        timeout,
      ));
    }, timeout);
    cleanups.push(() => clearTimeout(timer));

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError("waitForIdle aborted", 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError("waitForIdle aborted", 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function raceWithAbort(
  promise: Promise<void>,
  signal: AbortSignal,
  message: string,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new TimeoutError(message, 0));
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(new TimeoutError(message, 0));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}
