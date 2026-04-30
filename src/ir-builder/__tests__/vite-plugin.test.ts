/**
 * Integration tests for the Vite plugin — uses a real tmpdir + real disk I/O.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uiBridgeIRPlugin } from "../vite-plugin";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "ir-plugin-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeFile(relative: string, content: string): void {
  const full = join(workdir, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function readOut(relative: string): string {
  return readFileSync(join(workdir, relative), "utf8");
}

const SIMPLE_PAGE = `
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
        id="open-login"
        name="Open Login"
        fromStates={['landing']}
        activateStates={['login']}
        effect="read"
      />
    </>
  );
}
`;

describe("uiBridgeIRPlugin (integration)", () => {
  it("buildStart writes a deterministic IR JSON file", async () => {
    writeFile("src/Login.tsx", SIMPLE_PAGE);

    const plugin = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "test-1",
      debounceMs: 0,
    });

    await plugin.buildStart!();

    const out = readOut("src/state-machine.derived.json");
    const parsed = JSON.parse(out);

    expect(parsed.id).toBe("app");
    expect(parsed.version).toBe("1.0");
    expect(parsed.states).toHaveLength(1);
    expect(parsed.states[0].id).toBe("login");
    expect(parsed.transitions).toHaveLength(1);
    expect(parsed.transitions[0].effect).toBe("read");

    // Provenance should be project-relative.
    expect(parsed.states[0].provenance.file).toBe("src/Login.tsx");
    expect(parsed.transitions[0].provenance.pluginVersion).toBe("test-1");
  });

  it("output is byte-for-byte stable across two builds", async () => {
    writeFile("src/A.tsx", SIMPLE_PAGE);

    const plugin1 = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "test-1",
      debounceMs: 0,
    });
    await plugin1.buildStart!();
    const first = readOut("src/state-machine.derived.json");

    // Fresh plugin instance, same source.
    const plugin2 = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "test-1",
      debounceMs: 0,
    });
    await plugin2.buildStart!();
    const second = readOut("src/state-machine.derived.json");

    expect(first).toBe(second);
  });

  it("handleHotUpdate regenerates the IR file after a TSX edit", async () => {
    writeFile("src/Page.tsx", SIMPLE_PAGE);

    const plugin = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "test-1",
      debounceMs: 0,
    });

    await plugin.buildStart!();
    const before = JSON.parse(readOut("src/state-machine.derived.json"));
    expect(before.states.map((s: { id: string }) => s.id)).toEqual(["login"]);

    // Edit the file: add a second state.
    writeFile(
      "src/Page.tsx",
      SIMPLE_PAGE.replace(
        "<State",
        "<State id=\"second\" name=\"Second\" requiredElements={[]} />\n      <State",
      ),
    );

    await plugin.handleHotUpdate!({ file: join(workdir, "src/Page.tsx") });

    const after = JSON.parse(readOut("src/state-machine.derived.json"));
    expect(after.states.map((s: { id: string }) => s.id).sort()).toEqual([
      "login",
      "second",
    ]);
  });

  it("forwards build warnings via onWarning", async () => {
    writeFile(
      "src/Page.tsx",
      `
      export function Page() {
        const dynamic = 'X';
        return <State id="x" name={dynamic} requiredElements={[]} />;
      }
      `,
    );

    const warnings: string[] = [];
    const plugin = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "t",
      debounceMs: 0,
      onWarning: (w) => warnings.push(w.message),
    });

    await plugin.buildStart!();
    expect(warnings.some((w) => w.includes("Unsupported"))).toBe(true);
  });

  it("creates the output directory if it does not exist", async () => {
    writeFile("src/Page.tsx", SIMPLE_PAGE);

    const plugin = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      outFile: "build/derived/app.ir.json",
      pluginVersion: "t",
      debounceMs: 0,
    });

    await plugin.buildStart!();
    expect(existsSync(join(workdir, "build/derived/app.ir.json"))).toBe(true);
  });

  it("scans recursively under src/", async () => {
    writeFile("src/pages/Login.tsx", SIMPLE_PAGE);
    writeFile(
      "src/pages/nested/Dashboard.tsx",
      `
      export function Dashboard() {
        return <State id="dashboard" name="Dashboard" requiredElements={[]} />;
      }
      `,
    );

    const plugin = uiBridgeIRPlugin({
      projectRoot: workdir,
      documentId: "app",
      documentName: "App",
      pluginVersion: "t",
      debounceMs: 0,
    });

    await plugin.buildStart!();
    const parsed = JSON.parse(readOut("src/state-machine.derived.json"));
    const ids = parsed.states.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual(["dashboard", "login"]);
  });
});
