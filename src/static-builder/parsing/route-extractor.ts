/**
 * Route extractor — parses a switch-based route file to extract
 * route ID -> JSX component mappings.
 *
 * Handles:
 * - Simple cases: `case "home": return <HomePage />;`
 * - Fall-through cases: `case "a": case "b": return <SharedPage />;`
 * - Fragment wrappers: `case "x": return <><PageReg /><Content /></>;`
 * - Null returns (skipped): `default: return null;`
 * - Block bodies: `case "y": { return <Page />; }`
 */

import {
  type SourceFile,
  type FunctionDeclaration,
  type VariableDeclaration,
  SyntaxKind,
  type SwitchStatement,
  type CaseClause,
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxFragment,
  type ReturnStatement,
  type Node,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single extracted route entry. */
export interface RouteEntry {
  /** One or more route ID strings (fall-through cases share an entry). */
  caseValues: string[];
  /** The top-level JSX component tag names referenced in the return. */
  componentNames: string[];
  /** The full return expression source text. */
  returnSource: string;
  /** Line number of the case clause in the source file. */
  line: number;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract route entries from a switch-based route file.
 *
 * Finds the named function, locates the switch statement on the specified
 * discriminant, and extracts each case clause's route ID(s) and returned
 * JSX component(s).
 *
 * @param sourceFile - The parsed source file containing the route function.
 * @param functionName - Name of the function/component (e.g., "TabContent").
 * @param discriminant - Name of the switch variable (e.g., "activeTab").
 * @returns Array of route entries, one per case body (fall-throughs merged).
 */
export function extractRoutes(
  sourceFile: SourceFile,
  functionName: string,
  discriminant: string,
): RouteEntry[] {
  const fn = findFunction(sourceFile, functionName);
  if (!fn) {
    throw new Error(
      `Function "${functionName}" not found in ${sourceFile.getFilePath()}`,
    );
  }

  const switchStmt = findSwitch(fn, discriminant);
  if (!switchStmt) {
    throw new Error(
      `No switch statement on "${discriminant}" found in "${functionName}"`,
    );
  }

  return extractCases(switchStmt);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Find a function or arrow-function variable declaration by name.
 */
function findFunction(
  sourceFile: SourceFile,
  name: string,
): FunctionDeclaration | VariableDeclaration | undefined {
  // Try regular function declaration first
  const fnDecl = sourceFile.getFunction(name);
  if (fnDecl) return fnDecl;

  // Try variable declaration (const Foo = (...) => { ... })
  const varDecl = sourceFile.getVariableDeclaration(name);
  if (varDecl) return varDecl;

  return undefined;
}

/**
 * Find a switch statement whose expression matches the discriminant name.
 * Searches the function body (and nested arrow functions for variable decls).
 */
function findSwitch(
  fn: FunctionDeclaration | VariableDeclaration,
  discriminant: string,
): SwitchStatement | undefined {
  // Get the body node — for variable declarations, get the initializer
  const body =
    fn.getKind() === SyntaxKind.FunctionDeclaration
      ? (fn as FunctionDeclaration).getBody()
      : (fn as VariableDeclaration).getInitializer();

  if (!body) return undefined;

  const switches = body.getDescendantsOfKind(SyntaxKind.SwitchStatement);

  for (const sw of switches) {
    const expr = sw.getExpression();
    // Match direct identifier: switch (activeTab)
    if (
      expr.getKind() === SyntaxKind.Identifier &&
      expr.getText() === discriminant
    ) {
      return sw;
    }
    // Match property access: switch (props.activeTab)
    if (
      expr.getKind() === SyntaxKind.PropertyAccessExpression &&
      expr.getText().endsWith(`.${discriminant}`)
    ) {
      return sw;
    }
  }

  return undefined;
}

/**
 * Extract RouteEntry[] from a switch statement's case clauses.
 *
 * Handles fall-through by accumulating case values until a clause
 * with a return statement is found.
 */
function extractCases(switchStmt: SwitchStatement): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const clauses = switchStmt.getClauses();

  let pendingValues: string[] = [];
  let pendingLine = 0;

  for (const clause of clauses) {
    // Default clause: skip (typically returns null)
    if (clause.getKind() === SyntaxKind.DefaultClause) {
      pendingValues = [];
      continue;
    }

    const caseClause = clause as CaseClause;
    const expr = caseClause.getExpression();

    // Extract the string literal value
    if (expr && expr.getKind() === SyntaxKind.StringLiteral) {
      const value = expr.getText().slice(1, -1); // strip quotes
      if (pendingValues.length === 0) {
        pendingLine = caseClause.getStartLineNumber();
      }
      pendingValues.push(value);
    }

    // Check if this clause has a return statement (not a fall-through)
    const returnStmt = findReturn(caseClause);
    if (!returnStmt) continue; // fall-through: accumulate and continue

    const returnExpr = returnStmt.getExpression();
    if (!returnExpr || isNullReturn(returnExpr)) {
      // null/undefined return — skip this route
      pendingValues = [];
      continue;
    }

    const componentNames = extractComponentNames(returnExpr);
    const returnSource = returnExpr.getText();

    if (pendingValues.length > 0) {
      entries.push({
        caseValues: [...pendingValues],
        componentNames,
        returnSource,
        line: pendingLine,
      });
    }

    pendingValues = [];
  }

  return entries;
}

/**
 * Find the first return statement in a case clause.
 * Handles both direct returns and block-scoped returns.
 */
function findReturn(clause: CaseClause): ReturnStatement | undefined {
  // Direct child statements
  for (const stmt of clause.getStatements()) {
    if (stmt.getKind() === SyntaxKind.ReturnStatement) {
      return stmt as ReturnStatement;
    }
    // Block: { return ...; }
    if (stmt.getKind() === SyntaxKind.Block) {
      const blockReturns = stmt.getDescendantsOfKind(
        SyntaxKind.ReturnStatement,
      );
      const blockReturn = blockReturns.length > 0 ? blockReturns[0] : undefined;
      if (blockReturn) return blockReturn;
    }
  }
  return undefined;
}

/** Check if a return expression is null or undefined. */
function isNullReturn(expr: Node): boolean {
  const text = expr.getText().trim();
  return text === "null" || text === "undefined";
}

/**
 * Extract top-level JSX component names from a return expression.
 *
 * Handles:
 * - `<Component />` -> ["Component"]
 * - `<><A /><B /></>` -> ["A", "B"]
 * - `<Wrapper><Child /></Wrapper>` -> ["Wrapper"]
 * - Parenthesized expressions: `(<Component />)` -> ["Component"]
 */
function extractComponentNames(expr: Node): string[] {
  const names: string[] = [];

  // Unwrap parenthesized expressions
  let node = expr;
  while (node.getKind() === SyntaxKind.ParenthesizedExpression) {
    const inner = node.getChildAtIndex(1); // skip the opening paren
    if (inner) node = inner;
    else break;
  }

  // JsxSelfClosingElement: <Component />
  if (node.getKind() === SyntaxKind.JsxSelfClosingElement) {
    const tagName = getJsxTagName(node as JsxSelfClosingElement);
    if (tagName && isComponentName(tagName)) names.push(tagName);
    return names;
  }

  // JsxElement: <Component>...</Component> or <div>...<Component />...</div>
  if (node.getKind() === SyntaxKind.JsxElement) {
    const tagName = (node as JsxElement)
      .getOpeningElement()
      .getTagNameNode()
      .getText();

    if (isComponentName(tagName) && !isWrapperTag(tagName)) {
      names.push(tagName);
      return names;
    }

    // Wrapper element (HTML div, Suspense, ErrorBoundary, etc.):
    // search children for the actual content components.
    for (const child of (node as JsxElement).getJsxChildren()) {
      if (child.getKind() === SyntaxKind.JsxSelfClosingElement) {
        const childTag = getJsxTagName(child as JsxSelfClosingElement);
        if (childTag && isComponentName(childTag)) names.push(childTag);
      } else if (child.getKind() === SyntaxKind.JsxElement) {
        const childTag = (child as JsxElement)
          .getOpeningElement()
          .getTagNameNode()
          .getText();
        if (isComponentName(childTag)) names.push(childTag);
      }
    }
    return names;
  }

  // JsxFragment: <>...</>
  if (node.getKind() === SyntaxKind.JsxFragment) {
    const fragment = node as JsxFragment;
    for (const child of fragment.getJsxChildren()) {
      if (child.getKind() === SyntaxKind.JsxSelfClosingElement) {
        const tagName = getJsxTagName(child as JsxSelfClosingElement);
        if (tagName && isComponentName(tagName)) names.push(tagName);
      } else if (child.getKind() === SyntaxKind.JsxElement) {
        const tagName = (child as JsxElement)
          .getOpeningElement()
          .getTagNameNode()
          .getText();
        if (isComponentName(tagName)) names.push(tagName);
      }
    }
    return names;
  }

  // Fallback: search all JSX descendants
  const jsxElements = node.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  );
  for (const el of jsxElements) {
    const tagName = getJsxTagName(el);
    if (tagName && isComponentName(tagName)) names.push(tagName);
  }

  return names;
}

/** Get the tag name from a self-closing JSX element. */
function getJsxTagName(el: JsxSelfClosingElement): string {
  return el.getTagNameNode().getText();
}

/** Check if a tag name is a component (starts with uppercase). */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Check if a tag is a known wrapper that should be traversed through
 * to find the actual content components.
 */
const WRAPPER_TAGS = new Set([
  "Suspense",
  "React.Suspense",
  "ErrorBoundary",
  "StrictMode",
  "React.StrictMode",
]);

function isWrapperTag(name: string): boolean {
  return WRAPPER_TAGS.has(name);
}
