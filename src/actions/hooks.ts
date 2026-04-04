/**
 * Lifecycle hooks and circuit breaker for action chains.
 */

import type { ChainStep, ChainContext } from './action-chain';

/** Lifecycle hooks for chain execution. */
export interface ChainHooks {
  /** Called before each step executes. */
  beforeStep?: (step: ChainStep, ctx: ChainContext) => void | Promise<void>;
  /** Called after each step completes (with error if failed). */
  afterStep?: (step: ChainStep, ctx: ChainContext, error?: Error) => void | Promise<void>;
  /** Called when a step encounters an error. */
  onError?: (step: ChainStep, error: Error, ctx: ChainContext) => void | Promise<void>;
}

/** Configuration for the circuit breaker. */
export interface CircuitBreakerConfig {
  /** Consecutive failures to open the circuit (default 5). */
  threshold: number;
  /** Auto-reset after this duration in ms (default 30000). */
  resetAfterMs: number;
}

/**
 * Circuit breaker that tracks consecutive failures per key.
 * Opens (blocks actions) after `threshold` consecutive failures.
 * Auto-resets to closed after `resetAfterMs` since the circuit opened.
 */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly resetAfterMs: number;
  private readonly state = new Map<string, { failures: number; openedAt?: number }>();

  constructor(config: CircuitBreakerConfig) {
    this.threshold = config.threshold;
    this.resetAfterMs = config.resetAfterMs;
  }

  /** Check if the circuit is open (blocking) for the given key. */
  isOpen(key: string): boolean {
    const entry = this.state.get(key);
    if (!entry || entry.failures < this.threshold) return false;
    // Check if enough time has passed to reset
    if (entry.openedAt && Date.now() - entry.openedAt >= this.resetAfterMs) {
      this.state.delete(key);
      return false;
    }
    return true;
  }

  /** Record a failure for the given key. */
  recordFailure(key: string): void {
    const entry = this.state.get(key) ?? { failures: 0 };
    entry.failures++;
    if (entry.failures >= this.threshold && !entry.openedAt) {
      entry.openedAt = Date.now();
    }
    this.state.set(key, entry);
  }

  /** Record a success, resetting the failure count for the given key. */
  recordSuccess(key: string): void {
    this.state.delete(key);
  }

  /** Manually reset the circuit for the given key. */
  reset(key: string): void {
    this.state.delete(key);
  }

  /** Reset all circuits. */
  resetAll(): void {
    this.state.clear();
  }
}
