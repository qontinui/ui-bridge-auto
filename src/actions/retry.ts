/**
 * Configurable retry with multiple backoff strategies.
 *
 * Provides a generic retry wrapper that can be used around any async
 * operation. Supports exponential, linear, and fixed backoff strategies,
 * maximum delay caps, and conditional retry filtering.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Backoff strategy for delay computation. */
export type BackoffStrategy = 'exponential' | 'linear' | 'fixed';

/** Configuration for retry behavior. */
export interface RetryOptions {
  /** Maximum number of attempts (default 3). Includes the initial attempt. */
  maxAttempts: number;
  /** Delay before the first retry in ms (default 500). */
  initialDelayMs: number;
  /** Maximum delay between retries in ms (default 10000). */
  maxDelayMs: number;
  /** Multiplier applied to delay after each attempt (default 2.0, exponential only). */
  multiplier: number;
  /** Backoff strategy (default 'exponential'). */
  strategy?: BackoffStrategy;
  /** Linear increment per attempt in ms (default = initialDelayMs, linear only). */
  linearIncrementMs?: number;
  /** Optional predicate to filter which errors should trigger a retry. */
  retryOn?: (error: Error) => boolean;
}

/** Minimal options accepted by computeDelay. */
export interface DelayOptions {
  /** Base delay in ms. */
  initialDelayMs: number;
  /** Multiplier applied per attempt (exponential only). */
  multiplier: number;
  /** Maximum delay in ms. */
  maxDelayMs: number;
  /** Backoff strategy (default 'exponential'). */
  strategy?: BackoffStrategy;
  /** Linear increment per attempt in ms (default = initialDelayMs, linear only). */
  linearIncrementMs?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Create default retry options with sensible values.
 */
export function createDefaultRetryOptions(): RetryOptions {
  return {
    maxAttempts: 3,
    initialDelayMs: 500,
    maxDelayMs: 10_000,
    multiplier: 2.0,
  };
}

// ---------------------------------------------------------------------------
// Delay computation
// ---------------------------------------------------------------------------

/**
 * Compute the delay for a given attempt using the configured backoff strategy.
 *
 * - **exponential** (default): `initialDelayMs * multiplier^attempt`, capped at `maxDelayMs`.
 * - **linear**: `initialDelayMs + attempt * linearIncrementMs`, capped at `maxDelayMs`.
 * - **fixed**: always `initialDelayMs`.
 *
 * @param attempt - Zero-based retry attempt index (0 = first retry).
 * @param options - Delay configuration.
 * @returns Delay in milliseconds.
 */
export function computeDelay(attempt: number, options: DelayOptions): number {
  const strategy = options.strategy ?? 'exponential';

  switch (strategy) {
    case 'fixed':
      return options.initialDelayMs;

    case 'linear': {
      const increment = options.linearIncrementMs ?? options.initialDelayMs;
      const delay = options.initialDelayMs + attempt * increment;
      return Math.min(Math.round(delay), options.maxDelayMs);
    }

    case 'exponential':
    default: {
      const base = options.initialDelayMs * Math.pow(options.multiplier, attempt);
      return Math.min(Math.round(base), options.maxDelayMs);
    }
  }
}

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

/**
 * Execute an async function with automatic retry on failure.
 *
 * Retries with exponential backoff when the function throws. If `retryOn`
 * is provided, only retries when the predicate returns true for the error.
 *
 * @param fn - The async function to execute.
 * @param options - Retry configuration (partial; merged with defaults).
 * @returns The result of the function on success.
 * @throws The last error if all attempts are exhausted.
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetchData(url),
 *   { maxAttempts: 5, initialDelayMs: 1000 },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
): Promise<T> {
  const opts: RetryOptions = { ...createDefaultRetryOptions(), ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Check if we should retry this error.
      if (opts.retryOn && !opts.retryOn(lastError)) {
        throw lastError;
      }

      // If this was the last attempt, throw immediately.
      if (attempt >= opts.maxAttempts - 1) {
        break;
      }

      // Wait before retrying.
      const delay = computeDelay(attempt, opts);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
