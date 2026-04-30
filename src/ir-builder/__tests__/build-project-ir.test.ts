/**
 * Tests for the framework-agnostic project-level IR builder.
 *
 * These cover the path used by both the Vite plugin and the standalone CLI
 * (Next.js prebuild + any non-Vite build), so both paths emit byte-identical
 * output for the same input.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectIR, writeProjectIR } from "../build-project-ir";
import { runCli } from "../cli";

let projectRoot: string;

const SAMPLE_TSX = `
import { State, TransitionTo } from '@qontinui/ui-bridge';

export function LoginPage() {
  return (
    <>
      <State
        id="login"
        name="Login"
        requiredElements={[{ role: 'button', text: 'Login' }]}
      />
      <TransitionTo
        id="t-login-to-dashboard"
        name="Click Login"
        fromStates={["login"]}
        activateStates={["dashboard"]}
        actions={[{ type: 'click', target: { role: 'button', text: 'Login' } }]}
        effect="write"
      />
    </>
  );
}
`;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ui-bridge-ir-build-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "LoginPage.tsx"), SAMPLE_TSX, "utf8");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("buildProjectIR", () => {
  it("returns a deterministic IRDocument with extracted state + transition", () => {
    const result = buildProjectIR({
      projectRoot,
      documentId: "test-doc",
      documentName: "Test Doc",
    });

    expect(result.document.id).toBe("test-doc");
    expect(result.document.states).toHaveLength(1);
    expect(result.document.states[0].id).toBe("login");
    expect(result.document.transitions).toHaveLength(1);
    expect(result.document.transitions[0].id).toBe("t-login-to-dashboard");
    expect(result.document.transitions[0].effect).toBe("write");
  });

  it("produces byte-identical output across two runs (determinism)", () => {
    const a = writeProjectIR({
      projectRoot,
      documentId: "test-doc",
      documentName: "Test Doc",
    });
    const firstBytes = readFileSync(a.outFile, "utf8");

    const b = writeProjectIR({
      projectRoot,
      documentId: "test-doc",
      documentName: "Test Doc",
    });
    const secondBytes = readFileSync(b.outFile, "utf8");

    expect(firstBytes).toBe(secondBytes);
  });

  it("writes to the configured output path", () => {
    const result = writeProjectIR({
      projectRoot,
      documentId: "test-doc",
      documentName: "Test Doc",
      outFile: "build/ir.json",
    });
    expect(result.outFile.endsWith("build/ir.json")).toBe(true);
    const contents = JSON.parse(readFileSync(result.outFile, "utf8"));
    expect(contents.id).toBe("test-doc");
  });
});

describe("CLI runner", () => {
  it("emits the same output as buildProjectIR when run with equivalent args", () => {
    const exitCode = runCli([
      `--project-root=${projectRoot}`,
      "--document-id=cli-doc",
      "--document-name=CLI Doc",
    ]);
    expect(exitCode).toBe(0);

    const out = readFileSync(
      join(projectRoot, "src", "state-machine.derived.json"),
      "utf8",
    );
    const doc = JSON.parse(out);
    expect(doc.id).toBe("cli-doc");
    expect(doc.states).toHaveLength(1);
    expect(doc.transitions).toHaveLength(1);
  });

  it("returns exit code 2 when required args missing", () => {
    const exitCode = runCli(["--document-id=only-id"]);
    expect(exitCode).toBe(2);
  });

  it("returns exit code 0 for --help", () => {
    expect(runCli(["--help"])).toBe(0);
  });
});
