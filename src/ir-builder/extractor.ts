/**
 * IR extractor — walks a TSX source file and pulls `<State>` and
 * `<TransitionTo>` JSX declarations out into a neutral, IR-shaping-ready
 * structure.
 *
 * Composes with `static-builder/parsing/source-loader.ts` (`loadProject`) and
 * mirrors the ts-morph idioms used in `static-builder/parsing/component-parser.ts`.
 *
 * Limitations (v1):
 * - Only literal-prop forms are extracted. Computed expressions (e.g.
 *   `name={getName()}`) are recorded with the sentinel `__unsupported__` so
 *   the emitter can warn and omit the field from IR output.
 * - Nested `<State>` declarations are emitted FLAT — every state is
 *   self-contained by its id. v1 does not encode parent/child hierarchy.
 * - JSX spread attributes (`<State {...props} />`) are surfaced as a single
 *   `__spread__` entry on the props record so the caller can decide how to
 *   handle them; the default emitter treats spread as unsupported and warns.
 */

import {
  type SourceFile,
  type Node,
  type JsxElement,
  type JsxSelfClosingElement,
  type JsxAttribute,
  type JsxAttributeLike,
  type JsxOpeningElement,
  SyntaxKind,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Sentinel marker for a JSX prop value that the v1 extractor cannot resolve. */
export const UNSUPPORTED_PROP = "__unsupported__" as const;

/**
 * A v1-unsupported computed prop — e.g. `name={getName()}`. Surfaced so the
 * emitter can issue a build warning instead of silently dropping the prop.
 */
export interface UnsupportedPropMarker {
  readonly __unsupported__: true;
  /** Source text of the offending expression (truncated to ~80 chars). */
  expression: string;
  /** Line number in the source file (1-based). */
  line: number;
}

/**
 * A single extracted `<State>` or `<TransitionTo>` declaration.
 *
 * `props` is the raw prop bag — keys map 1:1 to JSX attribute names. Values
 * are either literal JS values (string, number, boolean, array, object), or
 * an {@link UnsupportedPropMarker} when the v1 extractor could not resolve
 * the expression at build time.
 */
export interface ExtractedDeclaration {
  /** Which wrapper this declaration came from. */
  kind: "state" | "transition";
  /** Raw prop values, before IR shaping. */
  props: Record<string, unknown>;
  /** Source file path (forward-slash normalized). */
  file: string;
  /** Line number of the JSX opening element (1-based). */
  line: number;
  /** Column of the JSX opening element (1-based). */
  column?: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Walk a TSX source file and extract every `<State>` / `<TransitionTo>`
 * declaration (including the qualified `<UIBridge.State>` / `<UIBridge.TransitionTo>` forms).
 *
 * The extractor is structural and does not require the wrapper to be
 * imported from a specific module — it matches purely on the JSX tag name.
 * That keeps the build plugin decoupled from the SDK's package layout while
 * still being precise enough for IR emission.
 */
export function extractIRDeclarations(
  sourceFile: SourceFile,
): ExtractedDeclaration[] {
  const filePath = sourceFile.getFilePath().replace(/\\/g, "/");

  // ts-morph exposes both `JsxElement` (with children) and
  // `JsxSelfClosingElement` (no children) — gather both kinds.
  const elements: Array<{
    opening: JsxOpeningElement | JsxSelfClosingElement;
    node: Node;
  }> = [];

  for (const el of sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement)) {
    elements.push({ opening: (el as JsxElement).getOpeningElement(), node: el });
  }
  for (const el of sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  )) {
    elements.push({ opening: el, node: el });
  }

  const decls: ExtractedDeclaration[] = [];

  for (const { opening, node } of elements) {
    const tagName = opening.getTagNameNode().getText();
    const kind = classifyTagName(tagName);
    if (!kind) continue;

    const start = node.getStart();
    const sf = node.getSourceFile();
    const { line, column } = sf.getLineAndColumnAtPos(start);

    decls.push({
      kind,
      props: extractAttributes(opening.getAttributes()),
      file: filePath,
      line,
      column,
    });
  }

  return decls;
}

// ---------------------------------------------------------------------------
// Tag classification
// ---------------------------------------------------------------------------

/**
 * Recognize `<State>`, `<TransitionTo>`, and the qualified `<UIBridge.X>`
 * variants. Returns the IR kind, or `undefined` when the tag isn't a
 * UI Bridge wrapper.
 */
function classifyTagName(tagName: string): "state" | "transition" | undefined {
  // Strip namespace qualifier (e.g., "UIBridge.State" -> "State").
  const last = tagName.includes(".")
    ? tagName.slice(tagName.lastIndexOf(".") + 1)
    : tagName;
  if (last === "State") return "state";
  if (last === "TransitionTo") return "transition";
  return undefined;
}

// ---------------------------------------------------------------------------
// Attribute extraction
// ---------------------------------------------------------------------------

/**
 * Walk a JSX attribute list and produce a plain prop bag. Spread attributes
 * are surfaced via a `__spread__: UnsupportedPropMarker` slot — the emitter
 * decides whether to warn or accept.
 */
function extractAttributes(
  attrs: JsxAttributeLike[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const attr of attrs) {
    const kind = attr.getKind();

    if (kind === SyntaxKind.JsxSpreadAttribute) {
      const text = truncate(attr.getText(), 80);
      const { line } = attr.getSourceFile().getLineAndColumnAtPos(attr.getStart());
      out.__spread__ = mkUnsupported(text, line);
      continue;
    }

    if (kind !== SyntaxKind.JsxAttribute) continue;
    const jsxAttr = attr as JsxAttribute;
    const nameNode = jsxAttr.getNameNode();
    const name = nameNode.getText();

    out[name] = readAttributeValue(jsxAttr);
  }

  return out;
}

/**
 * Read a single JSX attribute's value. Boolean shorthand
 * (`<State isInitial />`) → `true`. String literals → string. Numeric / bool
 * / object / array literals inside `{}` → resolved JS value. Anything else →
 * an {@link UnsupportedPropMarker}.
 */
function readAttributeValue(attr: JsxAttribute): unknown {
  const initializer = attr.getInitializer();

  // Shorthand: `<State isInitial />` — the prop is implicitly `true`.
  if (!initializer) return true;

  const initKind = initializer.getKind();

  // String literal: `name="Login"`
  if (initKind === SyntaxKind.StringLiteral) {
    const value = (initializer as { getLiteralValue?: () => string })
      .getLiteralValue?.();
    return value ?? unquote(initializer.getText());
  }

  // Expression in braces: `prop={...}`
  if (initKind === SyntaxKind.JsxExpression) {
    const expr = (initializer as { getExpression?: () => Node | undefined })
      .getExpression?.();
    if (!expr) {
      // Empty braces: `prop={}` — treat as undefined (caller drops).
      return undefined;
    }
    return readExpressionValue(expr);
  }

  // Anything else (rare) — surface as unsupported.
  return mkUnsupportedFromNode(initializer as Node);
}

/**
 * Try to fold a JSX expression into a plain JS literal. Recognizes:
 * string / number / boolean / null / array / object literal forms (and any
 * nesting of those). Anything dynamic (identifier, call, member access)
 * becomes an {@link UnsupportedPropMarker}.
 */
function readExpressionValue(node: Node): unknown {
  const kind = node.getKind();

  switch (kind) {
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return (node as { getLiteralValue?: () => string }).getLiteralValue?.()
        ?? unquote(node.getText());

    case SyntaxKind.NumericLiteral:
      return Number(node.getText());

    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;

    case SyntaxKind.PrefixUnaryExpression: {
      // Only fold simple negative numerics (`-1`, `-2.5`).
      const operand = (node as unknown as { getOperand: () => Node }).getOperand();
      const op = (node as unknown as { getOperatorToken: () => number }).getOperatorToken();
      if (
        op === SyntaxKind.MinusToken &&
        operand.getKind() === SyntaxKind.NumericLiteral
      ) {
        return -Number(operand.getText());
      }
      return mkUnsupportedFromNode(node);
    }

    case SyntaxKind.ArrayLiteralExpression: {
      const elements = (node as unknown as {
        getElements: () => Node[];
      }).getElements();
      return elements.map((el) => readExpressionValue(el));
    }

    case SyntaxKind.ObjectLiteralExpression: {
      const properties = (node as unknown as {
        getProperties: () => Node[];
      }).getProperties();
      const obj: Record<string, unknown> = {};
      let unsupported = false;
      for (const prop of properties) {
        const propKind = prop.getKind();
        if (propKind === SyntaxKind.PropertyAssignment) {
          const nameNode = (prop as unknown as { getNameNode: () => Node })
            .getNameNode();
          const valueNode = (prop as unknown as {
            getInitializer: () => Node | undefined;
          }).getInitializer();
          const key = readPropertyKey(nameNode);
          if (!key || !valueNode) {
            unsupported = true;
            break;
          }
          obj[key] = readExpressionValue(valueNode);
        } else if (propKind === SyntaxKind.ShorthandPropertyAssignment) {
          // Shorthand `{ x }` is dynamic — we can't capture the value at build time.
          unsupported = true;
          break;
        } else {
          // Spreads, methods, getters, setters — all dynamic.
          unsupported = true;
          break;
        }
      }
      if (unsupported) return mkUnsupportedFromNode(node);
      return obj;
    }

    case SyntaxKind.ParenthesizedExpression: {
      const inner = (node as unknown as {
        getExpression: () => Node;
      }).getExpression();
      return readExpressionValue(inner);
    }

    case SyntaxKind.AsExpression:
    case SyntaxKind.TypeAssertionExpression: {
      // Strip type assertions: `[...] as const`, `<T>x`.
      const inner = (node as unknown as {
        getExpression: () => Node;
      }).getExpression();
      return readExpressionValue(inner);
    }

    default:
      return mkUnsupportedFromNode(node);
  }
}

/**
 * Read the key of an object-literal property. Identifier, string-literal,
 * and numeric-literal keys are all stringified. Computed keys
 * (`[expr]: ...`) are unsupported.
 */
function readPropertyKey(nameNode: Node): string | undefined {
  const kind = nameNode.getKind();
  if (kind === SyntaxKind.Identifier) return nameNode.getText();
  if (kind === SyntaxKind.StringLiteral) {
    return (nameNode as { getLiteralValue?: () => string }).getLiteralValue?.()
      ?? unquote(nameNode.getText());
  }
  if (kind === SyntaxKind.NumericLiteral) return nameNode.getText();
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkUnsupportedFromNode(node: Node): UnsupportedPropMarker {
  const text = truncate(node.getText(), 80);
  const { line } = node.getSourceFile().getLineAndColumnAtPos(node.getStart());
  return mkUnsupported(text, line);
}

function mkUnsupported(expression: string, line: number): UnsupportedPropMarker {
  return { __unsupported__: true, expression, line };
}

/** True iff the value is an {@link UnsupportedPropMarker}. */
export function isUnsupportedProp(
  value: unknown,
): value is UnsupportedPropMarker {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { __unsupported__?: unknown }).__unsupported__ === true
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function unquote(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}
