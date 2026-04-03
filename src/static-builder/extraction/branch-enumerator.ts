/**
 * Branch enumerator — finds conditional rendering in JSX and enumerates
 * all possible branch variants with their element sets.
 *
 * Key insight: we don't need to resolve conditions. We enumerate branches.
 * `{x ? <A/> : <B/>}` produces two variants with known element sets.
 * The state machine gets both as possible states.
 *
 * Handles:
 * - Ternary: `{cond ? <A/> : <B/>}` -> 2 variants
 * - Logical AND: `{cond && <C/>}` -> 2 variants (present / absent)
 * - Early return: `if (x) return <A/>; return <B/>` -> 2 variants
 * - Nested ternaries: `{a ? <X/> : b ? <Y/> : <Z/>}` -> 3 variants
 */

import { type Node, type ReturnStatement, SyntaxKind } from "ts-morph";
import { extractElements, type ExtractedElement } from "./element-extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single branch variant from conditional rendering. */
export interface BranchVariant {
  /** Human-readable label derived from the condition expression. */
  conditionLabel: string;
  /** Elements present when this branch is active. */
  elements: ExtractedElement[];
  /** Whether this is the default/else branch. */
  isDefault: boolean;
}

/** Result of branch enumeration for a component. */
export interface BranchEnumeration {
  /** Elements that are always present (outside any conditional). */
  unconditionalElements: ExtractedElement[];
  /** Branch groups — each group is a set of mutually exclusive variants. */
  branchGroups: BranchGroup[];
}

/** A group of mutually exclusive branch variants from one conditional. */
export interface BranchGroup {
  /** Source line of the conditional. */
  line: number;
  /** The variants in this group. */
  variants: BranchVariant[];
}

// ---------------------------------------------------------------------------
// Enumerator
// ---------------------------------------------------------------------------

/**
 * Enumerate conditional branches in a JSX tree.
 *
 * Walks the JSX looking for ternaries, logical AND/OR, and produces
 * BranchVariant arrays for each conditional found.
 *
 * @param jsxRoot - A JSX root node to analyze.
 * @returns Branch enumeration with unconditional elements and branch groups.
 */
export function enumerateBranches(jsxRoot: Node): BranchEnumeration {
  const branchGroups: BranchGroup[] = [];

  // Find ternary expressions in JSX: {cond ? <A/> : <B/>}
  const jsxExpressions = jsxRoot.getDescendantsOfKind(SyntaxKind.JsxExpression);

  for (const jsxExpr of jsxExpressions) {
    const children = jsxExpr.getChildren();
    // JsxExpression: { expr }
    const innerExpr = children.length >= 2 ? children[1] : undefined;
    if (!innerExpr) continue;

    const group = analyzeExpression(innerExpr);
    if (group) branchGroups.push(group);
  }

  // Extract unconditional elements (elements outside any conditional)
  const allElements = extractElements(jsxRoot);
  const conditionalElements = new Set<string>();
  for (const group of branchGroups) {
    for (const variant of group.variants) {
      for (const el of variant.elements) {
        conditionalElements.add(JSON.stringify(el.query));
      }
    }
  }

  const unconditionalElements = allElements.filter(
    (el) => !conditionalElements.has(JSON.stringify(el.query)),
  );

  return { unconditionalElements, branchGroups };
}

/**
 * Enumerate branches from early-return patterns in a function body.
 *
 * Pattern: `if (cond) return <A/>; return <B/>;`
 * Produces two variants: the early return and the default return.
 *
 * @param body - The function body node to analyze.
 * @returns Array of branch groups from early returns.
 */
export function enumerateEarlyReturns(body: Node): BranchGroup[] {
  const groups: BranchGroup[] = [];

  // Use getDescendantsOfKind to find if statements inside Block nodes
  // (function bodies are wrapped in Block which contains a SyntaxList)
  const ifStatements = body
    .getDescendantsOfKind(SyntaxKind.IfStatement)
    .filter((ifStmt) => {
      // Only top-level if statements (not nested inside other if/for/etc.)
      let parent: Node | undefined = ifStmt.getParent();
      while (parent !== undefined && parent !== body) {
        const kind = parent.getKind();
        if (
          kind === SyntaxKind.IfStatement ||
          kind === SyntaxKind.ForStatement
        ) {
          return false;
        }
        parent = parent.getParent();
      }
      return parent === body;
    });

  for (const ifStmt of ifStatements) {
    const variants: BranchVariant[] = [];

    // Then branch — may be a direct ReturnStatement or a Block containing one
    const thenStmt = ifStmt.getThenStatement();
    const thenReturns =
      thenStmt.getKind() === SyntaxKind.ReturnStatement
        ? [thenStmt]
        : thenStmt.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    if (thenReturns.length > 0) {
      const returnExpr = (thenReturns[0] as ReturnStatement).getExpression();
      if (returnExpr && !isNullish(returnExpr)) {
        const elements = extractElements(returnExpr);
        if (elements.length > 0) {
          variants.push({
            conditionLabel: ifStmt.getExpression().getText(),
            elements,
            isDefault: false,
          });
        }
      }
    }

    // Else branch — may also be direct ReturnStatement
    const elseStmt = ifStmt.getElseStatement();
    if (elseStmt) {
      const elseReturns =
        elseStmt.getKind() === SyntaxKind.ReturnStatement
          ? [elseStmt]
          : elseStmt.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      if (elseReturns.length > 0) {
        const returnExpr = (elseReturns[0] as ReturnStatement).getExpression();
        if (returnExpr && !isNullish(returnExpr)) {
          const elements = extractElements(returnExpr);
          if (elements.length > 0) {
            variants.push({
              conditionLabel: `!(${ifStmt.getExpression().getText()})`,
              elements,
              isDefault: true,
            });
          }
        }
      }
    }

    // If we found early-return variants but no else branch, look for
    // the trailing return after the if block as the default variant
    if (variants.length > 0 && !variants.some((v) => v.isDefault)) {
      const defaultReturn = findTrailingReturn(ifStmt);
      if (defaultReturn) {
        const defaultExpr = defaultReturn.getExpression();
        if (defaultExpr && !isNullish(defaultExpr)) {
          const defaultElements = extractElements(defaultExpr);
          if (defaultElements.length > 0) {
            variants.push({
              conditionLabel: `!(${ifStmt.getExpression().getText()})`,
              elements: defaultElements,
              isDefault: true,
            });
          }
        }
      }
    }

    if (variants.length > 0) {
      groups.push({
        line: ifStmt.getStartLineNumber(),
        variants,
      });
    }
  }

  return groups;
}

/**
 * Find the return statement that follows an if statement (the fall-through default).
 */
function findTrailingReturn(ifStmt: Node): ReturnStatement | undefined {
  const parent = ifStmt.getParent();
  if (!parent) return undefined;

  const siblings = parent.getChildren();
  const ifIndex = siblings.indexOf(ifStmt);

  // Search siblings after the if statement for a return
  for (let i = ifIndex + 1; i < siblings.length; i++) {
    const sibling = siblings[i];
    if (sibling.getKind() === SyntaxKind.ReturnStatement) {
      return sibling as ReturnStatement;
    }
    // Check inside SyntaxList (Block bodies have children in a SyntaxList)
    if (sibling.getKind() === SyntaxKind.SyntaxList) {
      for (const child of sibling.getChildren()) {
        if (child.getKind() === SyntaxKind.ReturnStatement) {
          return child as ReturnStatement;
        }
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Analyze an expression node for conditional patterns.
 */
function analyzeExpression(node: Node): BranchGroup | undefined {
  // Ternary: cond ? <A/> : <B/>
  if (node.getKind() === SyntaxKind.ConditionalExpression) {
    return analyzeTernary(node);
  }

  // Logical AND: cond && <A/>
  if (node.getKind() === SyntaxKind.BinaryExpression) {
    const text = node.getText();
    // Check operator
    const operatorToken = node.getChildAtIndex(1);
    if (operatorToken) {
      const op = operatorToken.getText();
      if (op === "&&") return analyzeLogicalAnd(node);
      if (op === "||") return analyzeLogicalOr(node);
    }
  }

  return undefined;
}

/**
 * Analyze a ternary expression: cond ? whenTrue : whenFalse
 */
function analyzeTernary(node: Node): BranchGroup | undefined {
  const children = node.getChildren();
  // ConditionalExpression: condition ? whenTrue : whenFalse
  // Children: [condition, ?, whenTrue, :, whenFalse]
  if (children.length < 5) return undefined;

  const condition = children[0];
  const whenTrue = children[2];
  const whenFalse = children[4];

  const variants: BranchVariant[] = [];

  // True branch
  const trueElements = extractBranchElements(whenTrue);
  if (trueElements.length > 0) {
    variants.push({
      conditionLabel: condition.getText(),
      elements: trueElements,
      isDefault: false,
    });
  }

  // False branch — might be another ternary (nested)
  if (whenFalse.getKind() === SyntaxKind.ConditionalExpression) {
    const nested = analyzeTernary(whenFalse);
    if (nested) {
      // Mark the last variant as default
      for (const v of nested.variants) {
        variants.push(v);
      }
      if (variants.length > 0) {
        variants[variants.length - 1].isDefault = true;
      }
    }
  } else {
    const falseElements = extractBranchElements(whenFalse);
    if (falseElements.length > 0) {
      variants.push({
        conditionLabel: `!(${condition.getText()})`,
        elements: falseElements,
        isDefault: true,
      });
    }
  }

  if (variants.length === 0) return undefined;

  return {
    line: node.getStartLineNumber(),
    variants,
  };
}

/**
 * Analyze logical AND: cond && <Component />
 * Two variants: present (cond true) and absent (cond false).
 */
function analyzeLogicalAnd(node: Node): BranchGroup | undefined {
  const children = node.getChildren();
  // BinaryExpression: left && right
  if (children.length < 3) return undefined;

  const condition = children[0];
  const right = children[2];

  const elements = extractBranchElements(right);
  if (elements.length === 0) return undefined;

  return {
    line: node.getStartLineNumber(),
    variants: [
      {
        conditionLabel: condition.getText(),
        elements,
        isDefault: false,
      },
      {
        conditionLabel: `!(${condition.getText()})`,
        elements: [], // absent — no elements in this branch
        isDefault: true,
      },
    ],
  };
}

/**
 * Analyze logical OR: cond || <Fallback />
 * Two variants: fallback shown when cond is falsy.
 */
function analyzeLogicalOr(node: Node): BranchGroup | undefined {
  const children = node.getChildren();
  if (children.length < 3) return undefined;

  const condition = children[0];
  const right = children[2];

  const elements = extractBranchElements(right);
  if (elements.length === 0) return undefined;

  return {
    line: node.getStartLineNumber(),
    variants: [
      {
        conditionLabel: `!(${condition.getText()})`,
        elements,
        isDefault: true,
      },
    ],
  };
}

/**
 * Extract elements from a branch expression node.
 * Handles JSX elements, fragments, and parenthesized expressions.
 */
function extractBranchElements(node: Node): ExtractedElement[] {
  let current = node;

  // Unwrap parenthesized expressions
  while (current.getKind() === SyntaxKind.ParenthesizedExpression) {
    const inner = current.getChildAtIndex(1);
    if (!inner) break;
    current = inner;
  }

  const kind = current.getKind();
  if (
    kind === SyntaxKind.JsxElement ||
    kind === SyntaxKind.JsxSelfClosingElement ||
    kind === SyntaxKind.JsxFragment
  ) {
    return extractElements(current);
  }

  // For non-JSX expressions (e.g., string literals, null), return empty
  return [];
}

/** Check if a node is null or undefined. */
function isNullish(node: Node): boolean {
  const text = node.getText().trim();
  return text === "null" || text === "undefined";
}
