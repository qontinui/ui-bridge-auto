/**
 * Configurable success evaluation for workflow execution.
 *
 * Provides criteria types for determining whether a set of node results
 * constitutes a successful execution.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Strategy for evaluating success across node results. */
export type CriteriaType = 'all' | 'any' | 'percentage' | 'custom';

/**
 * Configuration for success evaluation.
 */
export interface SuccessCriteria {
  type: CriteriaType;
  /** For 'percentage': the minimum ratio of successful nodes (0.0-1.0). */
  threshold?: number;
  /** For 'custom': a function that receives all results and returns pass/fail. */
  predicate?: (results: NodeResult[]) => boolean;
}

/**
 * The result of a single node execution.
 */
export interface NodeResult {
  nodeId: string;
  success: boolean;
  durationMs: number;
  error?: string;
  values?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a set of results meets the success criteria.
 *
 * @returns An object with `passed` (boolean) and a human-readable `summary`.
 */
export function evaluateCriteria(
  criteria: SuccessCriteria,
  results: NodeResult[],
): { passed: boolean; summary: string } {
  if (results.length === 0) {
    return { passed: true, summary: 'No results to evaluate' };
  }

  const succeeded = results.filter((r) => r.success).length;
  const total = results.length;

  switch (criteria.type) {
    case 'all': {
      const passed = succeeded === total;
      return {
        passed,
        summary: passed
          ? `All ${total} nodes passed`
          : `${total - succeeded} of ${total} nodes failed`,
      };
    }

    case 'any': {
      const passed = succeeded > 0;
      return {
        passed,
        summary: passed
          ? `${succeeded} of ${total} nodes passed`
          : `No nodes passed out of ${total}`,
      };
    }

    case 'percentage': {
      const threshold = criteria.threshold ?? 1.0;
      const ratio = succeeded / total;
      const passed = ratio >= threshold;
      const pct = (ratio * 100).toFixed(1);
      const thresholdPct = (threshold * 100).toFixed(1);
      return {
        passed,
        summary: passed
          ? `${pct}% passed (threshold: ${thresholdPct}%)`
          : `${pct}% passed, below threshold of ${thresholdPct}%`,
      };
    }

    case 'custom': {
      if (!criteria.predicate) {
        return { passed: false, summary: 'Custom criteria has no predicate' };
      }
      const passed = criteria.predicate(results);
      return {
        passed,
        summary: passed
          ? 'Custom criteria passed'
          : 'Custom criteria failed',
      };
    }

    default:
      return { passed: false, summary: `Unknown criteria type: ${criteria.type}` };
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** All nodes must succeed. */
export function allMustPass(): SuccessCriteria {
  return { type: 'all' };
}

/** At least one node must succeed. */
export function anyMustPass(): SuccessCriteria {
  return { type: 'any' };
}

/**
 * A given percentage of nodes must succeed.
 * @param threshold - Ratio from 0.0 to 1.0.
 */
export function percentageMustPass(threshold: number): SuccessCriteria {
  return { type: 'percentage', threshold };
}
