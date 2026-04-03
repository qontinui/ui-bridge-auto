/**
 * Element extractor — walks JSX AST nodes and converts semantic
 * attributes into ElementQuery objects for state detection and
 * action targeting.
 *
 * Only extracts elements with at least one semantic attribute:
 * role, aria-label, aria-expanded, data-content-role, id, text children, etc.
 * Plain layout divs without semantic markers are skipped.
 *
 * Precision matters for two runtime consumers:
 * - StateDetector.evaluate() checks requiredElements against live DOM
 * - executor.findElement() locates specific interactive elements
 */

import { type Node, SyntaxKind } from "ts-morph";
import type { ElementQuery } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An extracted element with its query and metadata. */
export interface ExtractedElement {
  /** The ElementQuery that identifies this element in the DOM. */
  query: ElementQuery;
  /** Whether this element is interactive (button, link, input, etc.). */
  interactive: boolean;
  /** The HTML tag or component name. */
  tagName: string;
  /** Line number in source. */
  line: number;
}

// ---------------------------------------------------------------------------
// JSX attribute name -> ElementQuery field mapping
// ---------------------------------------------------------------------------

const ATTR_MAP: Record<string, string> = {
  role: "role",
  id: "id",
  "aria-label": "ariaLabel",
  "aria-expanded": "ariaExpanded",
  "aria-selected": "ariaSelected",
  "aria-pressed": "ariaPressed",
};

/** ARIA fields that require boolean coercion from string "true"/"false". */
const ARIA_BOOLEAN_FIELDS = new Set([
  "ariaExpanded",
  "ariaSelected",
  "ariaPressed",
]);

/** Data attributes that go into ElementQuery.attributes. */
const DATA_ATTRS = [
  "data-content-role",
  "data-content-label",
  "data-testid",
  "data-nav-item",
  "data-state",
];

/** HTML tags that are inherently interactive. */
const INTERACTIVE_TAGS = new Set([
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "summary",
]);

/** Roles that indicate interactive elements. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "option",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "combobox",
  "textbox",
  "searchbox",
]);

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Extract semantic elements from a JSX AST node tree.
 *
 * Walks all JSX elements (both self-closing and open/close) and builds
 * an ElementQuery for each one that has semantic attributes. Elements
 * without any identifying attribute are skipped.
 *
 * @param jsxRoot - A JSX root node (element, fragment, or self-closing).
 * @returns Array of extracted elements with their queries.
 */
export function extractElements(jsxRoot: Node): ExtractedElement[] {
  const elements: ExtractedElement[] = [];

  // Walk all JSX self-closing elements: <Component />
  const selfClosing = jsxRoot.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  );
  for (const el of selfClosing) {
    const tagName = el.getTagNameNode().getText();
    const attrs = extractJsxAttributes(el);
    const textContent = undefined; // self-closing has no text children
    const extracted = buildElement(
      tagName,
      attrs,
      textContent,
      el.getStartLineNumber(),
    );
    if (extracted) elements.push(extracted);
  }

  // Walk all JSX opening elements: <Tag>...</Tag>
  const jsxElements = jsxRoot.getDescendantsOfKind(SyntaxKind.JsxElement);
  for (const el of jsxElements) {
    const opening = el.getOpeningElement();
    const tagName = opening.getTagNameNode().getText();
    const attrs = extractJsxAttributes(opening);
    const textContent = extractTextContent(el);
    const extracted = buildElement(
      tagName,
      attrs,
      textContent,
      el.getStartLineNumber(),
    );
    if (extracted) elements.push(extracted);
  }

  // Also include the root node itself if it's a JSX element
  if (jsxRoot.getKind() === SyntaxKind.JsxSelfClosingElement) {
    const tagName = (jsxRoot as any).getTagNameNode().getText();
    const attrs = extractJsxAttributes(jsxRoot);
    const extracted = buildElement(
      tagName,
      attrs,
      undefined,
      jsxRoot.getStartLineNumber(),
    );
    if (extracted) elements.push(extracted);
  } else if (jsxRoot.getKind() === SyntaxKind.JsxElement) {
    const opening = (jsxRoot as any).getOpeningElement();
    const tagName = opening.getTagNameNode().getText();
    const attrs = extractJsxAttributes(opening);
    const textContent = extractTextContent(jsxRoot);
    const extracted = buildElement(
      tagName,
      attrs,
      textContent,
      jsxRoot.getStartLineNumber(),
    );
    if (extracted) elements.push(extracted);
  }

  return deduplicateElements(elements);
}

/**
 * Extract elements from multiple JSX root nodes.
 */
export function extractElementsFromRoots(jsxRoots: Node[]): ExtractedElement[] {
  const all: ExtractedElement[] = [];
  for (const root of jsxRoots) {
    all.push(...extractElements(root));
  }
  return deduplicateElements(all);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Raw attribute map from JSX. */
type AttrMap = Map<string, string | boolean>;

/**
 * Extract JSX attributes from an element node.
 */
function extractJsxAttributes(node: Node): AttrMap {
  const attrs = new Map<string, string | boolean>();

  const jsxAttrs = node.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  for (const attr of jsxAttrs) {
    // Only process direct attributes of this element, not nested ones
    const parent = attr.getParent();
    if (parent?.getKind() !== SyntaxKind.JsxAttributes) {
      continue;
    }

    const grandparent = parent.getParent();
    if (grandparent !== node) continue;

    const name = attr.getNameNode().getText();
    const initializer = attr.getInitializer();

    if (!initializer) {
      // Boolean attribute: <div hidden />
      attrs.set(name, true);
      continue;
    }

    if (initializer.getKind() === SyntaxKind.StringLiteral) {
      attrs.set(name, initializer.getText().slice(1, -1)); // strip quotes
    } else if (initializer.getKind() === SyntaxKind.JsxExpression) {
      const expr = initializer.getChildAtIndex(1); // skip {
      if (expr) {
        const text = expr.getText().trim();
        if (text === "true") attrs.set(name, true);
        else if (text === "false") attrs.set(name, false);
        else if (/^["']/.test(text)) attrs.set(name, text.slice(1, -1));
        // Skip dynamic expressions — they can't be statically resolved
      }
    }
  }

  return attrs;
}

/**
 * Extract static text content from a JSX element's direct children only.
 * Does not descend into child JSX elements to avoid picking up nested text.
 */
function extractTextContent(element: Node): string | undefined {
  const texts: string[] = [];

  // Only look at direct children of this element, not descendants
  const children = element.getChildren();
  for (const child of children) {
    if (child.getKind() === SyntaxKind.JsxText) {
      const text = child.getText().trim();
      if (text) texts.push(text);
    }
    // Also check inside the SyntaxList that holds JSX children
    if (child.getKind() === SyntaxKind.SyntaxList) {
      for (const grandchild of child.getChildren()) {
        if (grandchild.getKind() === SyntaxKind.JsxText) {
          const text = grandchild.getText().trim();
          if (text) texts.push(text);
        }
      }
    }
  }

  if (texts.length === 0) return undefined;
  return texts.join(" ").trim();
}

/**
 * Build an ExtractedElement from tag name, attributes, and text.
 * Returns undefined if the element has no semantic attributes.
 */
function buildElement(
  tagName: string,
  attrs: AttrMap,
  textContent: string | undefined,
  line: number,
): ExtractedElement | undefined {
  const query: ElementQuery = {};
  let hasSemantic = false;

  // Map known attributes to ElementQuery fields
  for (const [htmlAttr, queryField] of Object.entries(ATTR_MAP)) {
    const value = attrs.get(htmlAttr);
    if (value !== undefined) {
      // Coerce string "true"/"false" to boolean for ARIA boolean fields
      let coerced: unknown = value;
      if (ARIA_BOOLEAN_FIELDS.has(queryField)) {
        if (value === "true") coerced = true;
        else if (value === "false") coerced = false;
      }
      (query as Record<string, unknown>)[queryField] = coerced;
      hasSemantic = true;
    }
  }

  // Map data attributes to ElementQuery.attributes
  const dataAttrs: Record<string, string> = {};
  for (const dataAttr of DATA_ATTRS) {
    const value = attrs.get(dataAttr);
    if (typeof value === "string") {
      dataAttrs[dataAttr] = value;
      hasSemantic = true;
    }
  }
  if (Object.keys(dataAttrs).length > 0) {
    query.attributes = dataAttrs;
  }

  // Set tag name for lowercase HTML elements
  const isHtmlTag = tagName === tagName.toLowerCase();
  if (isHtmlTag) {
    query.tagName = tagName;
  }

  // Set text content
  if (textContent) {
    query.text = textContent;
    hasSemantic = true;
  }

  // Set id from attrs if present
  const idValue = attrs.get("id");
  if (typeof idValue === "string") {
    query.id = idValue;
    hasSemantic = true;
  }

  // Skip elements with no semantic attributes
  if (!hasSemantic) return undefined;

  // Determine if interactive
  const role = typeof query.role === "string" ? query.role : undefined;
  const interactive =
    INTERACTIVE_TAGS.has(tagName) ||
    (role !== undefined && INTERACTIVE_ROLES.has(role)) ||
    attrs.has("onClick") ||
    attrs.has("onSubmit");

  return { query, interactive, tagName, line };
}

/**
 * Deduplicate elements by their query serialization.
 */
function deduplicateElements(elements: ExtractedElement[]): ExtractedElement[] {
  const seen = new Set<string>();
  const result: ExtractedElement[] = [];

  for (const el of elements) {
    const key = JSON.stringify(el.query);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(el);
    }
  }

  return result;
}
