/**
 * Global layout extractor — analyzes the app shell (e.g., App.tsx) to
 * identify elements that are always present regardless of the active route.
 *
 * Traverses the full component tree (imported components, not just local
 * ones) to find all rendered elements. Accuracy is more important than
 * speed — the extractor follows as many component layers as needed.
 *
 * Also identifies app-level conditional branches (auth gate, loading screen)
 * that produce top-level blocking states.
 */

import {
  type SourceFile,
  type Project,
  type Node,
  SyntaxKind,
  type ArrowFunction,
} from "ts-morph";
import {
  parseComponent,
  unwrapProviders,
} from "../parsing/component-parser";
import {
  resolveComponent,
  type ResolvedComponent,
} from "../parsing/import-resolver";
import {
  extractElements,
  extractElementsFromRoots,
  type ExtractedElement,
} from "./element-extractor";
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
 * Parses the main component and recursively traverses ALL child components
 * (both local and imported) to find elements that are rendered unconditionally
 * outside the route-switched content area.
 *
 * @param appShellFile - The app shell source file (e.g., App.tsx).
 * @param routeComponentName - The route switcher component name to exclude
 *   from global elements (e.g., "TabContent").
 * @param project - The ts-morph project for resolving imports across files.
 *   When provided, enables deep traversal of imported components.
 * @param maxDepth - Maximum depth for resolving imported components (default 10).
 */
export function extractGlobalLayout(
  appShellFile: SourceFile,
  routeComponentName: string,
  project?: Project,
  maxDepth?: number,
): GlobalLayout {
  // Parse the default/first exported component
  const parsed = parseComponent(appShellFile);
  if (!parsed || parsed.jsxRoots.length === 0) {
    return { globalElements: [], appBranches: [] };
  }

  const globalElements: ExtractedElement[] = [];
  const appBranches: AppBranch[] = [];
  const resolveDepth = maxDepth ?? 10;

  // Identify early-return branches FIRST so we can exclude their components
  // from global element extraction. Components rendered inside conditional
  // branches (login, loading, setup) are NOT always-present — they form
  // their own blocking states.
  const branches = extractEarlyReturnBranches(
    appShellFile,
    project,
    maxDepth ?? 10,
  );
  appBranches.push(...branches);

  // Collect component names from conditional branches to exclude from global traversal
  const conditionalComponents = new Set<string>();
  for (const branch of branches) {
    for (const el of branch.elements) {
      // If the element's tagName is a PascalCase component, exclude it
      if (/^[A-Z]/.test(el.tagName)) {
        conditionalComponents.add(el.tagName);
      }
    }
  }

  // Also collect component names directly from the early-return JSX
  for (const body of getAllFunctionBodies(appShellFile)) {
    const ifStatements = body
      .getDescendantsOfKind(SyntaxKind.IfStatement)
      .filter((ifStmt) => {
        let parent: Node | undefined = ifStmt.getParent();
        while (parent !== undefined && parent !== body) {
          if (parent.getKind() === SyntaxKind.IfStatement) return false;
          parent = parent.getParent();
        }
        return parent === body;
      });
    for (const ifStmt of ifStatements) {
      const thenStmt = ifStmt.getThenStatement();
      const names = collectComponentNames(thenStmt);
      for (const name of names) conditionalComponents.add(name);
    }
  }

  // Recursively extract elements, unwrapping providers and following
  // component references — excluding components from conditional branches.
  const visited = new Set<string>(conditionalComponents);
  // Also always exclude the route component
  visited.add(routeComponentName);

  extractFromRoots(
    parsed.jsxRoots,
    appShellFile,
    routeComponentName,
    globalElements,
    visited,
    resolveDepth,
    project,
  );

  return { globalElements, appBranches };
}

/**
 * Recursively extract elements from JSX roots, unwrapping providers
 * and following component references (local and imported).
 */
function extractFromRoots(
  jsxRoots: Node[],
  sourceFile: SourceFile,
  routeComponentName: string,
  result: ExtractedElement[],
  visited: Set<string>,
  depth: number,
  project?: Project,
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

      // Follow component references (local + imported)
      followComponents(
        node,
        sourceFile,
        routeComponentName,
        result,
        visited,
        depth - 1,
        project,
      );
    }
  }
}

/**
 * Find component references in JSX and follow them — both local (same file)
 * and imported (cross-file via the ts-morph project).
 */
function followComponents(
  jsxNode: Node,
  sourceFile: SourceFile,
  routeComponentName: string,
  result: ExtractedElement[],
  visited: Set<string>,
  depth: number,
  project?: Project,
): void {
  if (depth <= 0) return;

  // Collect all component names referenced in this JSX subtree
  const componentNames = collectComponentNames(jsxNode);

  for (const name of componentNames) {
    if (name === routeComponentName) continue;
    if (visited.has(name)) continue;
    visited.add(name);

    // 1. Try local (same-file) component first
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
          project,
        );
      }
      continue;
    }

    // Also check for arrow function components in the same file
    const localArrow = findLocalArrowComponent(sourceFile, name);
    if (localArrow) {
      const localParsed = parseComponent(sourceFile, name);
      if (localParsed && localParsed.jsxRoots.length > 0) {
        extractFromRoots(
          localParsed.jsxRoots,
          sourceFile,
          routeComponentName,
          result,
          visited,
          depth,
          project,
        );
      }
      continue;
    }

    // 2. Try imported component (cross-file) via ts-morph project
    if (project) {
      const resolved = resolveComponent(
        name,
        sourceFile,
        project,
        depth,
        0,
        new Set(visited),
      );
      if (resolved) {
        extractFromResolved(resolved, routeComponentName, result, visited, depth, project);
      }
    }
  }
}

/**
 * Extract elements from a resolved (imported) component and its children.
 */
function extractFromResolved(
  component: ResolvedComponent,
  routeComponentName: string,
  result: ExtractedElement[],
  visited: Set<string>,
  depth: number,
  project?: Project,
): void {
  const parsed = parseComponent(component.sourceFile, component.name);
  if (parsed && parsed.jsxRoots.length > 0) {
    // Extract elements directly from this component's JSX
    const elements = extractElementsFromRoots(parsed.jsxRoots);
    const filtered = elements.filter(
      (el) => !isRouteComponent(el, routeComponentName),
    );
    result.push(...filtered);

    // Follow children recursively
    if (depth > 0) {
      for (const root of parsed.jsxRoots) {
        followComponents(
          root,
          component.sourceFile,
          routeComponentName,
          result,
          visited,
          depth - 1,
          project,
        );
      }
    }
  }

  // Also process resolved children
  for (const child of component.children) {
    if (visited.has(child.name)) continue;
    visited.add(child.name);
    extractFromResolved(child, routeComponentName, result, visited, depth - 1, project);
  }
}

/**
 * Collect all PascalCase component names from a JSX subtree.
 */
function collectComponentNames(jsxNode: Node): Set<string> {
  const names = new Set<string>();

  const addIfComponent = (tagText: string) => {
    if (/^[A-Z]/.test(tagText) && !tagText.includes(".")) {
      names.add(tagText);
    }
  };

  // The node itself
  if (jsxNode.getKind() === SyntaxKind.JsxSelfClosingElement) {
    addIfComponent((jsxNode as any).getTagNameNode().getText());
  } else if (jsxNode.getKind() === SyntaxKind.JsxElement) {
    addIfComponent(
      (jsxNode as any).getOpeningElement().getTagNameNode().getText(),
    );
  }

  // Descendants
  for (const el of jsxNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
    addIfComponent(el.getTagNameNode().getText());
  }
  for (const el of jsxNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)) {
    addIfComponent(el.getTagNameNode().getText());
  }

  return names;
}

/**
 * Find arrow function component declarations in a file.
 */
function findLocalArrowComponent(
  sourceFile: SourceFile,
  name: string,
): boolean {
  for (const stmt of sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      if (decl.getName() === name) {
        const init = decl.getInitializer();
        if (init?.getKind() === SyntaxKind.ArrowFunction) return true;
      }
    }
  }
  return false;
}

/**
 * Extract global element queries (just the ElementQuery[], without metadata).
 */
export function extractGlobalElementQueries(
  appShellFile: SourceFile,
  routeComponentName: string,
  project?: Project,
): ElementQuery[] {
  const layout = extractGlobalLayout(appShellFile, routeComponentName, project);
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
 * Get function bodies from ALL functions in a source file.
 * Includes both exported and non-exported functions, since local
 * component functions (e.g., AppContent) may contain conditional guards.
 */
function getAllFunctionBodies(sourceFile: SourceFile): Node[] {
  const bodies: Node[] = [];
  for (const fn of sourceFile.getFunctions()) {
    const body = fn.getBody();
    if (body) bodies.push(body);
  }
  for (const varStmt of sourceFile.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init?.getKind() === SyntaxKind.ArrowFunction) {
        const body = (init as ArrowFunction).getBody();
        if (body) bodies.push(body);
      }
    }
  }
  return bodies;
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
function extractEarlyReturnBranches(
  sourceFile: SourceFile,
  project?: Project,
  maxDepth?: number,
): AppBranch[] {
  const branches: AppBranch[] = [];
  const bodies = getAllFunctionBodies(sourceFile);

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

      // If no elements found (e.g., return <LoginScreen />), follow the
      // component reference to extract its internal elements.
      if (elements.length === 0 && project) {
        const componentNames = collectComponentNames(returnExpr);
        for (const name of componentNames) {
          const resolved = resolveComponent(name, sourceFile, project, maxDepth ?? 5);
          if (resolved) {
            const parsed = parseComponent(resolved.sourceFile, resolved.name);
            if (parsed) {
              elements.push(...extractElementsFromRoots(parsed.jsxRoots));
            }
          }
        }
      }

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
