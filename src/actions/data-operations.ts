/**
 * Variable extraction from elements and string interpolation.
 *
 * Provides utilities for extracting property values from registry elements,
 * storing them in variables, interpolating variable references in strings,
 * and evaluating simple comparison expressions.
 */

import type { ElementQuery, QueryableElement } from '../core/element-query';
import { findFirst } from '../core/element-query';

// ---------------------------------------------------------------------------
// extractValue
// ---------------------------------------------------------------------------

/**
 * Extract a property value from a QueryableElement.
 *
 * Supports common element properties (text, value, checked, etc.) as well
 * as arbitrary HTML attributes via the `"attribute:name"` prefix pattern.
 *
 * @param element - The registry element to extract from.
 * @param property - The property name to extract. Use `"attribute:name"` for HTML attributes.
 * @returns The extracted value, or undefined/null if not available.
 */
export function extractValue(
  element: QueryableElement,
  property: string,
): unknown {
  const state = element.getState();

  // Handle "attribute:xxx" prefix for raw HTML attribute access.
  if (property.startsWith('attribute:')) {
    const attrName = property.slice('attribute:'.length);
    return element.element.getAttribute(attrName);
  }

  switch (property) {
    case 'text':
    case 'textContent':
      return state.textContent ?? element.element.textContent ?? '';

    case 'value':
      return state.value ?? (element.element as HTMLInputElement).value ?? '';

    case 'checked':
      return state.checked ?? (element.element as HTMLInputElement).checked ?? false;

    case 'selected': {
      const selectEl = element.element as HTMLSelectElement;
      if (selectEl.selectedOptions && selectEl.selectedOptions.length > 0) {
        return selectEl.selectedOptions[0].value;
      }
      return element.element.getAttribute('aria-selected') === 'true';
    }

    case 'visible':
      return state.visible ?? true;

    case 'enabled':
      return state.enabled ?? true;

    case 'focused':
      return state.focused ?? false;

    case 'href':
      return (element.element as HTMLAnchorElement).href ??
        element.element.getAttribute('href') ?? '';

    case 'src':
      return (element.element as HTMLImageElement).src ??
        element.element.getAttribute('src') ?? '';

    case 'placeholder':
      return (element.element as HTMLInputElement).placeholder ??
        element.element.getAttribute('placeholder') ?? '';

    case 'id':
      return element.id;

    case 'type':
      return element.type;

    case 'label':
      return element.label ?? '';

    case 'tagName':
      return element.element.tagName.toLowerCase();

    case 'className':
      return element.element.className ?? '';

    case 'role':
      return element.element.getAttribute('role') ?? '';

    case 'ariaLabel':
      return element.element.getAttribute('aria-label') ?? element.label ?? '';

    default:
      // Fall back to HTML attribute lookup.
      return element.element.getAttribute(property) ?? undefined;
  }
}

// ---------------------------------------------------------------------------
// extractToVariable
// ---------------------------------------------------------------------------

/**
 * Find an element by query, extract a property, and store in the variables map.
 *
 * @param registry - Registry providing element access.
 * @param query - Query to find the target element.
 * @param property - Property to extract from the matched element.
 * @param variableName - Key under which to store the value in variables.
 * @param variables - Mutable map to store the extracted value.
 * @throws Error if no element matches the query.
 */
export async function extractToVariable(
  registry: { getAllElements(): QueryableElement[] },
  query: ElementQuery,
  property: string,
  variableName: string,
  variables: Record<string, unknown>,
): Promise<void> {
  const elements = registry.getAllElements();
  const result = findFirst(elements, query);

  if (!result) {
    throw new Error(
      `extractToVariable: no element found matching query: ${JSON.stringify(query)}`,
    );
  }

  const el = elements.find((e) => e.id === result.id);
  if (!el) {
    throw new Error(
      `extractToVariable: element "${result.id}" disappeared from registry`,
    );
  }

  variables[variableName] = extractValue(el, property);
}

// ---------------------------------------------------------------------------
// interpolate
// ---------------------------------------------------------------------------

/**
 * Interpolate variable references in a string template.
 *
 * Replaces `{{varName}}` placeholders with the corresponding variable values.
 * Supports dotted paths for nested objects (e.g., `{{user.name}}`).
 * Unresolved placeholders are left as-is.
 *
 * @param template - The template string with `{{varName}}` placeholders.
 * @param variables - Map of variable names to values.
 * @returns The interpolated string.
 *
 * @example
 * ```ts
 * interpolate('Hello, {{name}}!', { name: 'World' });
 * // => 'Hello, World!'
 * interpolate('Hello, {{user.name}}!', { user: { name: 'Bob' } });
 * // => 'Hello, Bob!'
 * ```
 */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, path: string) => {
    const value = resolvePath(variables, path);
    if (value !== undefined) {
      return String(value);
    }
    return match; // Leave unresolved placeholders as-is.
  });
}

/**
 * Resolve a dotted path against a nested object.
 * E.g., resolvePath({ user: { name: 'Bob' } }, 'user.name') => 'Bob'
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

// ---------------------------------------------------------------------------
// evaluateExpression
// ---------------------------------------------------------------------------

/**
 * Evaluate a comparison between two values using an operator.
 *
 * Supported operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `matches`.
 *
 * @param actual - The left-hand side value.
 * @param operator - The comparison operator.
 * @param expected - The right-hand side value.
 * @returns True if the comparison holds.
 *
 * @example
 * ```ts
 * evaluateExpression(10, '>', 5);       // true
 * evaluateExpression('hello world', 'contains', 'world'); // true
 * evaluateExpression('test-123', 'matches', '^test-\\d+$'); // true
 * ```
 */
export function evaluateExpression(
  actual: unknown,
  operator: string,
  expected: unknown,
): boolean {
  switch (operator) {
    case '==':
      return actual == expected; // eslint-disable-line eqeqeq

    case '!=':
      return actual != expected; // eslint-disable-line eqeqeq

    case '>':
      return Number(actual) > Number(expected);

    case '<':
      return Number(actual) < Number(expected);

    case '>=':
      return Number(actual) >= Number(expected);

    case '<=':
      return Number(actual) <= Number(expected);

    case 'contains':
      return String(actual).includes(String(expected));

    case 'matches': {
      try {
        const regex = new RegExp(String(expected));
        return regex.test(String(actual));
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}
