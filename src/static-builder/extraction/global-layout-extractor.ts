/**
 * Global layout extractor — analyzes the app shell (e.g., App.tsx) to
 * identify elements that are always present regardless of the active route.
 *
 * These global elements are merged into every state's requiredElements
 * so the StateDetector correctly expects them in the live DOM.
 *
 * Also identifies app-level conditional branches (auth gate, loading screen)
 * that produce top-level blocking states.
 */

import {
  type SourceFile,
  type Node,
  SyntaxKind,
  type ArrowFunction,
} from "ts-morph";
import { parseComponent, unwrapProviders } from "../parsing/component-parser";
import { extractElements, type ExtractedElement } from "./element-extractor";
import type { ElementQuery } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of global layout extraction. */
export interface GlobalLayout {
  /** Elements that are always present in the main app layout. */
  globalElements: ExtractedElement[];
  /** App-level conditional states (login, loading, etc.). */
  appBranches: AppBranch[];
}

/** An app-level conditional branch (early return before the main layout). */
export interface AppBranch {
  /** Human-readable label for this branch (e.g., "loading", "login"). */
  label: string;
  /** Elements present in this branch. */
  elements: ExtractedElement[];
  /** Whether this is a blocking/modal state. */
  blocking: boolean;
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * Extract the global layout from an app shell file.
 *
 * Parses the main component, identifies elements that are rendered
 * unconditionally (outside the route-switched content area), and
 * identifies early-return branches as app-level states.
 *
 * @param appShellFile - The app shell source file (e.g., App.tsx).
 * @param routeComponentName - The route switcher component name to exclude
 *   from global elements (e.g., "TabContent").
 */
export function extractGlobalLayout(
  appShellFile: SourceFile,
  routeComponentName: string,
): GlobalLayout {
  // Parse the default/first exported component
  const parsed = parseComponent(appShellFile);
  if (!parsed || parsed.jsxRoots.length === 0) {
    return { globalElements: [], appBranches: [] };
  }

  const globalElements: ExtractedElement[] = [];
  const appBranches: AppBranch[] = [];
  const visited = new Set<string>();

  // Recursively extract elements, unwrapping providers and following
  // local component references within the same file.
  extractFromRoots(
    parsed.jsxRoots,
    appShellFile,
    routeComponentName,
    globalElements,
    visited,
    5, // max recursion depth for following local components
  );

  // Look for early returns that indicate app-level states
  const branches = extractEarlyReturnBranches(appShellFile);
  appBranches.push(...branches);

  return { globalElements, appBranches };
}

/**
 * Recursively extract elements from JSX roots, unwrapping providers
 * and following local component references in the same file.
 */
function extractFromRoots(
  jsxRoots: Node[],
  sourceFile: SourceFile,
  routeComponentName: string,
  result: ExtractedElement[],
  visited: Set<string>,
  depth: number,
): void {
  if (depth <= 0) return;

  for (const root of jsxRoots) {
    const unwrapped = unwrapProviders(root);

    for (const node of unwrapped) {
      // Extract semantic elements from this node
      const elements = extractElements(node);
      const filtered = elements.filter(
        (el) => !isRouteComponent(el, routeComponentName),
      );
      result.push(...filtered);

      // Check if any child JSX references a local (same-file) component.
      // If so, follow it to extract its elements too.
      followLocalComponents(
        node,
        sourceFile,
        routeComponentName,
        result,
        visited,
        depth - 1,
      );
    }
  }
}

/**
 * Find local component references in JSX and follow them.
 *
 * When the JSX contains `<AppContent />` and `AppContent` is defined
 * in the same file, parse that function and extract its elements.
 */
function followLocalComponents(
  jsxNode: Node,
  sourceFile: SourceFile,
  routeComponentName: string,
  result: ExtractedElement[],
  visited: Set<string>,
  depth: number,
): void {
  if (depth <= 0) return;

  // Find all component references in this JSX node (including the node itself)
  const componentNames = new Set<string>();

  // Check the node itself if it's a component reference
  if (jsxNode.getKind() === SyntaxKind.JsxSelfClosingElement) {
    const tagName = (jsxNode as any).getTagNameNode().getText();
    if (/^[A-Z]/.test(tagName) && !tagName.includes("."))
      componentNames.add(tagName);
  } else if (jsxNode.getKind() === SyntaxKind.JsxElement) {
    const tagName = (jsxNode as any)
      .getOpeningElement()
      .getTagNameNode()
      .getText();
    if (/^[A-Z]/.test(tagName) && !tagName.includes("."))
      componentNames.add(tagName);
  }

  // Check descendants
  const selfClosing = jsxNode.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  );
  const opening = jsxNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  for (const el of selfClosing) {
    const name = el.getTagNameNode().getText();
    if (/^[A-Z]/.test(name) && !name.includes(".")) componentNames.add(name);
  }
  for (const el of opening) {
    const name = el.getTagNameNode().getText();
    if (/^[A-Z]/.test(name) && !name.includes(".")) componentNames.add(name);
  }

  for (const name of componentNames) {
    // Skip the route component and already-visited components
    if (name === routeComponentName) continue;
    if (visited.has(name)) continue;
    visited.add(name);

    // Check if this component is defined in the same file (non-exported function)
    const localFn = sourceFile.getFunction(name);
    if (localFn) {
      const localParsed = parseComponent(sourceFile, name);
      if (localParsed && localParsed.jsxRoots.length > 0) {
        extractFromRoots(
          localParsed.jsxRoots,
          sourceFile,
          routeComponentName,
          result,
          visited,
          depth,
        );
      }
    }
  }
}

/**
 * Extract global element queries (just the ElementQuery[], without metadata).
 */
export function extractGlobalElementQueries(
  appShellFile: SourceFile,
  routeComponentName: string,
): ElementQuery[] {
  const layout = extractGlobalLayout(appShellFile, routeComponentName);
  return layout.globalElements.map((el) => el.query);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Check if an extracted element is the route-switching component itself.
 */
function isRouteComponent(
  element: ExtractedElement,
  routeComponentName: string,
): boolean {
  return element.tagName === routeComponentName;
}

/**
 * Extract early-return conditional branches from a component.
 *
 * Looks for patterns like:
 *   if (loading) return <Spinner />;
 *   if (!authenticated) return <LoginScreen />;
 *
 * These become app-level blocking states.
 */
function extractEarlyReturnBranches(sourceFile: SourceFile): AppBranch[] {
  const branches: AppBranch[] = [];

  // Collect function bodies from both function declarations and arrow functions
  const bodies: Node[] = [];

  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) continue;
    const body = fn.getBody();
    if (body) bodies.push(body);
  }

  for (const varStmt of sourceFile.getVariableStatements()) {
    if (!varStmt.isExported()) continue;
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init?.getKind() === SyntaxKind.ArrowFunction) {
        const body = (init as ArrowFunction).getBody();
        if (body) bodies.push(body);
      }
    }
  }

  for (const body of bodies) {
    // Use getDescendantsOfKind since Block wraps statements in a SyntaxList
    const ifStatements = body
      .getDescendantsOfKind(SyntaxKind.IfStatement)
      .filter((ifStmt) => {
        // Only top-level if statements
        let parent: Node | undefined = ifStmt.getParent();
        while (parent !== undefined && parent !== body) {
          if (parent.getKind() === SyntaxKind.IfStatement) return false;
          parent = parent.getParent();
        }
        return parent === body;
      });

    for (const ifStmt of ifStatements) {
      // Then statement may be a direct ReturnStatement or a Block containing one
      const thenStmt = ifStmt.getThenStatement();
      const returns =
        thenStmt.getKind() === SyntaxKind.ReturnStatement
          ? [thenStmt as unknown as import("ts-morph").ReturnStatement]
          : thenStmt.getDescendantsOfKind(SyntaxKind.ReturnStatement);

      if (returns.length === 0) continue;

      const returnExpr = returns[0].getExpression();
      if (!returnExpr) continue;

      // Skip null/undefined returns
      const text = returnExpr.getText().trim();
      if (text === "null" || text === "undefined") continue;

      // Extract elements from the early return JSX
      const elements = extractElements(returnExpr);
      if (elements.length === 0) continue;

      // Generate a label from the condition
      const condition = ifStmt.getExpression().getText();
      const label = inferBranchLabel(condition);

      branches.push({
        label,
        elements,
        blocking: true,
      });
    }
  }

  return branches;
}

/**
 * Infer a human-readable label from a condition expression.
 */
function inferBranchLabel(condition: string): string {
  const normalized = condition.trim();

  // Common patterns
  if (/loading|isLoading|initializing/i.test(normalized)) return "loading";
  if (/auth|authenticated|isLoggedIn|login/i.test(normalized)) return "login";
  if (/setup|onboarding|wizard/i.test(normalized)) return "setup";
  if (/error|isError|hasError/i.test(normalized)) return "error";
  if (/maintenance/i.test(normalized)) return "maintenance";

  // Fallback: use a shortened version of the condition
  if (normalized.length > 30) {
    return normalized.slice(0, 27) + "...";
  }
  return normalized;
}
