/**
 * Canonical-JSON serialization helpers.
 *
 * Determinism contract:
 * - Same input → byte-identical output from `canonicalJSON`.
 * - Round-trip stable: `canonicalJSON(JSON.parse(canonicalJSON(v)))` is
 *   byte-identical to `canonicalJSON(v)` for any JSON-shape `v`.
 *
 * Object keys are sorted lexicographically (UTF-16 code unit order) at every
 * level. Array order is preserved — array order is meaningful in callers.
 *
 * Used by suite serialization (Section 9) and self-diagnosis serialization
 * (Section 10) so both subsystems share one byte-stable encoding.
 */

/**
 * Recursively walk a JSON-serializable value and re-emit it with object keys
 * sorted alphabetically at every level. Arrays preserve order.
 *
 * `unknown` is the right type for the input: we only touch JSON-shape values
 * (string, number, boolean, null, array, plain object). Any other value
 * (function, symbol, undefined-as-property) violates the JSON contract and
 * is excluded by `JSON.stringify` anyway.
 */
export function stableStringifyValue(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stableStringifyValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) sorted[k] = stableStringifyValue(obj[k]);
    return sorted;
  }
  return value;
}

/**
 * Convenience wrapper: byte-stable JSON serialization. Equivalent to
 * `JSON.stringify(stableStringifyValue(value))`.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(stableStringifyValue(value));
}
