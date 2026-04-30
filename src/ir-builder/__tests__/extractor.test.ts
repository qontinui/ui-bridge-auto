/**
 * Unit tests for the IR JSX extractor.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";

import {
  extractIRDeclarations,
  isUnsupportedProp,
  type ExtractedDeclaration,
} from "../extractor";

function source(filename: string, code: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  });
  return project.createSourceFile(filename, code);
}

describe("extractIRDeclarations", () => {
  it("extracts a self-closing <State> with literal props", () => {
    const sf = source(
      "Login.tsx",
      `
      export function LoginPage() {
        return (
          <State
            id="login"
            name="Login"
            requiredElements={[{ role: 'button', text: 'Login' }]}
          />
        );
      }
      `,
    );

    const decls = extractIRDeclarations(sf);

    expect(decls).toHaveLength(1);
    expect(decls[0].kind).toBe("state");
    expect(decls[0].props.id).toBe("login");
    expect(decls[0].props.name).toBe("Login");
    expect(decls[0].props.requiredElements).toEqual([
      { role: "button", text: "Login" },
    ]);
    expect(decls[0].file).toMatch(/Login\.tsx$/);
    expect(decls[0].line).toBeGreaterThan(0);
  });

  it("extracts a <State> with children and excludedElements", () => {
    const sf = source(
      "Page.tsx",
      `
      export function Page() {
        return (
          <State
            id="dashboard"
            name="Dashboard"
            requiredElements={[{ role: 'heading', text: 'Dashboard' }]}
            excludedElements={[{ role: 'heading', text: 'Login' }]}
          >
            <div>Hello</div>
          </State>
        );
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    expect(decls[0].kind).toBe("state");
    expect(decls[0].props.requiredElements).toEqual([
      { role: "heading", text: "Dashboard" },
    ]);
    expect(decls[0].props.excludedElements).toEqual([
      { role: "heading", text: "Login" },
    ]);
  });

  it("extracts a <TransitionTo> with effect and actions", () => {
    const sf = source(
      "Login.tsx",
      `
      export function LoginButton() {
        return (
          <TransitionTo
            id="open-login"
            name="Open Login"
            fromStates={['landing']}
            activateStates={['login-form']}
            exitStates={['landing']}
            effect="write"
            actions={[
              { type: 'click', target: { role: 'button', text: 'Login' } }
            ]}
          />
        );
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    const t = decls[0];
    expect(t.kind).toBe("transition");
    expect(t.props.id).toBe("open-login");
    expect(t.props.fromStates).toEqual(["landing"]);
    expect(t.props.activateStates).toEqual(["login-form"]);
    expect(t.props.exitStates).toEqual(["landing"]);
    expect(t.props.effect).toBe("write");
    expect(t.props.actions).toEqual([
      { type: "click", target: { role: "button", text: "Login" } },
    ]);
  });

  it("extracts legacy elements: string[] form on <State>", () => {
    const sf = source(
      "Legacy.tsx",
      `
      export function Page() {
        return <State id="legacy" name="Legacy" elements={['btn-login', 'input-email']} />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    expect(decls[0].props.elements).toEqual(["btn-login", "input-email"]);
    // The extractor does NOT lift; that's the IR emitter's job.
    expect(decls[0].props.requiredElements).toBeUndefined();
  });

  it("flattens nested <State> declarations", () => {
    const sf = source(
      "Nested.tsx",
      `
      export function Page() {
        return (
          <State id="outer" name="Outer">
            <div>
              <State id="inner" name="Inner" />
            </div>
          </State>
        );
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(2);
    const ids = decls.map((d) => d.props.id).sort();
    expect(ids).toEqual(["inner", "outer"]);
  });

  it("marks computed prop expressions as __unsupported__", () => {
    const sf = source(
      "Computed.tsx",
      `
      export function Page() {
        const dynamicName = 'Dashboard';
        return <State id="dash" name={dynamicName} />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    const nameProp = decls[0].props.name;
    expect(isUnsupportedProp(nameProp)).toBe(true);
    if (isUnsupportedProp(nameProp)) {
      expect(nameProp.expression).toContain("dynamicName");
      expect(nameProp.line).toBeGreaterThan(0);
    }
  });

  it("recognizes the qualified <UIBridge.State> form", () => {
    const sf = source(
      "Qualified.tsx",
      `
      import { UIBridge } from '@qontinui/ui-bridge';
      export function Page() {
        return <UIBridge.State id="q" name="Q" requiredElements={[]} />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    expect(decls[0].kind).toBe("state");
    expect(decls[0].props.id).toBe("q");
  });

  it("recognizes the qualified <UIBridge.TransitionTo> form", () => {
    const sf = source(
      "Qualified.tsx",
      `
      import { UIBridge } from '@qontinui/ui-bridge';
      export function Page() {
        return (
          <UIBridge.TransitionTo
            id="t"
            name="T"
            fromStates={['a']}
            activateStates={['b']}
          />
        );
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    expect(decls[0].kind).toBe("transition");
    expect(decls[0].props.id).toBe("t");
  });

  it("treats boolean shorthand props as true", () => {
    const sf = source(
      "Bool.tsx",
      `
      export function Page() {
        return <State id="initial" name="Initial" isInitial />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls[0].props.isInitial).toBe(true);
  });

  it("captures numeric literals (including negatives)", () => {
    const sf = source(
      "Num.tsx",
      `
      export function Page() {
        return <State id="n" name="N" pathCost={-2.5} />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls[0].props.pathCost).toBe(-2.5);
  });

  it("preserves authoring order across multiple declarations", () => {
    const sf = source(
      "Order.tsx",
      `
      export function Page() {
        return (
          <>
            <State id="b" name="B" />
            <State id="a" name="A" />
            <State id="c" name="C" />
          </>
        );
      }
      `,
    );

    const decls: ExtractedDeclaration[] = extractIRDeclarations(sf);
    expect(decls.map((d) => d.props.id)).toEqual(["b", "a", "c"]);
  });

  it("flags JSX spread attributes as unsupported via __spread__", () => {
    const sf = source(
      "Spread.tsx",
      `
      export function Page() {
        const props = { id: 'x', name: 'X' };
        return <State {...props} />;
      }
      `,
    );

    const decls = extractIRDeclarations(sf);
    expect(decls).toHaveLength(1);
    expect(isUnsupportedProp(decls[0].props.__spread__)).toBe(true);
  });

  it("ignores arbitrary non-State JSX", () => {
    const sf = source(
      "Page.tsx",
      `
      export function Page() {
        return (
          <div>
            <button>Click</button>
            <span>Hello</span>
          </div>
        );
      }
      `,
    );

    expect(extractIRDeclarations(sf)).toHaveLength(0);
  });
});
