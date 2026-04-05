/**
 * Sibling extractor — finds elements rendered alongside the route component.
 *
 * Instead of analyzing the entire app shell, this focuses on the specific
 * rendering context: find where the route component (<TabContent />) is
 * rendered, then extract elements from its sibling components in the same
 * parent container. These siblings are always present regardless of route.
 *
 * This is the general approach: no special "global" concept, just
 * "elements that are siblings of the route switcher."
 */

import type {
  SourceFile,
  Project,
  Node,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";
import {
  parseComponent,
} from "../parsing/component-parser";
import {
  resolveComponent,
} from "../parsing/import-resolver";
import {
  extractElements,
  extractElementsFromRoots,
  type ExtractedElement,
} from "./element-extractor";

/**
 * Extract elements that are rendered alongside the route component.
 *
 * Searches the app shell file for the JSX node where `routeComponentName`
 * is rendered, then extracts elements from sibling JSX nodes in the same
 * parent container. These siblings are always present on every route.
 *
 * Also follows imported component references (like `<Sidebar />`) to
 * extract their internal elements.
 */
export function extractRouteSiblingElements(
  appShellFile: SourceFile,
  routeComponentName: string,
  project?: Project,
  maxDepth?: number,
): ExtractedElement[] {
  const elements: ExtractedElement[] = [];
  const depth = maxDepth ?? 5;

  // Find ALL occurrences of <RouteComponent ... /> or <RouteComponent>...</RouteComponent>
  // in the file (searching all functions, not just exported ones)
  const routeUsages = findComponentUsages(appShellFile, routeComponentName);

  for (const routeNode of routeUsages) {
    // Walk up the tree to find a container with component siblings.
    // The route component may be wrapped in a <main> or <div> — we need
    // to find the ancestor that also contains siblings like <Sidebar />.
    let ancestor: Node | undefined = routeNode.getParent();
    let siblings: Node[] = [];
    for (let i = 0; i < 5 && ancestor; i++) {
      const children = getJsxChildren(ancestor);
      const componentSiblings = children.filter(
        (child) => child !== routeNode && !isComponentNode(child, routeComponentName)
          && !containsComponent(child, routeComponentName),
      );
      if (componentSiblings.some((c) => getComponentName(c) !== null)) {
        siblings = componentSiblings;
        break;
      }
      ancestor = ancestor.getParent();
    }

    // Extract elements from each sibling
    for (const sibling of siblings) {
      // Direct HTML elements
      const directElements = extractElements(sibling);
      elements.push(...directElements);

      // Follow component references to extract their internal elements
      if (project) {
        const compName = getComponentName(sibling);
        if (compName) {
          const resolved = resolveComponent(compName, appShellFile, project, depth);
          if (resolved) {
            let parsed = parseComponent(resolved.sourceFile, resolved.name);

            // If parseComponent fails (barrel file), follow re-exports
            if (!parsed) {
              const reExportTarget = followReExport(
                resolved.sourceFile,
                resolved.name,
                project,
              );
              if (reExportTarget) {
                parsed = parseComponent(reExportTarget, resolved.name);
              }
            }

            if (parsed) {
              elements.push(...extractElementsFromRoots(parsed.jsxRoots));
            }
          }
        }
      }
    }
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find all JSX usages of a component name in a source file. */
function findComponentUsages(sourceFile: SourceFile, componentName: string): Node[] {
  const usages: Node[] = [];

  for (const el of sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    if (el.getTagNameNode().getText() === componentName) {
      usages.push(el);
    }
  }
  for (const el of sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    if (el.getTagNameNode().getText() === componentName) {
      // Return the parent JsxElement, not the opening tag
      usages.push(el.getParent()!);
    }
  }

  return usages;
}

/** Get JSX children of a node, including those inside SyntaxList wrappers. */
function getJsxChildren(node: Node): Node[] {
  const children: Node[] = [];
  const jsxKinds = new Set([
    SyntaxKind.JsxElement,
    SyntaxKind.JsxSelfClosingElement,
    SyntaxKind.JsxExpression,
    SyntaxKind.JsxFragment,
  ]);

  for (const child of node.getChildren()) {
    if (jsxKinds.has(child.getKind())) {
      children.push(child);
    } else if (child.getKind() === SyntaxKind.SyntaxList) {
      // SyntaxList wraps the JSX children between opening and closing tags
      for (const slChild of child.getChildren()) {
        if (jsxKinds.has(slChild.getKind())) {
          children.push(slChild);
        }
      }
    }
  }

  return children;
}

/** Check if a JSX node renders a specific component. */
function isComponentNode(node: Node, componentName: string): boolean {
  if (node.getKind() === SyntaxKind.JsxSelfClosingElement) {
    return (node as any).getTagNameNode().getText() === componentName;
  }
  if (node.getKind() === SyntaxKind.JsxElement) {
    return (node as any).getOpeningElement().getTagNameNode().getText() === componentName;
  }
  return false;
}

/**
 * Follow a re-export chain to find the actual source file.
 * Handles barrel files (index.ts) that re-export from other files.
 */
function followReExport(
  barrelFile: SourceFile,
  exportName: string,
  project: Project,
): SourceFile | null {
  for (const exportDecl of barrelFile.getExportDeclarations()) {
    const moduleSpec = exportDecl.getModuleSpecifierValue();
    if (!moduleSpec) continue;

    const namedExports = exportDecl.getNamedExports();
    const hasExport = namedExports.some(
      (ne) => ne.getName() === exportName || ne.getAliasNode()?.getText() === exportName,
    );
    if (!hasExport) continue;

    // Resolve the module specifier to a source file
    const resolved = exportDecl.getModuleSpecifierSourceFile();
    if (resolved) return resolved;
  }
  return null;
}

/** Check if a JSX node contains a specific component anywhere in its subtree. */
function containsComponent(node: Node, componentName: string): boolean {
  for (const el of node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    if ((el as any).getTagNameNode().getText() === componentName) return true;
  }
  for (const el of node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    if (el.getTagNameNode().getText() === componentName) return true;
  }
  return false;
}

/** Get the component name from a JSX node if it's a component reference. */
function getComponentName(node: Node): string | null {
  let tagName: string | null = null;

  if (node.getKind() === SyntaxKind.JsxSelfClosingElement) {
    tagName = (node as any).getTagNameNode().getText();
  } else if (node.getKind() === SyntaxKind.JsxElement) {
    tagName = (node as any).getOpeningElement().getTagNameNode().getText();
  }

  if (tagName && /^[A-Z]/.test(tagName) && !tagName.includes(".")) {
    return tagName;
  }
  return null;
}
