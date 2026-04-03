/**
 * Transition reliability tracking.
 *
 * Records success/failure outcomes and timing for each transition. Provides
 * adjusted pathfinding costs so the navigator prefers reliable paths.
 *
 * Cost adjustment formula:
 *   `baseCost * (1 + (1 - successRate) * 2)`
 *
 * - 100% reliable -> cost = baseCost * 1.0
 * - 50% reliable  -> cost = baseCost * 2.0
 * - 0% reliable   -> cost = baseCost * 3.0
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Record of transition execution reliability. */
export interface ReliabilityRecord {
  /** ID of the transition being tracked. */
  transitionId: string;
  /** Total number of successful executions. */
  successCount: number;
  /** Total number of failed executions. */
  failureCount: number;
  /** Cumulative duration of all executions (ms). */
  totalDurationMs: number;
  /** Outcome of the most recent execution. */
  lastResult: "success" | "failure";
  /** Epoch timestamp of the most recent execution. */
  lastExecutedAt: number;
}

// ---------------------------------------------------------------------------
// ReliabilityTracker
// ---------------------------------------------------------------------------

/**
 * Track transition reliability and provide adjusted pathfinding costs.
 *
 * Each transition is tracked independently. Records are keyed by transition
 * ID and accumulate over the lifetime of the tracker.
 */
export class ReliabilityTracker {
  private readonly records = new Map<string, ReliabilityRecord>();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Record a transition execution result.
   *
   * @param transitionId - ID of the transition that was executed.
   * @param success - Whether the execution succeeded.
   * @param durationMs - How long the execution took (ms).
   */
  record(transitionId: string, success: boolean, durationMs: number): void {
    const existing = this.records.get(transitionId);

    if (existing) {
      if (success) {
        existing.successCount++;
      } else {
        existing.failureCount++;
      }
      existing.totalDurationMs += durationMs;
      existing.lastResult = success ? "success" : "failure";
      existing.lastExecutedAt = Date.now();
    } else {
      this.records.set(transitionId, {
        transitionId,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        totalDurationMs: durationMs,
        lastResult: success ? "success" : "failure",
        lastExecutedAt: Date.now(),
      });
    }
  }

  /**
   * Get success rate for a transition (0.0-1.0).
   *
   * Returns 0.5 (neutral prior) if the transition has never been executed.
   */
  successRate(transitionId: string): number {
    const rec = this.records.get(transitionId);
    if (!rec) return 0.5;

    const total = rec.successCount + rec.failureCount;
    if (total === 0) return 0.5;

    return rec.successCount / total;
  }

  /**
   * Get adjusted cost for pathfinding.
   *
   * Formula: `baseCost * (1 + (1 - successRate) * 2)`
   *
   * @param transitionId - ID of the transition.
   * @param baseCost - The transition's base path cost.
   * @returns The adjusted cost.
   */
  adjustedCost(transitionId: string, baseCost: number): number {
    const rate = this.successRate(transitionId);
    return baseCost * (1 + (1 - rate) * 2);
  }

  /**
   * Get the average execution duration for a transition (ms).
   *
   * Returns 0 if the transition has never been executed.
   */
  averageDuration(transitionId: string): number {
    const rec = this.records.get(transitionId);
    if (!rec) return 0;

    const total = rec.successCount + rec.failureCount;
    if (total === 0) return 0;

    return rec.totalDurationMs / total;
  }

  /** Get all reliability records. */
  getAll(): ReliabilityRecord[] {
    return Array.from(this.records.values());
  }

  /** Get the record for a specific transition. */
  get(transitionId: string): ReliabilityRecord | undefined {
    return this.records.get(transitionId);
  }

  /** Reset all records. */
  clear(): void {
    this.records.clear();
  }

  /** Export all records as JSON-serialisable data. */
  toJSON(): ReliabilityRecord[] {
    return this.getAll();
  }

  /** Import records from JSON data. */
  static fromJSON(data: ReliabilityRecord[]): ReliabilityTracker {
    const tracker = new ReliabilityTracker();
    for (const record of data) {
      tracker.records.set(record.transitionId, { ...record });
    }
    return tracker;
  }
}
