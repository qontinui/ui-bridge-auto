/**
 * Page metadata extractor — extracts page names, descriptions, and IDs
 * from page registration components in JSX.
 *
 * Recognizes patterns like:
 *   <PageRegistration id="gui-automation" name="Workflows" description="..." />
 *   usePageRegistration("gui-automation", "Workflows", "...")
 *
 * These provide AI-readable page names that are more accurate than inferring
 * from component names. The extracted metadata maps route IDs to human-readable
 * names and descriptions.
 */

import { type Node, SyntaxKind } from "ts-morph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata extracted from a page registration component. */
export interface PageMetadata {
  /** Page ID (matches the route ID). */
  id: string;
  /** Human-readable page name. */
  name: string;
  /** Page description. */
  description: string;
  /** Source line number. */
  line: number;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Extract page metadata from JSX nodes.
 *
 * Scans for components whose name matches common page registration patterns
 * (PageRegistration, PageHeader, PageTitle, etc.) and extracts their
 * id/name/description props.
 *
 * @param jsxRoot - JSX root node to scan.
 * @returns Array of page metadata entries.
 */
export function extractPageMetadata(jsxRoot: Node): PageMetadata[] {
  const results: PageMetadata[] = [];

  // Scan self-closing elements: <PageRegistration id="x" name="Y" />
  const selfClosing = jsxRoot.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  );

  for (const el of selfClosing) {
    const tagName = el.getTagNameNode().getText();
    if (!isPageRegistrationComponent(tagName)) continue;

    const props = extractStringProps(el, ["id", "name", "description"]);
    if (props.id && props.name) {
      results.push({
        id: props.id,
        name: props.name,
        description: props.description ?? "",
        line: el.getStartLineNumber(),
      });
    }
  }

  // Scan opening elements: <PageRegistration id="x" name="Y">...</PageRegistration>
  const opening = jsxRoot.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  for (const el of opening) {
    const tagName = el.getTagNameNode().getText();
    if (!isPageRegistrationComponent(tagName)) continue;

    const props = extractStringProps(el, ["id", "name", "description"]);
    if (props.id && props.name) {
      results.push({
        id: props.id,
        name: props.name,
        description: props.description ?? "",
        line: el.getStartLineNumber(),
      });
    }
  }

  return results;
}

/**
 * Extract page metadata from an entire route file's switch statement.
 * Returns a map from route ID to page metadata.
 */
export function extractAllPageMetadata(
  routeFileRoot: Node,
): Map<string, PageMetadata> {
  const all = extractPageMetadata(routeFileRoot);
  const map = new Map<string, PageMetadata>();
  for (const meta of all) {
    map.set(meta.id, meta);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Component names that provide page metadata. */
const PAGE_REGISTRATION_NAMES = new Set([
  "PageRegistration",
  "PageHeader",
  "PageTitle",
  "PageMeta",
]);

function isPageRegistrationComponent(tagName: string): boolean {
  return PAGE_REGISTRATION_NAMES.has(tagName);
}

/**
 * Extract string prop values from a JSX element.
 */
function extractStringProps(
  element: Node,
  propNames: string[],
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const nameSet = new Set(propNames);

  const attrs = element.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  for (const attr of attrs) {
    // Only direct attributes of this element
    const parent = attr.getParent();
    if (parent?.getParent() !== element) continue;

    const name = attr.getNameNode().getText();
    if (!nameSet.has(name)) continue;

    const init = attr.getInitializer();
    if (!init) continue;

    if (init.getKind() === SyntaxKind.StringLiteral) {
      result[name] = init.getText().slice(1, -1); // strip quotes
    } else if (init.getKind() === SyntaxKind.JsxExpression) {
      // {`template`} or {"string"}
      const inner = init.getChildAtIndex(1);
      if (inner) {
        const text = inner.getText();
        if (/^["'`]/.test(text)) {
          result[name] = text.slice(1, -1);
        }
      }
    }
  }

  return result;
}
