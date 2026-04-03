/**
 * Component parser — extracts JSX structure, hooks, and props from a
 * single React component's source file.
 *
 * Used to gather the raw JSX nodes that the element extractor and
 * branch enumerator will process.
 */

import {
  type SourceFile,
  type Node,
  SyntaxKind,
  type FunctionDeclaration,
  type VariableDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxFragment,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed component data. */
export interface ParsedComponent {
  /** Component name. */
  name: string;
  /** The JSX nodes from the component's return statement(s). */
  jsxRoots: Node[];
  /** Hook calls found in the component body. */
  hooks: HookCall[];
  /** Props destructured or used by the component. */
  propNames: string[];
  /** Source file path. */
  filePath: string;
}

/** A React hook call found in the component. */
export interface HookCall {
  /** Hook name (e.g., "useState", "useModalState"). */
  name: string;
  /** Full call source text. */
  source: string;
  /** Line number. */
  line: number;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a React component from a source file.
 *
 * Finds the component function (by name or the first exported function),
 * extracts its return JSX, hook calls, and prop names.
 *
 * @param sourceFile - The source file to parse.
 * @param componentName - Optional specific component name to find.
 */
export function parseComponent(
  sourceFile: SourceFile,
  componentName?: string,
): ParsedComponent | undefined {
  const fn = componentName
    ? findComponentByName(sourceFile, componentName)
    : findDefaultComponent(sourceFile);

  if (!fn) return undefined;

  const name =
    componentName ??
    getNodeName(fn) ??
    sourceFile.getBaseNameWithoutExtension();
  const body = getBody(fn);
  if (!body) return undefined;

  return {
    name,
    jsxRoots: extractJsxRoots(body),
    hooks: extractHooks(body),
    propNames: extractPropNames(fn),
    filePath: sourceFile.getFilePath(),
  };
}

// ---------------------------------------------------------------------------
// Component finding
// ---------------------------------------------------------------------------

type ComponentNode = FunctionDeclaration | VariableDeclaration;

function findComponentByName(
  sourceFile: SourceFile,
  name: string,
): ComponentNode | undefined {
  const fnDecl = sourceFile.getFunction(name);
  if (fnDecl) return fnDecl;

  const varDecl = sourceFile.getVariableDeclaration(name);
  if (varDecl) return varDecl;

  return undefined;
}

/**
 * Find the first exported function component in the file.
 */
function findDefaultComponent(
  sourceFile: SourceFile,
): ComponentNode | undefined {
  // Try exported function declarations
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported() && fn.isDefaultExport()) return fn;
  }
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isExported()) return fn;
  }

  // Try exported variable declarations (arrow functions)
  for (const varStmt of sourceFile.getVariableStatements()) {
    if (varStmt.isExported()) {
      const decls = varStmt.getDeclarations();
      if (decls.length > 0) return decls[0];
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

function getBody(node: ComponentNode): Node | undefined {
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    return (node as FunctionDeclaration).getBody();
  }

  // Variable declaration — get the initializer (arrow or function expression)
  const init = (node as VariableDeclaration).getInitializer();
  if (!init) return undefined;

  if (init.getKind() === SyntaxKind.ArrowFunction) {
    return (init as ArrowFunction).getBody();
  }
  if (init.getKind() === SyntaxKind.FunctionExpression) {
    return (init as FunctionExpression).getBody();
  }

  return undefined;
}

function getNodeName(node: ComponentNode): string | undefined {
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    return (node as FunctionDeclaration).getName();
  }
  return (node as VariableDeclaration).getName();
}

// ---------------------------------------------------------------------------
// JSX extraction
// ---------------------------------------------------------------------------

/**
 * Extract top-level JSX nodes from return statements in the function body.
 */
function extractJsxRoots(body: Node): Node[] {
  const roots: Node[] = [];

  const returns = body.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  for (const ret of returns) {
    const expr = ret.getExpression();
    if (!expr) continue;

    const jsx = unwrapToJsx(expr);
    if (jsx) roots.push(jsx);
  }

  return roots;
}

/**
 * Unwrap parenthesized expressions to find the JSX node.
 */
function unwrapToJsx(node: Node): Node | undefined {
  let current = node;

  // Unwrap parenthesized expressions
  while (current.getKind() === SyntaxKind.ParenthesizedExpression) {
    const children = current.getChildren();
    // ParenthesizedExpression: ( expr )
    const inner = children.length >= 2 ? children[1] : undefined;
    if (!inner) break;
    current = inner;
  }

  const kind = current.getKind();
  if (
    kind === SyntaxKind.JsxElement ||
    kind === SyntaxKind.JsxSelfClosingElement ||
    kind === SyntaxKind.JsxFragment
  ) {
    return current;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Provider unwrapping
// ---------------------------------------------------------------------------

/**
 * Unwrap provider/wrapper components to expose the real layout children.
 *
 * In React apps, the actual UI is often deeply nested inside context providers:
 *   <ApolloProvider><AuthProvider><Layout>...</Layout></AuthProvider></ApolloProvider>
 *
 * This function recognizes wrapper patterns and returns the innermost
 * non-wrapper JSX children so element extraction can find the real UI.
 *
 * A component is considered a wrapper if:
 * - Its name ends with "Provider", "Context", "Wrapper", "Container", "Boundary"
 * - It has exactly one JSX child element (pass-through wrapper)
 * - It's a known wrapper (e.g., Suspense, ErrorBoundary, StrictMode)
 */
export function unwrapProviders(jsxRoot: Node, maxDepth: number = 20): Node[] {
  return unwrapRecursive(jsxRoot, maxDepth, 0);
}

function unwrapRecursive(node: Node, maxDepth: number, depth: number): Node[] {
  if (depth > maxDepth) return [node];

  const kind = node.getKind();

  // Fragment: unwrap all children
  if (kind === SyntaxKind.JsxFragment) {
    const fragment = node as JsxFragment;
    const results: Node[] = [];
    for (const child of fragment.getJsxChildren()) {
      const childKind = child.getKind();
      if (
        childKind === SyntaxKind.JsxElement ||
        childKind === SyntaxKind.JsxSelfClosingElement ||
        childKind === SyntaxKind.JsxFragment
      ) {
        results.push(...unwrapRecursive(child, maxDepth, depth + 1));
      }
    }
    return results.length > 0 ? results : [node];
  }

  // JsxElement: check if it's a wrapper
  if (kind === SyntaxKind.JsxElement) {
    const element = node as JsxElement;
    const tagName = element.getOpeningElement().getTagNameNode().getText();

    if (isWrapperComponent(tagName)) {
      // Get JSX children (skip whitespace/text)
      const jsxChildren = element.getJsxChildren().filter((c) => {
        const ck = c.getKind();
        return (
          ck === SyntaxKind.JsxElement ||
          ck === SyntaxKind.JsxSelfClosingElement ||
          ck === SyntaxKind.JsxFragment
        );
      });

      if (jsxChildren.length > 0) {
        const results: Node[] = [];
        for (const child of jsxChildren) {
          results.push(...unwrapRecursive(child, maxDepth, depth + 1));
        }
        return results;
      }
    }

    // Not a wrapper — this is a real UI node
    return [node];
  }

  // Self-closing elements are never wrappers (no children)
  return [node];
}

/** Common wrapper component name patterns. */
const WRAPPER_SUFFIXES = [
  "Provider",
  "Context",
  "Wrapper",
  "Container",
  "Boundary",
  "Guard",
  "Gate",
  "Layout",
];

const KNOWN_WRAPPERS = new Set([
  "Suspense",
  "ErrorBoundary",
  "StrictMode",
  "Fragment",
  "React.Suspense",
  "React.StrictMode",
  "React.Fragment",
]);

function isWrapperComponent(tagName: string): boolean {
  if (KNOWN_WRAPPERS.has(tagName)) return true;
  // HTML elements are never wrappers in this context
  if (tagName === tagName.toLowerCase()) return false;
  return WRAPPER_SUFFIXES.some((suffix) => tagName.endsWith(suffix));
}

// ---------------------------------------------------------------------------
// Hook extraction
// ---------------------------------------------------------------------------

/**
 * Extract hook calls from the component body.
 * Hooks are identified by the `use` prefix convention.
 */
function extractHooks(body: Node): HookCall[] {
  const hooks: HookCall[] = [];

  const calls = body.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of calls) {
    const expr = call.getExpression();
    const name = expr.getText();

    // Hooks start with "use" (useState, useEffect, useModalState, etc.)
    if (/^use[A-Z]/.test(name)) {
      hooks.push({
        name,
        source: call.getText(),
        line: call.getStartLineNumber(),
      });
    }
  }

  return hooks;
}

// ---------------------------------------------------------------------------
// Prop extraction
// ---------------------------------------------------------------------------

/**
 * Extract prop names from the component's parameter list.
 * Handles destructured props: `function Foo({ a, b }: Props)`
 */
function extractPropNames(node: ComponentNode): string[] {
  const names: string[] = [];

  let params: Node[] = [];
  if (node.getKind() === SyntaxKind.FunctionDeclaration) {
    params = (node as FunctionDeclaration).getParameters();
  } else {
    const init = (node as VariableDeclaration).getInitializer();
    if (init) {
      if (init.getKind() === SyntaxKind.ArrowFunction) {
        params = (init as ArrowFunction).getParameters();
      } else if (init.getKind() === SyntaxKind.FunctionExpression) {
        params = (init as FunctionExpression).getParameters();
      }
    }
  }

  for (const param of params) {
    // Destructured: { a, b, c }
    const bindings = param.getDescendantsOfKind(SyntaxKind.BindingElement);
    for (const binding of bindings) {
      names.push(binding.getName());
    }
  }

  return names;
}
