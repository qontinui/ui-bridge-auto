/**
 * Handler tracer — finds event handler props (onClick, onSubmit, etc.)
 * on JSX elements and resolves their function bodies.
 *
 * Follows function references through up to 3 hops of indirection:
 * 1. Inline arrow: onClick={() => doSomething()}
 * 2. Function reference: onClick={handleClick} -> function handleClick() { ... }
 * 3. Prop callback: onNavigate={navigateToX} -> const navigateToX = () => setActiveTab("x")
 */

import {
  type SourceFile,
  type Node,
  SyntaxKind,
  type CallExpression,
} from "ts-morph";
import type { ElementQuery } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A traced event handler from a JSX element. */
export interface TracedHandler {
  /** The element that has the handler. */
  elementQuery: ElementQuery;
  /** The event type (click, submit, change, etc.). */
  eventType: string;
  /** The handler function body source text. */
  handlerSource: string;
  /** Call expressions found in the handler body. */
  calls: TracedCall[];
  /** Line number of the handler in source. */
  line: number;
  /** Source file path. */
  sourceFile: string;
}

/** A function call found inside a handler body. */
export interface TracedCall {
  /** The full call expression text. */
  callText: string;
  /** The function name being called. */
  functionName: string;
  /** String literal arguments (if any). */
  stringArgs: string[];
  /** Line number. */
  line: number;
}

/** Event prop names to trace. */
const EVENT_PROPS = new Set([
  "onClick",
  "onSubmit",
  "onChange",
  "onDoubleClick",
  "onKeyDown",
  "onKeyPress",
  "onKeyUp",
  "onFocus",
  "onBlur",
  "onMouseDown",
  "onMouseUp",
]);

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

/**
 * Trace event handlers in a JSX tree.
 *
 * Finds all elements with event handler props, resolves the handler
 * function body, and extracts the call expressions within.
 *
 * @param jsxRoot - JSX root node to scan.
 * @param sourceFile - Source file for resolving function references.
 * @param maxHops - Maximum indirection depth to follow (default 3).
 * @returns Array of traced handlers with their calls.
 */
export function traceHandlers(
  jsxRoot: Node,
  sourceFile: SourceFile,
  maxHops: number = 3,
): TracedHandler[] {
  const handlers: TracedHandler[] = [];

  // Find all JSX attributes that are event handlers
  const jsxAttrs = jsxRoot.getDescendantsOfKind(SyntaxKind.JsxAttribute);

  for (const attr of jsxAttrs) {
    const name = attr.getNameNode().getText();
    if (!EVENT_PROPS.has(name)) continue;

    const initializer = attr.getInitializer();
    if (!initializer) continue;

    // Get the element this handler is on
    const elementQuery = buildElementQueryFromParent(attr);
    const eventType = name.replace(/^on/, "").toLowerCase();

    // Resolve the handler body
    const handlerNode = resolveHandlerExpression(
      initializer,
      sourceFile,
      maxHops,
    );
    if (!handlerNode) continue;

    const calls = extractCalls(handlerNode, sourceFile, maxHops);

    handlers.push({
      elementQuery,
      eventType: eventType,
      handlerSource: handlerNode.getText(),
      calls,
      line: attr.getStartLineNumber(),
      sourceFile: sourceFile.getFilePath(),
    });
  }

  return handlers;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Build a minimal ElementQuery from the parent JSX element of an attribute.
 */
function buildElementQueryFromParent(attrNode: Node): ElementQuery {
  const query: ElementQuery = {};

  // Walk up to find the JSX element
  let current = attrNode.getParent(); // JsxAttributes
  if (current) current = current.getParent(); // JsxOpeningElement or JsxSelfClosingElement

  if (!current) return query;

  const allAttrs = current.getDescendantsOfKind(SyntaxKind.JsxAttribute);
  for (const a of allAttrs) {
    // Only direct attributes
    const parent = a.getParent();
    if (parent?.getParent() !== current) continue;

    const name = a.getNameNode().getText();
    const init = a.getInitializer();
    const value = init
      ? init.getKind() === SyntaxKind.StringLiteral
        ? init.getText().slice(1, -1)
        : undefined
      : undefined;

    if (name === "role" && value) query.role = value;
    if (name === "aria-label" && value) query.ariaLabel = value;
    if (name === "id" && value) query.id = value;
  }

  // Get tag name
  const tagNameNode = current.getChildAtIndex(1); // after <
  if (tagNameNode) {
    const tagName = tagNameNode.getText();
    if (tagName === tagName.toLowerCase()) {
      query.tagName = tagName;
    }
  }

  // Get text content if it's a full JsxElement
  const grandparent = current.getParent();
  if (grandparent?.getKind() === SyntaxKind.JsxElement) {
    const textChildren = grandparent.getDescendantsOfKind(SyntaxKind.JsxText);
    for (const tc of textChildren) {
      // Only direct text children
      if (tc.getParent() === grandparent) {
        const text = tc.getText().trim();
        if (text) {
          query.text = text;
          break;
        }
      }
    }
  }

  return query;
}

/**
 * Resolve a handler expression to its function body.
 * Follows references through function names and variable declarations.
 */
function resolveHandlerExpression(
  node: Node,
  sourceFile: SourceFile,
  hopsRemaining: number,
): Node | undefined {
  if (hopsRemaining <= 0) return undefined;

  // JsxExpression: { expr }
  if (node.getKind() === SyntaxKind.JsxExpression) {
    const children = node.getChildren();
    const inner = children.length >= 2 ? children[1] : undefined;
    if (inner)
      return resolveHandlerExpression(inner, sourceFile, hopsRemaining);
    return undefined;
  }

  // Arrow function: () => { ... } or () => expr
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node;
  }

  // Function expression: function() { ... }
  if (node.getKind() === SyntaxKind.FunctionExpression) {
    return node;
  }

  // Identifier: handleClick -> resolve to declaration
  if (node.getKind() === SyntaxKind.Identifier) {
    const name = node.getText();
    return resolveIdentifier(name, sourceFile, hopsRemaining - 1);
  }

  // Call expression: might be wrapping a handler (e.g., useCallback(...))
  if (node.getKind() === SyntaxKind.CallExpression) {
    return node;
  }

  return node;
}

/**
 * Resolve an identifier to its function body.
 * Searches both top-level and local (inside function components) declarations.
 */
function resolveIdentifier(
  name: string,
  sourceFile: SourceFile,
  hopsRemaining: number,
): Node | undefined {
  if (hopsRemaining <= 0) return undefined;

  // Try top-level variable declaration first
  let varDecl = sourceFile.getVariableDeclaration(name);

  // If not found at top level, search all variable declarations in the file
  if (!varDecl) {
    const allVarDecls = sourceFile.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    );
    varDecl = allVarDecls.find((d) => d.getName() === name) ?? undefined;
  }

  if (varDecl) {
    const init = varDecl.getInitializer();
    if (init) {
      // If it's an arrow function or function expression, return it
      if (
        init.getKind() === SyntaxKind.ArrowFunction ||
        init.getKind() === SyntaxKind.FunctionExpression
      ) {
        return init;
      }
      // If it's a call (e.g., useCallback(() => {...})), extract the first arg
      if (init.getKind() === SyntaxKind.CallExpression) {
        const callExpr = init as CallExpression;
        const callName = callExpr.getExpression().getText();
        if (callName === "useCallback" || callName === "useMemo") {
          const args = callExpr.getArguments();
          if (args.length > 0) {
            return resolveHandlerExpression(
              args[0],
              sourceFile,
              hopsRemaining - 1,
            );
          }
        }
        return init;
      }
      return resolveHandlerExpression(init, sourceFile, hopsRemaining - 1);
    }
  }

  // Try function declaration
  const fnDecl = sourceFile.getFunction(name);
  if (fnDecl) {
    return fnDecl.getBody() ?? fnDecl;
  }

  return undefined;
}

/**
 * Extract call expressions from a handler body.
 * Follows one level of indirection for called functions.
 */
function extractCalls(
  handlerNode: Node,
  sourceFile: SourceFile,
  hopsRemaining: number,
): TracedCall[] {
  const calls: TracedCall[] = [];

  const callExprs = handlerNode.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of callExprs) {
    const expr = call.getExpression();
    const functionName = expr.getText();
    const args = call.getArguments();
    const stringArgs: string[] = [];

    for (const arg of args) {
      if (arg.getKind() === SyntaxKind.StringLiteral) {
        stringArgs.push(arg.getText().slice(1, -1));
      }
    }

    calls.push({
      callText: call.getText(),
      functionName,
      stringArgs,
      line: call.getStartLineNumber(),
    });

    // Follow one more hop if the called function is local
    if (hopsRemaining > 1 && stringArgs.length === 0) {
      const resolved = resolveIdentifier(
        functionName,
        sourceFile,
        hopsRemaining - 1,
      );
      if (resolved) {
        const nestedCalls = extractCalls(
          resolved,
          sourceFile,
          hopsRemaining - 1,
        );
        calls.push(...nestedCalls);
      }
    }
  }

  return calls;
}
