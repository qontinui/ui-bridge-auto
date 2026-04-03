import { describe, it, expect } from "vitest";
import { Project, SyntaxKind, type Node } from "ts-morph";
import { traceNavigationTransitions } from "../../static-builder/extraction/navigation-tracer";

function createTestFile(code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  });
  return project.createSourceFile("Test.tsx", code);
}

function getJsxRoot(source: ReturnType<typeof createTestFile>): Node {
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

describe("traceNavigationTransitions", () => {
  it("detects inline setActiveTab call", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        return (
          <button role="button" aria-label="Go" onClick={() => setActiveTab("settings")}>
            Settings
          </button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(1);
    expect(transitions[0].targetState).toBe("settings");
    expect(transitions[0].action).toBe("click");
    expect(transitions[0].mechanism).toBe("direct");
  });

  it("detects handler reference that calls setActiveTab", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        const goToSettings = () => {
          setActiveTab("settings");
        };
        return (
          <button role="button" onClick={goToSettings}>Settings</button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(1);
    expect(transitions[0].targetState).toBe("settings");
  });

  it("detects useCallback-wrapped handler", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        const handleClick = useCallback(() => {
          setActiveTab("dashboard");
        }, [setActiveTab]);
        return (
          <button role="button" onClick={handleClick}>Dashboard</button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(1);
    expect(transitions[0].targetState).toBe("dashboard");
  });

  it("detects custom event dispatch", () => {
    const source = createTestFile(`
      function Page() {
        return (
          <button role="button" onClick={() => {
            window.dispatchEvent(new CustomEvent("navigate-to-active"));
          }}>Go Active</button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(
      root,
      source,
      [],
      ["navigate-to-active"],
    );

    expect(transitions.length).toBe(1);
    expect(transitions[0].targetState).toBe("navigate-to-active");
    expect(transitions[0].mechanism).toBe("event");
  });

  it("ignores non-navigation handlers", () => {
    const source = createTestFile(`
      function Page() {
        return (
          <button role="button" onClick={() => console.log("clicked")}>
            Log
          </button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(0);
  });

  it("detects multiple transitions in one component", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        return (
          <div>
            <button role="button" aria-label="A" onClick={() => setActiveTab("pageA")}>A</button>
            <button role="button" aria-label="B" onClick={() => setActiveTab("pageB")}>B</button>
          </div>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(2);
    const targets = transitions.map((t) => t.targetState).sort();
    expect(targets).toEqual(["pageA", "pageB"]);
  });

  it("extracts element query from handler's parent element", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        return (
          <button role="button" aria-label="Settings" onClick={() => setActiveTab("settings")}>
            Settings
          </button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(1);
    expect(transitions[0].sourceElement.role).toBe("button");
    expect(transitions[0].sourceElement.ariaLabel).toBe("Settings");
  });

  it("deduplicates identical transitions", () => {
    const source = createTestFile(`
      function Page({ setActiveTab }: any) {
        return (
          <button role="button" aria-label="Go" onClick={() => { setActiveTab("x"); setActiveTab("x"); }}>
            Go
          </button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    expect(transitions.length).toBe(1);
  });

  it("handles prop callback pattern", () => {
    const source = createTestFile(`
      function Page({ onNavigateToActive }: any) {
        return (
          <button role="button" onClick={onNavigateToActive}>Active</button>
        );
      }
    `);
    const root = getJsxRoot(source);
    // onNavigateToActive is a prop — can't resolve its body
    const transitions = traceNavigationTransitions(root, source, [
      "setActiveTab",
    ]);

    // Should not find any since the prop function body isn't available
    expect(transitions.length).toBe(0);
  });

  it("handles custom event with detail", () => {
    const source = createTestFile(`
      function Page() {
        return (
          <button role="button" onClick={() => {
            window.dispatchEvent(new CustomEvent("navigate-to-error-monitor", { detail: { taskRunId: "123" } }));
          }}>Errors</button>
        );
      }
    `);
    const root = getJsxRoot(source);
    const transitions = traceNavigationTransitions(
      root,
      source,
      [],
      ["navigate-to-error-monitor"],
    );

    expect(transitions.length).toBe(1);
    expect(transitions[0].targetState).toBe("navigate-to-error-monitor");
  });
});
