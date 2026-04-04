/**
 * Extended data operations for string manipulation, math, and collections.
 *
 * Pure functions that operate on values extracted from elements or stored
 * in chain variables. Used by the 'transform' and 'compute' chain steps.
 */

// ---------------------------------------------------------------------------
// String operations
// ---------------------------------------------------------------------------

/** Supported string operation names. */
export type StringOp =
  | 'concat'
  | 'split'
  | 'replace'
  | 'toUpperCase'
  | 'toLowerCase'
  | 'trim'
  | 'substring'
  | 'startsWith'
  | 'endsWith'
  | 'includes'
  | 'length'
  | 'padStart'
  | 'padEnd';

/**
 * Apply a string operation to a value.
 *
 * @param value - The string to operate on.
 * @param op - The operation name.
 * @param args - Operation-specific arguments.
 * @returns The result of the operation.
 */
export function stringOp(
  value: string,
  op: StringOp,
  ...args: unknown[]
): string | string[] | boolean | number {
  switch (op) {
    case 'concat':
      return value + String(args[0] ?? '');
    case 'split':
      return value.split(String(args[0] ?? ','));
    case 'replace':
      return value.replace(String(args[0] ?? ''), String(args[1] ?? ''));
    case 'toUpperCase':
      return value.toUpperCase();
    case 'toLowerCase':
      return value.toLowerCase();
    case 'trim':
      return value.trim();
    case 'substring':
      return value.substring(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined);
    case 'startsWith':
      return value.startsWith(String(args[0] ?? ''));
    case 'endsWith':
      return value.endsWith(String(args[0] ?? ''));
    case 'includes':
      return value.includes(String(args[0] ?? ''));
    case 'length':
      return value.length;
    case 'padStart':
      return value.padStart(Number(args[0] ?? 0), String(args[1] ?? ' '));
    case 'padEnd':
      return value.padEnd(Number(args[0] ?? 0), String(args[1] ?? ' '));
    default:
      throw new Error(`Unknown string operation: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Math operations
// ---------------------------------------------------------------------------

/** Supported math operation names. */
export type MathOp =
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'mod'
  | 'min'
  | 'max'
  | 'sum'
  | 'avg'
  | 'round'
  | 'floor'
  | 'ceil'
  | 'abs';

/**
 * Apply a math operation to an array of numbers.
 *
 * Binary ops (add, subtract, multiply, divide, mod) use the first two values.
 * Aggregate ops (min, max, sum, avg) use all values.
 * Unary ops (round, floor, ceil, abs) use the first value.
 *
 * @param values - The numeric operands.
 * @param op - The operation name.
 * @returns The numeric result.
 */
export function mathOp(values: number[], op: MathOp): number {
  if (values.length === 0) {
    throw new Error(`mathOp "${op}" requires at least one value`);
  }

  switch (op) {
    case 'add':
      return (values[0] ?? 0) + (values[1] ?? 0);
    case 'subtract':
      return (values[0] ?? 0) - (values[1] ?? 0);
    case 'multiply':
      return (values[0] ?? 0) * (values[1] ?? 1);
    case 'divide': {
      const divisor = values[1] ?? 1;
      if (divisor === 0) throw new Error('Division by zero');
      return (values[0] ?? 0) / divisor;
    }
    case 'mod': {
      const modDivisor = values[1] ?? 1;
      if (modDivisor === 0) throw new Error('Modulo by zero');
      return (values[0] ?? 0) % modDivisor;
    }
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'round':
      return Math.round(values[0]);
    case 'floor':
      return Math.floor(values[0]);
    case 'ceil':
      return Math.ceil(values[0]);
    case 'abs':
      return Math.abs(values[0]);
    default:
      throw new Error(`Unknown math operation: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Collection operations
// ---------------------------------------------------------------------------

/** Supported collection operation names. */
export type CollectionOp =
  | 'filter'
  | 'map'
  | 'sort'
  | 'reduce'
  | 'find'
  | 'every'
  | 'some'
  | 'includes'
  | 'length'
  | 'first'
  | 'last'
  | 'slice'
  | 'flatten'
  | 'unique';

/**
 * Apply a collection operation to an array.
 *
 * Operations that need a callback (filter, map, find, every, some, reduce)
 * accept a property name as the first arg for simple property-based operations,
 * or a function for complex logic.
 *
 * @param array - The array to operate on.
 * @param op - The operation name.
 * @param args - Operation-specific arguments.
 * @returns The result of the operation.
 */
export function collectionOp(
  array: unknown[],
  op: CollectionOp,
  ...args: unknown[]
): unknown {
  switch (op) {
    case 'filter': {
      const key = String(args[0] ?? '');
      const expected = args[1];
      if (typeof args[0] === 'function') {
        return array.filter(args[0] as (item: unknown) => boolean);
      }
      return array.filter((item) => {
        if (item != null && typeof item === 'object') {
          return (item as Record<string, unknown>)[key] === expected;
        }
        return item === expected;
      });
    }
    case 'map': {
      const mapKey = String(args[0] ?? '');
      if (typeof args[0] === 'function') {
        return array.map(args[0] as (item: unknown) => unknown);
      }
      return array.map((item) => {
        if (item != null && typeof item === 'object') {
          return (item as Record<string, unknown>)[mapKey];
        }
        return item;
      });
    }
    case 'sort': {
      const sortKey = args[0] != null ? String(args[0]) : undefined;
      const direction = args[1] === 'desc' ? -1 : 1;
      return [...array].sort((a, b) => {
        const aVal = sortKey && a != null && typeof a === 'object'
          ? (a as Record<string, unknown>)[sortKey]
          : a;
        const bVal = sortKey && b != null && typeof b === 'object'
          ? (b as Record<string, unknown>)[sortKey]
          : b;
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return (aVal - bVal) * direction;
        }
        return String(aVal ?? '').localeCompare(String(bVal ?? '')) * direction;
      });
    }
    case 'reduce': {
      if (typeof args[0] === 'function') {
        return array.reduce(args[0] as (acc: unknown, item: unknown) => unknown, args[1]);
      }
      // Simple sum reduction when no function provided
      return array.reduce((acc: unknown, item) => {
        return (Number(acc) || 0) + (Number(item) || 0);
      }, args[0] ?? 0);
    }
    case 'find': {
      const findKey = String(args[0] ?? '');
      const findExpected = args[1];
      if (typeof args[0] === 'function') {
        return array.find(args[0] as (item: unknown) => boolean);
      }
      return array.find((item) => {
        if (item != null && typeof item === 'object') {
          return (item as Record<string, unknown>)[findKey] === findExpected;
        }
        return item === findExpected;
      });
    }
    case 'every': {
      const everyKey = String(args[0] ?? '');
      const everyExpected = args[1];
      if (typeof args[0] === 'function') {
        return array.every(args[0] as (item: unknown) => boolean);
      }
      return array.every((item) => {
        if (item != null && typeof item === 'object') {
          return (item as Record<string, unknown>)[everyKey] === everyExpected;
        }
        return item === everyExpected;
      });
    }
    case 'some': {
      const someKey = String(args[0] ?? '');
      const someExpected = args[1];
      if (typeof args[0] === 'function') {
        return array.some(args[0] as (item: unknown) => boolean);
      }
      return array.some((item) => {
        if (item != null && typeof item === 'object') {
          return (item as Record<string, unknown>)[someKey] === someExpected;
        }
        return item === someExpected;
      });
    }
    case 'includes':
      return array.includes(args[0]);
    case 'length':
      return array.length;
    case 'first':
      return array[0];
    case 'last':
      return array[array.length - 1];
    case 'slice':
      return array.slice(Number(args[0] ?? 0), args[1] != null ? Number(args[1]) : undefined);
    case 'flatten':
      return array.flat(Number(args[0] ?? 1));
    case 'unique':
      return [...new Set(array)];
    default:
      throw new Error(`Unknown collection operation: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Operation detection
// ---------------------------------------------------------------------------

const STRING_OPS = new Set<string>([
  'concat', 'split', 'replace', 'toUpperCase', 'toLowerCase', 'trim',
  'substring', 'startsWith', 'endsWith', 'includes', 'length', 'padStart', 'padEnd',
]);

const MATH_OPS = new Set<string>([
  'add', 'subtract', 'multiply', 'divide', 'mod', 'min', 'max',
  'sum', 'avg', 'round', 'floor', 'ceil', 'abs',
]);

const COLLECTION_OPS = new Set<string>([
  'filter', 'map', 'sort', 'reduce', 'find', 'every', 'some',
  'includes', 'length', 'first', 'last', 'slice', 'flatten', 'unique',
]);

/** Check if an operation name is a string operation. */
export function isStringOp(op: string): op is StringOp {
  return STRING_OPS.has(op);
}

/** Check if an operation name is a math operation. */
export function isMathOp(op: string): op is MathOp {
  return MATH_OPS.has(op);
}

/** Check if an operation name is a collection operation. */
export function isCollectionOp(op: string): op is CollectionOp {
  return COLLECTION_OPS.has(op);
}

/**
 * Apply a transform operation, auto-detecting the operation category
 * based on the value type and operation name.
 *
 * @param value - The value to transform.
 * @param operation - The operation name.
 * @param args - Operation-specific arguments.
 * @returns The transformed value.
 */
export function applyTransform(
  value: unknown,
  operation: string,
  args: unknown[],
): unknown {
  // String operations
  if (typeof value === 'string' && isStringOp(operation)) {
    return stringOp(value, operation, ...args);
  }

  // Math operations on a single number
  if (typeof value === 'number' && isMathOp(operation)) {
    return mathOp([value, ...(args.filter((a) => typeof a === 'number') as number[])], operation);
  }

  // Collection operations
  if (Array.isArray(value) && isCollectionOp(operation)) {
    return collectionOp(value, operation, ...args);
  }

  // Math operations on arrays of numbers
  if (Array.isArray(value) && isMathOp(operation)) {
    return mathOp(value.map(Number), operation);
  }

  throw new Error(
    `Cannot apply operation "${operation}" to value of type ${typeof value}${Array.isArray(value) ? ' (array)' : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Compute expression parser
// ---------------------------------------------------------------------------

const COMPUTE_OPS: Record<string, MathOp> = {
  '+': 'add',
  '-': 'subtract',
  '*': 'multiply',
  '/': 'divide',
  '%': 'mod',
};

/**
 * Parse and evaluate a simple arithmetic expression against variables.
 *
 * Supports expressions like "price * quantity", "total + tax", "count - 1".
 * Each token is resolved as a variable name or parsed as a literal number.
 *
 * @param expression - The expression string (e.g., "a + b").
 * @param variables - Variable name → value map.
 * @returns The numeric result.
 */
export function computeExpression(
  expression: string,
  variables: Record<string, unknown>,
): number {
  const trimmed = expression.trim();

  // Try to find a binary operator
  for (const [symbol, op] of Object.entries(COMPUTE_OPS)) {
    // Split on the operator, but avoid splitting negative numbers
    // Use a regex that matches the operator surrounded by whitespace or at boundaries
    const parts = trimmed.split(new RegExp(`\\s*\\${symbol}\\s*`));
    if (parts.length === 2) {
      const left = resolveNumericToken(parts[0].trim(), variables);
      const right = resolveNumericToken(parts[1].trim(), variables);
      return mathOp([left, right], op);
    }
  }

  // No operator found — treat as a single variable or literal
  return resolveNumericToken(trimmed, variables);
}

/** Resolve a token as a variable name or literal number. */
function resolveNumericToken(
  token: string,
  variables: Record<string, unknown>,
): number {
  // Try as literal number first
  const num = Number(token);
  if (!isNaN(num) && token !== '') return num;

  // Try as variable name
  const value = variables[token];
  if (value === undefined) {
    throw new Error(`Unknown variable or invalid number: "${token}"`);
  }
  const resolved = Number(value);
  if (isNaN(resolved)) {
    throw new Error(`Variable "${token}" is not numeric: ${String(value)}`);
  }
  return resolved;
}
