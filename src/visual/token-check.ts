/**
 * Design-token presence check (Section 8 — visual + semantic fusion).
 *
 * Scans an element's computed styles against a `DesignTokenRegistry`
 * supplied by the caller. Emits a `TokenViolation` for every property
 * whose runtime value is not a member of the catalog of allowed token
 * values for that property.
 *
 * The package ships only the `DesignTokenRegistry` interface, NOT a
 * concrete catalog. Catalogs live per-app — one per design system —
 * because there's no canonical Qontinui-wide token set. Promote to a
 * shared `@qontinui/design-tokens` package when 2+ apps want to share.
 *
 * Determinism: pure function. Reads `window.getComputedStyle` (sync) for
 * properties not exposed on the typed `ComputedStyleSubset`, and the
 * subset directly for keys it does cover.
 */

import type { QueryableElement } from "../core/element-query";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-property catalog of allowed token values.
 *
 * Keys are CSS property names (camelCase or kebab-case — both are read).
 * Values are the set of CSS values that count as "valid token"s for that
 * property.
 *
 * Example: `{ color: ["rgb(0, 0, 0)", "rgb(34, 34, 34)"], "font-size": ["14px", "16px"] }`.
 *
 * Values use whatever notation `getComputedStyle` returns — that's
 * normalised to `rgb()` for colors, `Npx` for sizes, etc. Catalog
 * authors can render their tokens in the same notation by computing
 * them in a hidden DOM probe at registration time, or by hand-coding the
 * normalised strings.
 */
export interface DesignTokenRegistry {
  /**
   * Lookup the allowed values for a CSS property.
   *
   * Returns:
   *   - a `Set<string>` of allowed values when the property is governed
   *   - `null` when the property is not governed (skipped — no violation)
   */
  allowedValuesFor(property: string): ReadonlySet<string> | null;

  /**
   * Iterate the property names this registry governs. Used for the
   * automatic property scan when `checkDesignTokens` is called without an
   * explicit `properties` list.
   */
  properties(): readonly string[];
}

/** A single violation: an element-property pair whose value is off-token. */
export interface TokenViolation {
  /** The element id reported for the violation. */
  elementId: string;
  /** CSS property name as supplied to `allowedValuesFor`. */
  property: string;
  /** Runtime value (from getComputedStyle). */
  actualValue: string;
  /** A snapshot of the allowed values, sorted ascending for determinism. */
  allowedValues: string[];
}

/** Options for `checkDesignTokens`. */
export interface CheckDesignTokensOptions {
  /**
   * Override property scan. When omitted, every property exposed by
   * `registry.properties()` is checked.
   */
  properties?: readonly string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check an element's computed styles against the registry. Returns one
 * `TokenViolation` per off-token property. Empty array = fully on-token.
 *
 * @param target - The element to scan.
 * @param registry - The design-token catalog to scan against.
 * @param options - Optional override for which properties to scan.
 */
export function checkDesignTokens(
  target: QueryableElement,
  registry: DesignTokenRegistry,
  options?: CheckDesignTokensOptions,
): TokenViolation[] {
  const properties = options?.properties ?? registry.properties();
  const violations: TokenViolation[] = [];

  // Sort property scan order for determinism.
  const sortedProps = [...properties].sort();

  // Pre-fetch typed subset (cheap for the keys it covers) and computed
  // styles for everything else.
  const state = target.getState();
  const typed = state.computedStyles;
  const computed = window.getComputedStyle(target.element);

  for (const prop of sortedProps) {
    const allowed = registry.allowedValuesFor(prop);
    if (allowed === null) continue;

    const actual = readProperty(prop, typed, computed);
    if (actual === undefined || actual === "") continue;

    if (!allowed.has(actual)) {
      violations.push({
        elementId: target.id,
        property: prop,
        actualValue: actual,
        allowedValues: [...allowed].sort(),
      });
    }
  }

  // Sort violations by property for deterministic output.
  violations.sort((a, b) => (a.property < b.property ? -1 : a.property > b.property ? 1 : 0));
  return violations;
}

// ---------------------------------------------------------------------------
// Property reader
// ---------------------------------------------------------------------------

/**
 * Read a CSS property value, preferring the typed `ComputedStyleSubset`
 * when the key matches one of the 8 fixed slots and falling back to the
 * raw `CSSStyleDeclaration` otherwise.
 *
 * Accepts both kebab-case (`font-size`) and camelCase (`fontSize`).
 */
function readProperty(
  prop: string,
  typed: Record<string, string> | undefined,
  computed: CSSStyleDeclaration,
): string | undefined {
  const camel = toCamelCase(prop);
  // Typed subset uses camelCase keys (display, fontSize, fontWeight, etc.)
  if (typed && Object.prototype.hasOwnProperty.call(typed, camel)) {
    return typed[camel];
  }
  // Fallback: getComputedStyle accepts kebab-case via getPropertyValue.
  const kebab = toKebabCase(prop);
  const v = computed.getPropertyValue(kebab);
  return v === "" ? undefined : v;
}

function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function toKebabCase(s: string): string {
  return s.replace(/([A-Z])/g, (_m, c: string) => "-" + c.toLowerCase());
}

// ---------------------------------------------------------------------------
// Convenience: build a registry from a plain map
// ---------------------------------------------------------------------------

/**
 * Convenience factory — builds a `DesignTokenRegistry` from a plain
 * `{ property: allowedValues[] }` map. Most callers can use this instead
 * of implementing the interface directly.
 *
 * @example
 *   const reg = buildDesignTokenRegistry({
 *     color: ["rgb(0, 0, 0)", "rgb(34, 34, 34)"],
 *     "font-size": ["14px", "16px"],
 *   });
 */
export function buildDesignTokenRegistry(
  spec: Record<string, readonly string[]>,
): DesignTokenRegistry {
  const sets = new Map<string, ReadonlySet<string>>();
  for (const [prop, values] of Object.entries(spec)) {
    sets.set(prop, new Set(values));
  }
  const props = [...sets.keys()].sort();
  return {
    allowedValuesFor: (property) => sets.get(property) ?? null,
    properties: () => props,
  };
}
