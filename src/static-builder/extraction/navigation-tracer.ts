/**
 * Navigation tracer — specializes handler tracing to identify
 * state transitions triggered by navigation function calls and
 * custom event dispatches.
 *
 * Detects:
 * - Direct: onClick={() => setActiveTab("settings")}
 * - Via reference: onClick={handleClick} where handleClick calls setActiveTab
 * - Prop callback: onNavigate={() => setActiveTab("active")}
 * - Custom event: window.dispatchEvent(new CustomEvent("navigate-to-active"))
 */

import { type SourceFile, type Node, SyntaxKind } from "ts-morph";
import {
  traceHandlers,
  type TracedHandler,
  type TracedCall,
} from "./handler-tracer";
import type { ElementQuery } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A traced navigation transition. */
export interface TracedTransition {
  /** The element that triggers this transition. */
  sourceElement: ElementQuery;
  /** The action type (click, submit, etc.). */
  action: string;
  /** The target state ID (e.g., the tab name). */
  targetState: string;
  /** How the transition was resolved. */
  mechanism: "direct" | "reference" | "event" | "uncertain";
  /** Source file and line for diagnostics. */
  sourceFile: string;
  line: number;
}

// ---------------------------------------------------------------------------
// Tracer
// ---------------------------------------------------------------------------

/**
 * Trace navigation transitions in a JSX tree.
 *
 * Finds event handlers that call navigation functions or dispatch
 * navigation events, and produces TracedTransition objects.
 *
 * @param jsxRoot - JSX root node to scan.
 * @param sourceFile - Source file for resolving function references.
 * @param navigationFunctions - Function names to look for (e.g., ["setActiveTab"]).
 * @param navigationEvents - Custom event names to match (e.g., ["navigate-to-active"]).
 * @returns Array of traced transitions.
 */
export function traceNavigationTransitions(
  jsxRoot: Node,
  sourceFile: SourceFile,
  navigationFunctions: string[],
  navigationEvents: string[] = [],
): TracedTransition[] {
  const transitions: TracedTransition[] = [];

  // Method 1: Trace through known event handler props (onClick, onSubmit, etc.)
  const handlers = traceHandlers(jsxRoot, sourceFile);
  for (const handler of handlers) {
    transitions.push(...matchNavigationCalls(handler, navigationFunctions));
    transitions.push(...matchCustomEvents(handler, navigationEvents));
  }

  // Method 2: Scan ALL JSX attribute arrow functions for navigation calls.
  // This catches prop callbacks like onNavigateToActive={() => setActiveTab("active")}
  // that aren't standard event handlers.
  const propTransitions = traceNavigationInAllProps(
    jsxRoot,
    sourceFile,
    navigationFunctions,
    navigationEvents,
  );
  transitions.push(...propTransitions);

  return deduplicateTransitions(transitions);
}

/**
 * Trace navigation transitions across all JSX roots of a component.
 */
export function traceNavigationInRoots(
  jsxRoots: Node[],
  sourceFile: SourceFile,
  navigationFunctions: string[],
  navigationEvents: string[] = [],
): TracedTransition[] {
  const all: TracedTransition[] = [];
  for (const root of jsxRoots) {
    all.push(
      ...traceNavigationTransitions(
        root,
        sourceFile,
        navigationFunctions,
        navigationEvents,
      ),
    );
  }
  return deduplicateTransitions(all);
}

// ---------------------------------------------------------------------------
// Prop scanning
// ---------------------------------------------------------------------------

/**
 * Scan ALL JSX attribute values for arrow functions containing navigation calls.
 *
 * This catches patterns like:
 *   <Component onNavigateToActive={() => setActiveTab("active")} />
 * where the prop name is not a standard event handler.
 */
function traceNavigationInAllProps(
  jsxRoot: Node,
  sourceFile: SourceFile,
  navigationFunctions: string[],
  navigationEvents: string[],
): TracedTransition[] {
  const transitions: TracedTransition[] = [];
  const navFnSet = new Set(navigationFunctions);
  const eventSet = new Set(navigationEvents);

  // Find all JSX attributes with arrow function values
  const jsxAttrs = jsxRoot.getDescendantsOfKind(SyntaxKind.JsxAttribute);

  for (const attr of jsxAttrs) {
    const propName = attr.getNameNode().getText();
    const init = attr.getInitializer();
    if (!init) continue;

    // Look inside JsxExpression for arrow functions
    if (init.getKind() !== SyntaxKind.JsxExpression) continue;

    const arrowFns = init.getDescendantsOfKind(SyntaxKind.ArrowFunction);
    for (const arrowFn of arrowFns) {
      // Find all call expressions inside the arrow function
      const calls = arrowFn.getDescendantsOfKind(SyntaxKind.CallExpression);

      for (const call of calls) {
        const fnName = extractBaseFunctionName(call.getExpression().getText());
        const args = call.getArguments();
        const stringArgs: string[] = [];
        for (const arg of args) {
          if (arg.getKind() === SyntaxKind.StringLiteral) {
            stringArgs.push(arg.getText().slice(1, -1));
          }
        }

        // Check for navigation function calls
        if (navFnSet.has(fnName) && stringArgs.length > 0) {
          transitions.push({
            sourceElement: buildPropSourceElement(attr, propName),
            action: "click",
            targetState: stringArgs[0],
            mechanism: "direct",
            sourceFile: sourceFile.getFilePath(),
            line: call.getStartLineNumber(),
          });
        }

        // Check for custom event dispatches
        if (fnName === "dispatchEvent") {
          const eventName = extractCustomEventName(call.getText());
          if (eventName && eventSet.has(eventName)) {
            transitions.push({
              sourceElement: buildPropSourceElement(attr, propName),
              action: "click",
              targetState: eventName,
              mechanism: "event",
              sourceFile: sourceFile.getFilePath(),
              line: call.getStartLineNumber(),
            });
          }
        }
      }
    }
  }

  return transitions;
}

/**
 * Build a source element query from the JSX element that owns the prop.
 * Includes the prop name as context for transition identification.
 */
function buildPropSourceElement(attr: Node, propName: string): ElementQuery {
  const query: ElementQuery = {};

  // Walk up: JsxAttribute -> JsxAttributes -> JsxOpeningElement/JsxSelfClosingElement
  const attrsNode = attr.getParent();
  const element = attrsNode?.getParent();
  if (!element) return query;

  // Get the component name as tag
  const tagNode = element.getChildAtIndex(1);
  if (tagNode) {
    const tagName = tagNode.getText();
    // For component props, store the component name and prop as attributes
    query.attributes = { "data-nav-prop": propName };
    if (tagName !== tagName.toLowerCase()) {
      // React component — store as semantic info
      query.attributes["data-component"] = tagName;
    } else {
      query.tagName = tagName;
    }
  }

  return query;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Match handler calls against navigation function names.
 *
 * Looks for patterns like:
 * - setActiveTab("settings") -> target = "settings", mechanism = "direct"
 * - via resolved reference -> mechanism = "reference"
 */
function matchNavigationCalls(
  handler: TracedHandler,
  navigationFunctions: string[],
): TracedTransition[] {
  const transitions: TracedTransition[] = [];
  const navFnSet = new Set(navigationFunctions);

  for (const call of handler.calls) {
    const fnName = extractBaseFunctionName(call.functionName);

    if (navFnSet.has(fnName) && call.stringArgs.length > 0) {
      const targetState = call.stringArgs[0];

      // Determine mechanism: direct if the call is in the handler source directly
      const isDirect = handler.handlerSource.includes(call.callText);

      transitions.push({
        sourceElement: handler.elementQuery,
        action: handler.eventType,
        targetState,
        mechanism: isDirect ? "direct" : "reference",
        sourceFile: handler.sourceFile,
        line: handler.line,
      });
    }
  }

  return transitions;
}

/**
 * Match handler calls against custom event dispatch patterns.
 *
 * Looks for: window.dispatchEvent(new CustomEvent("navigate-to-active"))
 */
function matchCustomEvents(
  handler: TracedHandler,
  navigationEvents: string[],
): TracedTransition[] {
  if (navigationEvents.length === 0) return [];

  const transitions: TracedTransition[] = [];
  const eventSet = new Set(navigationEvents);

  for (const call of handler.calls) {
    // Match dispatchEvent or window.dispatchEvent
    const fnName = extractBaseFunctionName(call.functionName);
    if (fnName !== "dispatchEvent") continue;

    // Look for CustomEvent constructor in the call text
    const eventName = extractCustomEventName(call.callText);
    if (eventName && eventSet.has(eventName)) {
      transitions.push({
        sourceElement: handler.elementQuery,
        action: handler.eventType,
        targetState: eventName,
        mechanism: "event",
        sourceFile: handler.sourceFile,
        line: call.line,
      });
    }
  }

  return transitions;
}

/**
 * Extract the base function name from a possibly qualified name.
 * "window.dispatchEvent" -> "dispatchEvent"
 * "props.onNavigate" -> "onNavigate"
 * "setActiveTab" -> "setActiveTab"
 */
function extractBaseFunctionName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

/**
 * Extract the event name from a CustomEvent constructor in a call expression.
 * 'window.dispatchEvent(new CustomEvent("navigate-to-active"))' -> "navigate-to-active"
 * 'window.dispatchEvent(new CustomEvent("nav", { detail: ... }))' -> "nav"
 */
function extractCustomEventName(callText: string): string | undefined {
  const match = callText.match(/new\s+CustomEvent\s*\(\s*["']([^"']+)["']/);
  return match ? match[1] : undefined;
}

/**
 * Deduplicate transitions by targetState + line.
 * The same navigation call at the same source line should only produce one transition,
 * even if discovered by both the handler tracer and the prop scanner.
 */
function deduplicateTransitions(
  transitions: TracedTransition[],
): TracedTransition[] {
  const seen = new Set<string>();
  const result: TracedTransition[] = [];

  for (const t of transitions) {
    const key = `${t.targetState}|${t.line}|${t.action}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }

  return result;
}
