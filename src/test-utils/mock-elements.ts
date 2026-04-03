/**
 * Factory functions for creating test elements.
 *
 * Each factory creates a minimal DOM element (via jsdom) with appropriate
 * attributes and wraps it in a QueryableElement with a working getState().
 */

import type { QueryableElement, QueryableElementState } from "../core/element-query";

// ---------------------------------------------------------------------------
// Counter for unique IDs
// ---------------------------------------------------------------------------

let idCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Reset the ID counter. Call this in beforeEach() to get deterministic IDs.
 */
export function resetIdCounter(): void {
  idCounter = 0;
}

// ---------------------------------------------------------------------------
// State defaults
// ---------------------------------------------------------------------------

function defaultState(
  element: HTMLElement,
  overrides?: Partial<QueryableElementState>,
): QueryableElementState {
  return {
    visible: true,
    enabled: true,
    focused: false,
    checked: undefined,
    textContent: element.textContent?.trim() ?? "",
    value: undefined,
    rect: { x: 0, y: 0, width: 100, height: 30 },
    computedStyles: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Generic factory
// ---------------------------------------------------------------------------

export interface MockElementOptions {
  id?: string;
  type?: string;
  label?: string;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  state?: Partial<QueryableElementState>;
  parent?: HTMLElement;
}

/**
 * Create a generic QueryableElement backed by a real DOM element.
 */
export function createMockElement(options: MockElementOptions = {}): QueryableElement {
  const {
    id = nextId("el"),
    type = "generic",
    label,
    tagName = "div",
    textContent,
    attributes = {},
    state: stateOverrides,
    parent,
  } = options;

  const element = document.createElement(tagName);
  if (textContent !== undefined) {
    element.textContent = textContent;
  }
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  // Attach to a parent if provided, otherwise to document.body
  if (parent) {
    parent.appendChild(element);
  } else {
    document.body.appendChild(element);
  }

  const stateSnapshot = defaultState(element, stateOverrides);

  return {
    id,
    element,
    type,
    label,
    getState: () => ({ ...stateSnapshot }),
  };
}

// ---------------------------------------------------------------------------
// Typed factories
// ---------------------------------------------------------------------------

/**
 * Create a button element.
 */
export function createButton(
  labelText: string,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  return createMockElement({
    type: "button",
    tagName: "button",
    textContent: labelText,
    label: labelText,
    ...overrides,
  });
}

/**
 * Create an input element.
 */
export function createInput(
  placeholder: string,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  return createMockElement({
    type: "input",
    tagName: "input",
    label: placeholder,
    attributes: { placeholder, type: "text", ...(overrides?.attributes ?? {}) },
    ...overrides,
    // Re-apply attributes to avoid override clobbering
  });
}

/**
 * Create a link element.
 */
export function createLink(
  text: string,
  href: string,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  return createMockElement({
    type: "link",
    tagName: "a",
    textContent: text,
    label: text,
    attributes: { href, ...(overrides?.attributes ?? {}) },
    ...overrides,
  });
}

/**
 * Create a select element with options.
 */
export function createSelect(
  options: string[],
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  const el = createMockElement({
    type: "select",
    tagName: "select",
    label: options[0],
    ...overrides,
  });

  for (const optText of options) {
    const opt = document.createElement("option");
    opt.textContent = optText;
    opt.value = optText.toLowerCase().replace(/\s+/g, "-");
    el.element.appendChild(opt);
  }

  return el;
}

/**
 * Create a heading element (h1-h6).
 */
export function createHeading(
  level: number,
  text: string,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  const tag = `h${Math.max(1, Math.min(6, level))}`;
  return createMockElement({
    type: "heading",
    tagName: tag,
    textContent: text,
    label: text,
    ...overrides,
  });
}

/**
 * Create a checkbox input element.
 */
export function createCheckbox(
  label: string,
  checked: boolean,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  return createMockElement({
    type: "checkbox",
    tagName: "input",
    label,
    attributes: {
      type: "checkbox",
      ...(checked ? { checked: "" } : {}),
      ...(overrides?.attributes ?? {}),
    },
    state: { checked, ...overrides?.state },
    ...overrides,
  });
}

/**
 * Create a textarea element.
 */
export function createTextarea(
  placeholder: string,
  overrides?: Partial<MockElementOptions>,
): QueryableElement {
  return createMockElement({
    type: "textarea",
    tagName: "textarea",
    label: placeholder,
    attributes: { placeholder, ...(overrides?.attributes ?? {}) },
    ...overrides,
  });
}
