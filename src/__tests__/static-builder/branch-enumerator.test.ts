import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, type Node } from "ts-morph";
import {
  enumerateBranches,
  enumerateEarlyReturns,
} from "../../static-builder/extraction/branch-enumerator";

function createJsxRoot(jsx: string): Node {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  });
  const source = project.createSourceFile(
    "Test.tsx",
    `function Test() { return (${jsx}); }`,
  );
  const fn = source.getFunctions()[0];
  const returns = fn
    .getBody()!
    .getDescendantsOfKind(SyntaxKind.ReturnStatement);
  let node: Node = returns[0].getExpression()!;
  while (node.getKind() === SyntaxKind.ParenthesizedExpression) {
    node = node.getChildAtIndex(1);
  }
  return node;
}

function createFunctionBody(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  });
  const source = project.createSourceFile(
    "Test.tsx",
    `function Test({ loading }: any) { ${code} }`,
  );
  return source.getFunctions()[0].getBody()!;
}

describe("enumerateBranches", () => {
  it("enumerates ternary branches", () => {
    const root = createJsxRoot(
      `<div>{isOpen ? <span role="dialog">Open</span> : <button role="button">Closed</button>}</div>`,
    );
    const result = enumerateBranches(root);

    expect(result.branchGroups.length).toBe(1);
    const group = result.branchGroups[0];
    expect(group.variants.length).toBe(2);

    const trueVariant = group.variants.find((v) => !v.isDefault);
    expect(trueVariant).toBeDefined();
    expect(trueVariant!.conditionLabel).toBe("isOpen");
    expect(trueVariant!.elements.length).toBeGreaterThan(0);

    const falseVariant = group.variants.find((v) => v.isDefault);
    expect(falseVariant).toBeDefined();
    expect(falseVariant!.elements.length).toBeGreaterThan(0);
  });

  it("enumerates logical AND branches", () => {
    const root = createJsxRoot(
      `<div>{showBanner && <div role="alert">Banner</div>}</div>`,
    );
    const result = enumerateBranches(root);

    expect(result.branchGroups.length).toBe(1);
    const group = result.branchGroups[0];
    expect(group.variants.length).toBe(2);

    // Present variant
    const present = group.variants.find((v) => !v.isDefault);
    expect(present).toBeDefined();
    expect(present!.conditionLabel).toBe("showBanner");
    expect(present!.elements.length).toBeGreaterThan(0);

    // Absent variant (empty elements)
    const absent = group.variants.find((v) => v.isDefault);
    expect(absent).toBeDefined();
    expect(absent!.elements.length).toBe(0);
  });

  it("enumerates nested ternaries", () => {
    const root = createJsxRoot(
      `<div>{a ? <div role="a">A</div> : b ? <div role="b">B</div> : <div role="c">C</div>}</div>`,
    );
    const result = enumerateBranches(root);

    expect(result.branchGroups.length).toBe(1);
    const group = result.branchGroups[0];
    expect(group.variants.length).toBe(3);

    expect(group.variants[0].conditionLabel).toBe("a");
    expect(group.variants[2].isDefault).toBe(true);
  });

  it("identifies unconditional elements", () => {
    const root = createJsxRoot(
      `<div><h1 role="heading">Title</h1>{show && <p role="note">Extra</p>}</div>`,
    );
    const result = enumerateBranches(root);

    // The heading should be unconditional
    const heading = result.unconditionalElements.find(
      (e) => e.query.role === "heading",
    );
    expect(heading).toBeDefined();

    // The note should be in a branch variant
    expect(result.branchGroups.length).toBe(1);
  });

  it("handles no conditionals", () => {
    const root = createJsxRoot(
      `<div><button role="button">Click</button></div>`,
    );
    const result = enumerateBranches(root);

    expect(result.branchGroups.length).toBe(0);
    expect(result.unconditionalElements.length).toBeGreaterThan(0);
  });

  it("handles multiple independent conditionals", () => {
    const root = createJsxRoot(
      `<div>
        {showA && <div role="alert">A</div>}
        {showB && <div role="status">B</div>}
      </div>`,
    );
    const result = enumerateBranches(root);

    expect(result.branchGroups.length).toBe(2);
  });
});

describe("enumerateEarlyReturns", () => {
  it("detects early return pattern", () => {
    const body = createFunctionBody(`
      if (loading) return <div role="status">Loading...</div>;
      return <div role="main">Content</div>;
    `);
    const groups = enumerateEarlyReturns(body);

    expect(groups.length).toBe(1);
    expect(groups[0].variants.length).toBe(2);

    const earlyReturn = groups[0].variants.find((v) => !v.isDefault);
    expect(earlyReturn).toBeDefined();
    expect(earlyReturn!.conditionLabel).toBe("loading");

    const defaultReturn = groups[0].variants.find((v) => v.isDefault);
    expect(defaultReturn).toBeDefined();
    expect(defaultReturn!.elements.length).toBeGreaterThan(0);
  });

  it("detects if-else return pattern", () => {
    const body = createFunctionBody(`
      if (error) {
        return <div role="alert">Error</div>;
      } else {
        return <div role="main">OK</div>;
      }
    `);
    const groups = enumerateEarlyReturns(body);

    expect(groups.length).toBe(1);
    expect(groups[0].variants.length).toBe(2);

    const errorVariant = groups[0].variants.find((v) => !v.isDefault);
    expect(errorVariant!.conditionLabel).toBe("error");

    const okVariant = groups[0].variants.find((v) => v.isDefault);
    expect(okVariant).toBeDefined();
  });

  it("skips null returns", () => {
    const body = createFunctionBody(`
      if (loading) return null;
      return <div role="main">Content</div>;
    `);
    const groups = enumerateEarlyReturns(body);

    expect(groups.length).toBe(0);
  });
});
