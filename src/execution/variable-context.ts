/**
 * Variable scope management with nested scopes and interpolation.
 *
 * Supports pushing/popping variable scopes for loops and function-like
 * constructs, dotted path access, template interpolation, and simple
 * expression evaluation.
 */

import { interpolate as dataInterpolate, evaluateExpression } from '../actions/data-operations';

// ---------------------------------------------------------------------------
// VariableContext
// ---------------------------------------------------------------------------

/**
 * Manages layered variable scopes.
 *
 * Variables are resolved from the innermost scope outward. New scopes can
 * be pushed for loops or sub-workflows and popped when they complete.
 */
export class VariableContext {
  private scopes: Map<string, unknown>[];

  constructor(initial?: Record<string, unknown>) {
    const base = new Map<string, unknown>();
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        base.set(k, v);
      }
    }
    this.scopes = [base];
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  /**
   * Get a variable value. Searches from innermost to outermost scope.
   * Returns `undefined` if the variable is not found in any scope.
   */
  get(name: string): unknown {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return this.scopes[i].get(name);
      }
    }
    return undefined;
  }

  /**
   * Get with dotted path (e.g., "user.name").
   *
   * The first segment is resolved as a variable name across scopes,
   * and remaining segments traverse into the resulting object.
   */
  getPath(path: string): unknown {
    const parts = path.split('.');
    if (parts.length === 0) return undefined;

    let current: unknown = this.get(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[parts[i]];
    }
    return current;
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Set a variable in the current (innermost) scope.
   */
  set(name: string, value: unknown): void {
    this.scopes[this.scopes.length - 1].set(name, value);
  }

  // -------------------------------------------------------------------------
  // Scope management
  // -------------------------------------------------------------------------

  /**
   * Push a new scope (for loops, sub-workflows, etc.).
   * Optionally pre-populate with initial variables.
   */
  pushScope(initial?: Record<string, unknown>): void {
    const scope = new Map<string, unknown>();
    if (initial) {
      for (const [k, v] of Object.entries(initial)) {
        scope.set(k, v);
      }
    }
    this.scopes.push(scope);
  }

  /**
   * Pop the current scope.
   * @throws Error if only one scope remains (the root scope cannot be removed).
   */
  popScope(): void {
    if (this.scopes.length <= 1) {
      throw new Error('Cannot pop the root variable scope');
    }
    this.scopes.pop();
  }

  // -------------------------------------------------------------------------
  // Interpolation & evaluation
  // -------------------------------------------------------------------------

  /**
   * Interpolate `{{variables}}` in a string using the current scope chain.
   * Delegates to the data-operations `interpolate` function after building
   * a flat record from all scopes (innermost wins).
   */
  interpolate(template: string): string {
    return dataInterpolate(template, this.toRecord());
  }

  /**
   * Evaluate a simple condition expression against current variables.
   *
   * Supported formats:
   * - `"varName"` — truthy check
   * - `"varName == value"` — comparison via evaluateExpression
   * - `"varName != value"`, `"varName > value"`, etc.
   * - `"varName contains value"`, `"varName matches pattern"`
   */
  evaluate(expression: string): boolean {
    const trimmed = expression.trim();

    // Try to parse as "left operator right"
    const operators = ['!=', '==', '>=', '<=', '>', '<', 'contains', 'matches'] as const;
    for (const op of operators) {
      const idx = trimmed.indexOf(` ${op} `);
      if (idx !== -1) {
        const left = trimmed.slice(0, idx).trim();
        const right = trimmed.slice(idx + op.length + 2).trim();
        const actual = this.getPath(left);
        // Try to parse right side as a number or keep as string
        const expected = parseValueLiteral(right);
        return evaluateExpression(actual, op, expected);
      }
    }

    // Fall back to truthy check
    const value = this.getPath(trimmed);
    return Boolean(value);
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Get all variables as a flat record (innermost scope wins on conflicts).
   */
  toRecord(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    // Iterate from outermost to innermost so inner values overwrite outer.
    for (const scope of this.scopes) {
      for (const [k, v] of scope) {
        result[k] = v;
      }
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Get current scope depth. Root scope = 1.
   */
  get depth(): number {
    return this.scopes.length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a string literal into a typed value.
 * - Quoted strings -> string (without quotes)
 * - Numbers -> number
 * - "true"/"false" -> boolean
 * - Everything else -> string as-is
 */
function parseValueLiteral(raw: string): unknown {
  // Quoted string
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}
