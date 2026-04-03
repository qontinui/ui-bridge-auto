import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, type Node } from "ts-morph";
import {
  extractElements,
  type ExtractedElement,
} from "../../static-builder/extraction/element-extractor";

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
  const expr = returns[0].getExpression()!;
  // Unwrap parenthesized
  let node: Node = expr;
  while (node.getKind() === SyntaxKind.ParenthesizedExpression) {
    node = node.getChildAtIndex(1);
  }
  return node;
}

describe("extractElements", () => {
  it("extracts role attribute", () => {
    const root = createJsxRoot(`<div role="button">Click me</div>`);
    const elements = extractElements(root);

    const btn = elements.find((e) => e.query.role === "button");
    expect(btn).toBeDefined();
    expect(btn!.query.role).toBe("button");
    expect(btn!.query.text).toBe("Click me");
    expect(btn!.interactive).toBe(true);
  });

  it("extracts aria-label", () => {
    const root = createJsxRoot(`<button aria-label="Close dialog">X</button>`);
    const elements = extractElements(root);

    const btn = elements.find((e) => e.query.ariaLabel === "Close dialog");
    expect(btn).toBeDefined();
    expect(btn!.interactive).toBe(true);
  });

  it("extracts aria-expanded boolean", () => {
    const root = createJsxRoot(
      `<div role="tree" aria-expanded={true}>Tree</div>`,
    );
    const elements = extractElements(root);

    const tree = elements.find((e) => e.query.role === "tree");
    expect(tree).toBeDefined();
    expect(tree!.query.ariaExpanded).toBe(true);
  });

  it("extracts data-content-role attribute", () => {
    const root = createJsxRoot(
      `<div data-content-role="badge" data-content-label="status">Active</div>`,
    );
    const elements = extractElements(root);

    const badge = elements.find(
      (e) => e.query.attributes?.["data-content-role"] === "badge",
    );
    expect(badge).toBeDefined();
    expect(badge!.query.attributes!["data-content-label"]).toBe("status");
  });

  it("extracts id attribute", () => {
    const root = createJsxRoot(`<form id="login-form">Login</form>`);
    const elements = extractElements(root);

    const form = elements.find((e) => e.query.id === "login-form");
    expect(form).toBeDefined();
  });

  it("extracts text content from children", () => {
    const root = createJsxRoot(`<span role="heading">Dashboard</span>`);
    const elements = extractElements(root);

    const heading = elements.find((e) => e.query.role === "heading");
    expect(heading).toBeDefined();
    expect(heading!.query.text).toBe("Dashboard");
  });

  it("skips elements without semantic attributes", () => {
    const root = createJsxRoot(
      `<div><div className="flex"><span role="status">OK</span></div></div>`,
    );
    const elements = extractElements(root);

    // Only the span with role="status" should be extracted
    expect(elements.length).toBe(1);
    expect(elements[0].query.role).toBe("status");
  });

  it("marks interactive elements correctly", () => {
    const root = createJsxRoot(
      `<div><button aria-label="Save">Save</button><div role="heading">Title</div></div>`,
    );
    const elements = extractElements(root);

    const button = elements.find((e) => e.query.ariaLabel === "Save");
    expect(button!.interactive).toBe(true);

    const heading = elements.find((e) => e.query.role === "heading");
    expect(heading!.interactive).toBe(false);
  });

  it("extracts self-closing elements", () => {
    const root = createJsxRoot(
      `<div><input aria-label="Search" /><hr id="divider" /></div>`,
    );
    const elements = extractElements(root);

    const input = elements.find((e) => e.query.ariaLabel === "Search");
    expect(input).toBeDefined();
    expect(input!.interactive).toBe(true);
    expect(input!.tagName).toBe("input");
  });

  it("extracts data-testid", () => {
    const root = createJsxRoot(`<div data-testid="main-panel">Content</div>`);
    const elements = extractElements(root);

    const panel = elements.find(
      (e) => e.query.attributes?.["data-testid"] === "main-panel",
    );
    expect(panel).toBeDefined();
  });

  it("handles fragments", () => {
    const root = createJsxRoot(
      `<><button aria-label="A">A</button><button aria-label="B">B</button></>`,
    );
    const elements = extractElements(root);

    expect(elements.length).toBe(2);
    expect(elements.map((e) => e.query.ariaLabel).sort()).toEqual(["A", "B"]);
  });

  it("deduplicates identical elements", () => {
    const root = createJsxRoot(
      `<div><span role="status">OK</span><span role="status">OK</span></div>`,
    );
    const elements = extractElements(root);

    const statuses = elements.filter((e) => e.query.role === "status");
    expect(statuses.length).toBe(1);
  });

  it("sets tagName for HTML elements", () => {
    const root = createJsxRoot(`<nav role="navigation">Nav</nav>`);
    const elements = extractElements(root);

    expect(elements[0].tagName).toBe("nav");
    expect(elements[0].query.tagName).toBe("nav");
  });

  it("does not set tagName for React components", () => {
    const root = createJsxRoot(`<Sidebar role="navigation" />`);
    const elements = extractElements(root);

    expect(elements[0].tagName).toBe("Sidebar");
    expect(elements[0].query.tagName).toBeUndefined();
  });

  it("handles multiple data attributes on one element", () => {
    const root = createJsxRoot(
      `<div data-content-role="label" data-content-label="Task Name" data-testid="task-label">Task</div>`,
    );
    const elements = extractElements(root);

    expect(elements.length).toBe(1);
    expect(elements[0].query.attributes).toEqual({
      "data-content-role": "label",
      "data-content-label": "Task Name",
      "data-testid": "task-label",
    });
  });
});
