/**
 * Cross-plugin parity test.
 *
 * Section 4 of the UI Bridge Redesign demands that EVERY emission path —
 * the standalone CLI, the Vite plugin, the Metro plugin, and the build.rs
 * shim that Tauri uses — emit byte-stable, structurally identical IR for
 * the same input. The IR is the single source of truth that every
 * downstream consumer (runner, MCP, codegen) reads, so any structural or
 * byte-level drift between paths would mean two consumers running against
 * the "same" project would see different state machines.
 *
 * This test boots a tmp project root, copies a single fixture file
 * (parity-fixture.tsx — one <State>, one <TransitionTo>, all literal
 * props), and runs the four paths against it:
 *
 *   1. CLI                — `runCli(...)` from ../cli
 *   2. Vite plugin        — `uiBridgeIRPlugin(...)` from ../vite-plugin
 *   3. Metro plugin       — `createMetroIRWatcher(...)` from ../metro-plugin
 *                           (with `watch: false` so we don't leak fs.watch
 *                           handles in tests; the initial emit is
 *                           synchronous and is all we care about for
 *                           parity)
 *   4. "Tauri build.rs"   — second `runCli(...)` invocation (the build.rs
 *                           shim is just a CLI shell-out; this also serves
 *                           as a determinism sanity check across two CLI
 *                           runs)
 *
 * After all four runs we assert every output file is byte-for-byte
 * identical.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCli } from "../cli";
import { uiBridgeIRPlugin } from "../vite-plugin";
import {
  createMetroIRWatcher,
  type MetroIRWatcherHandle,
} from "../metro-plugin";

const FIXTURE_PATH = resolve(__dirname, "parity-fixture.tsx");
const DOC_ID = "parity";
const DOC_NAME = "Parity";
// Note: we deliberately do NOT pass `pluginVersion` to the Vite or Metro
// plugins. Each path's default builder version must match the CLI's
// default (the CLI doesn't expose a `--plugin-version` flag), so leaving
// the option unset on every path keeps the provenance.pluginVersion field
// identical across all four outputs.

let tmpRoot: string;
let metroHandle: MetroIRWatcherHandle | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ui-bridge-ir-parity-"));
  mkdirSync(join(tmpRoot, "src"), { recursive: true });
  copyFileSync(FIXTURE_PATH, join(tmpRoot, "src", "parity-fixture.tsx"));
});

afterEach(() => {
  // Tear down any metro watcher first so its fs.watch handle is released
  // before we delete the tmp directory.
  if (metroHandle) {
    metroHandle.close();
    metroHandle = undefined;
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("cross-plugin IR parity", () => {
  it("CLI, Vite plugin, Metro plugin, and a second CLI run all emit byte-identical IR", async () => {
    // 1. CLI path.
    const cliExit = runCli([
      `--project-root=${tmpRoot}`,
      `--document-id=${DOC_ID}`,
      `--document-name=${DOC_NAME}`,
      "--out=cli.json",
    ]);
    expect(cliExit).toBe(0);

    // 2. Vite plugin path. Trigger buildStart() so it emits synchronously.
    const vitePlugin = uiBridgeIRPlugin({
      projectRoot: tmpRoot,
      documentId: DOC_ID,
      documentName: DOC_NAME,
      outFile: "vite.json",
      debounceMs: 0,
    });
    await vitePlugin.buildStart!();

    // 3. Metro plugin path. We use `createMetroIRWatcher` directly with
    //    `watch: false` because:
    //    - The constructor already runs an initial synchronous emit, which
    //      is the only behaviour parity cares about.
    //    - `watch: false` means no fs.watch handles are opened, so vitest
    //      doesn't hang on a leaked watcher.
    //    - The handle is captured so afterEach can `close()` it (a no-op
    //      when watch is disabled, but kept for safety).
    metroHandle = createMetroIRWatcher({
      projectRoot: tmpRoot,
      documentId: DOC_ID,
      documentName: DOC_NAME,
      outFile: "metro.json",
      debounceMs: 0,
      watch: false,
    });

    // 4. "Tauri build.rs" path — a second CLI invocation. The Tauri build
    //    script just shells out to ui-bridge-build-ir, so this also doubles
    //    as a determinism check across two CLI runs.
    const tauriExit = runCli([
      `--project-root=${tmpRoot}`,
      `--document-id=${DOC_ID}`,
      `--document-name=${DOC_NAME}`,
      "--out=tauri.json",
    ]);
    expect(tauriExit).toBe(0);

    // Read every output and assert byte-identity.
    const cliBytes = readFileSync(join(tmpRoot, "cli.json"), "utf8");
    const viteBytes = readFileSync(join(tmpRoot, "vite.json"), "utf8");
    const metroBytes = readFileSync(join(tmpRoot, "metro.json"), "utf8");
    const tauriBytes = readFileSync(join(tmpRoot, "tauri.json"), "utf8");

    expect(cliBytes).toBe(tauriBytes);
    expect(cliBytes).toBe(viteBytes);
    expect(cliBytes).toBe(metroBytes);

    // Validate output structure.
    const doc = JSON.parse(cliBytes) as {
      id: string;
      states: Array<{ id: string }>;
      transitions: Array<{ id: string }>;
    };
    expect(doc.id).toBe(DOC_ID);
    expect(doc.states).toHaveLength(1);
    expect(doc.states[0].id).toBe("parity-login");
    expect(doc.transitions).toHaveLength(1);
    expect(doc.transitions[0].id).toBe("parity-login-to-home");
  });
});
