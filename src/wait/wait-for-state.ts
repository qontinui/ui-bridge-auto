/**
 * Wait for a named state to become active.
 *
 * Subscribes to state-enter events from the StateDetector so it reacts
 * immediately rather than polling. Resolves instantly if the state is
 * already active. Rejects with TimeoutError on timeout (default 10 000 ms).
 */

import { TimeoutError, type StateDetector, type WaitOptions } from "./types";

export interface WaitForStateOptions extends WaitOptions {
  /** Identifier of the state to wait for. */
  stateId: string;
  /** The state detector instance to query / subscribe to. */
  detector: StateDetector;
}

export async function waitForState(options: WaitForStateOptions): Promise<void> {
  const { stateId, detector, timeout = 10_000, signal } = options;

  // Fast path: state already active.
  if (detector.isActive(stateId)) return;

  return new Promise<void>((resolve, reject) => {
    const cleanups: (() => void)[] = [];

    function cleanup(): void {
      for (const fn of cleanups) fn();
      cleanups.length = 0;
    }

    // Subscribe to the specific state-enter event.
    const unsub = detector.onStateEnter(stateId, () => {
      cleanup();
      resolve();
    });
    cleanups.push(unsub);

    // Timeout guard.
    const timer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError(
        `waitForState("${stateId}") timed out after ${timeout}ms`,
        timeout,
      ));
    }, timeout);
    cleanups.push(() => clearTimeout(timer));

    // External abort support.
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new TimeoutError(`waitForState("${stateId}") aborted`, 0));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new TimeoutError(`waitForState("${stateId}") aborted`, 0));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener("abort", onAbort));
    }
  });
}
