/**
 * Route between workflow nodes based on action results.
 *
 * The ConnectionRouter evaluates connections from a given node and selects
 * the next node to execute based on conditions, priority, and the result
 * of the current node.
 */

import { VariableContext } from './variable-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A connection between two workflow nodes.
 */
export interface Connection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition?: ConnectionCondition;
  /** Higher priority connections are checked first (default 0). */
  priority?: number;
}

/**
 * Condition that determines when a connection should be taken.
 */
export interface ConnectionCondition {
  type: 'success' | 'failure' | 'value' | 'expression' | 'default';
  /** For 'value': which field to check in the result values. */
  field?: string;
  /** For 'value': comparison operator. */
  operator?: '==' | '!=' | '>' | '<' | 'contains' | 'matches';
  /** For 'value'/'expression': expected value to compare against. */
  expected?: unknown;
  /** For 'expression': expression string to evaluate. */
  expression?: string;
}

/**
 * The result of routing — identifies which node to go to next.
 */
export interface RouteResult {
  nextNodeId: string;
  connectionId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// ConnectionRouter
// ---------------------------------------------------------------------------

export class ConnectionRouter {
  /**
   * Find the next node given the current node's result.
   *
   * Routing priority:
   * 1. Explicit conditions (value/expression) — checked in priority order
   * 2. Success/failure conditions — checked in priority order
   * 3. Default connection — first one found (by priority)
   *
   * Returns null if no connection matches.
   */
  route(
    fromNodeId: string,
    connections: Connection[],
    result: { success: boolean; values?: Record<string, unknown> },
    variables?: VariableContext,
  ): RouteResult | null {
    // Filter to connections from this node and sort by priority descending
    const outgoing = connections
      .filter((c) => c.fromNodeId === fromNodeId)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (outgoing.length === 0) return null;

    // Phase 1: Explicit conditions (value / expression)
    for (const conn of outgoing) {
      if (!conn.condition) continue;
      const { type } = conn.condition;

      if (type === 'value') {
        const matched = this.evaluateValueCondition(conn.condition, result.values ?? {});
        if (matched) {
          return {
            nextNodeId: conn.toNodeId,
            connectionId: conn.id,
            reason: `value condition: ${conn.condition.field} ${conn.condition.operator} ${String(conn.condition.expected)}`,
          };
        }
      }

      if (type === 'expression') {
        const matched = this.evaluateExpressionCondition(conn.condition, variables);
        if (matched) {
          return {
            nextNodeId: conn.toNodeId,
            connectionId: conn.id,
            reason: `expression: ${conn.condition.expression}`,
          };
        }
      }
    }

    // Phase 2: Success/failure conditions
    for (const conn of outgoing) {
      if (!conn.condition) continue;
      const { type } = conn.condition;

      if (type === 'success' && result.success) {
        return {
          nextNodeId: conn.toNodeId,
          connectionId: conn.id,
          reason: 'success condition matched',
        };
      }

      if (type === 'failure' && !result.success) {
        return {
          nextNodeId: conn.toNodeId,
          connectionId: conn.id,
          reason: 'failure condition matched',
        };
      }
    }

    // Phase 3: Default connections
    for (const conn of outgoing) {
      if (conn.condition?.type === 'default') {
        return {
          nextNodeId: conn.toNodeId,
          connectionId: conn.id,
          reason: 'default connection',
        };
      }
    }

    // Phase 4: No-condition connections (implicit default)
    for (const conn of outgoing) {
      if (!conn.condition) {
        return {
          nextNodeId: conn.toNodeId,
          connectionId: conn.id,
          reason: 'unconditional connection',
        };
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private evaluateValueCondition(
    condition: ConnectionCondition,
    values: Record<string, unknown>,
  ): boolean {
    if (!condition.field || !condition.operator) return false;

    const actual = values[condition.field];
    const expected = condition.expected;

    switch (condition.operator) {
      case '==':
        return actual == expected; // eslint-disable-line eqeqeq
      case '!=':
        return actual != expected; // eslint-disable-line eqeqeq
      case '>':
        return Number(actual) > Number(expected);
      case '<':
        return Number(actual) < Number(expected);
      case 'contains':
        return String(actual).includes(String(expected));
      case 'matches': {
        try {
          return new RegExp(String(expected)).test(String(actual));
        } catch {
          return false;
        }
      }
      default:
        return false;
    }
  }

  private evaluateExpressionCondition(
    condition: ConnectionCondition,
    variables?: VariableContext,
  ): boolean {
    if (!condition.expression) return false;
    if (!variables) return false;
    return variables.evaluate(condition.expression);
  }
}
