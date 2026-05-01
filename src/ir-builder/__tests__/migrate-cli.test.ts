/**
 * Tests for the Phase A3 codemod CLI (`migrate-uibridge-spec`).
 *
 * Covers:
 *   - Path-id derivation helpers (web specs + plain basename).
 *   - Single-file dry-run (no files written, summary on stdout).
 *   - Single-file --apply (three files emitted; idempotent on re-run).
 *   - Batch dry-run (counts + summary line; no files written).
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  derivePageIdFromBasename,
  derivePageIdFromWebPath,
  routeSpecPath,
  runMigrateCli,
} from "../migrate-cli";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal-but-valid legacy bundled-page spec — small enough to keep tests
 * hermetic, but exercises every projection path: groups + assertions, an
 * SM block with one transition, metadata, and a description.
 */
const SAMPLE_LEGACY = {
  version: "1.0.0",
  description: "Sample page for migrate-cli tests",
  groups: [
    {
      id: "idle",
      name: "Idle",
      description: "Initial idle state",
      category: "element-presence",
      assertions: [
        {
          id: "idle-elem-0",
          description: "Start button visible",
          category: "element-presence",
          severity: "critical" as const,
          assertionType: "exists",
          target: {
            type: "search" as const,
            criteria: { role: "button", textContent: "Start" },
            label: "Required element for Idle",
          },
          source: "ai-generated",
          reviewed: false,
          enabled: true,
        },
      ],
      source: "ai-generated",
    },
    {
      id: "running",
      name: "Running",
      description: "",
      category: "element-presence",
      assertions: [
        {
          id: "running-elem-0",
          description: "Stop button visible",
          category: "element-presence",
          severity: "critical" as const,
          assertionType: "exists",
          target: {
            type: "search" as const,
            criteria: { role: "button", textContent: "Stop" },
            label: "Required element for Running",
          },
          source: "ai-generated",
          reviewed: false,
          enabled: true,
        },
      ],
      source: "ai-generated",
    },
  ],
  stateMachine: {
    states: [
      {
        id: "idle",
        name: "Idle",
        description: "Initial idle state",
        elements: [{ role: "button", textContent: "Start" }],
        isInitial: true,
        transitions: [
          {
            id: "idle-to-running",
            name: "Start",
            activateStates: ["running"],
            deactivateStates: ["idle"],
            staysVisible: false,
            process: [
              {
                action: "click",
                target: { role: "button", textContent: "Start" },
              },
            ],
          },
        ],
      },
      {
        id: "running",
        name: "Running",
        description: "",
        elements: [{ role: "button", textContent: "Stop" }],
        isInitial: false,
        transitions: [],
      },
    ],
  },
  metadata: { component: "sample" },
};

// ---------------------------------------------------------------------------
// IO capture helper
// ---------------------------------------------------------------------------

interface CapturedIO {
  stdout: string;
  stderr: string;
  io: { stdout: (s: string) => void; stderr: (s: string) => void };
}

function captureIO(): CapturedIO {
  let stdout = "";
  let stderr = "";
  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      stdout: (s: string) => {
        stdout += s;
      },
      stderr: (s: string) => {
        stderr += s;
      },
    },
  } as CapturedIO;
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "migrate-cli-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

function writeLegacy(path: string, body: unknown = SAMPLE_LEGACY): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n", "utf8");
  return path;
}

// ===========================================================================
// Tests
// ===========================================================================

describe("derivePageIdFromBasename", () => {
  it("strips .spec.uibridge.json from a plain basename path", () => {
    expect(derivePageIdFromBasename("/abs/path/active.spec.uibridge.json")).toBe("active");
  });

  it("returns the basename unchanged if the suffix is missing", () => {
    expect(derivePageIdFromBasename("/abs/path/foo.json")).toBe("foo.json");
  });
});

describe("derivePageIdFromWebPath", () => {
  it("dashes nested segments under src/app and drops route groups", () => {
    expect(
      derivePageIdFromWebPath("src/app/(app)/settings/ai/ai-settings.spec.uibridge.json"),
    ).toBe("settings-ai-ai-settings");
  });

  it("handles a top-level page directly under src/app", () => {
    expect(derivePageIdFromWebPath("src/app/page/main.spec.uibridge.json")).toBe("page-main");
  });

  it("falls back to the basename when only the (group) + filename remain", () => {
    expect(derivePageIdFromWebPath("src/app/(auth)/login.spec.uibridge.json")).toBe("login");
  });

  it("works with backslash-separated paths", () => {
    expect(
      derivePageIdFromWebPath("src\\app\\(app)\\settings\\ai\\ai-settings.spec.uibridge.json"),
    ).toBe("settings-ai-ai-settings");
  });
});

describe("routeSpecPath", () => {
  it("routes a runner spec to qontinui-runner/specs/pages", () => {
    const repo = "/repo";
    const result = routeSpecPath("/repo/qontinui-runner/src/specs/active.spec.uibridge.json", repo);
    expect(result).not.toBeNull();
    expect(result!.pageId).toBe("active");
    expect(result!.pagesDir.replace(/\\/g, "/")).toBe("/repo/qontinui-runner/specs/pages");
  });

  it("routes a web frontend spec via the web id-derivation rule", () => {
    const repo = "/repo";
    const result = routeSpecPath(
      "/repo/qontinui-web/frontend/src/app/(app)/settings/ai/ai-settings.spec.uibridge.json",
      repo,
    );
    expect(result).not.toBeNull();
    expect(result!.pageId).toBe("settings-ai-ai-settings");
    expect(result!.pagesDir.replace(/\\/g, "/")).toBe("/repo/qontinui-web/frontend/specs/pages");
  });

  it("returns null for an unrecognized path", () => {
    expect(routeSpecPath("/repo/random/path/foo.spec.uibridge.json", "/repo")).toBeNull();
  });
});

describe("runMigrateCli — single-file dry-run", () => {
  it("prints what would happen and writes nothing", () => {
    const inputPath = writeLegacy(join(workdir, "input", "active.spec.uibridge.json"));
    const pagesDir = join(workdir, "pages");

    const cap = captureIO();
    const code = runMigrateCli([inputPath, `--out=${pagesDir}`], cap.io);

    expect(code).toBe(0);
    expect(cap.stdout).toContain("would write 3");
    expect(cap.stdout).toContain("dry-run complete");
    expect(existsSync(join(pagesDir, "active"))).toBe(false);
  });
});

describe("runMigrateCli — single-file --apply", () => {
  it("writes IR, regenerated spec, and notes; idempotent on re-run", () => {
    const inputPath = writeLegacy(join(workdir, "input", "active.spec.uibridge.json"));
    const pagesDir = join(workdir, "pages");

    const cap1 = captureIO();
    const code1 = runMigrateCli([inputPath, `--out=${pagesDir}`, "--apply"], cap1.io);
    expect(code1).toBe(0);

    const pageDir = join(pagesDir, "active");
    const irPath = join(pageDir, "state-machine.derived.json");
    const specPath = join(pageDir, "spec.uibridge.json");
    const notesPath = join(pageDir, "notes.md");

    expect(existsSync(irPath)).toBe(true);
    expect(existsSync(specPath)).toBe(true);
    expect(existsSync(notesPath)).toBe(true);

    const ir = JSON.parse(readFileSync(irPath, "utf8"));
    expect(ir.id).toBe("active");
    expect(ir.states).toHaveLength(2);

    // Idempotency: every output should have a trailing newline.
    expect(readFileSync(irPath, "utf8").endsWith("\n")).toBe(true);
    expect(readFileSync(specPath, "utf8").endsWith("\n")).toBe(true);

    const irBefore = readFileSync(irPath, "utf8");
    const specBefore = readFileSync(specPath, "utf8");
    const notesBefore = readFileSync(notesPath, "utf8");

    const cap2 = captureIO();
    const code2 = runMigrateCli([inputPath, `--out=${pagesDir}`, "--apply"], cap2.io);
    expect(code2).toBe(0);
    // Re-run should report 3 skipped (all matched on disk).
    expect(cap2.stdout).toContain("wrote 0");
    expect(cap2.stdout).toContain("skipped 3");

    expect(readFileSync(irPath, "utf8")).toBe(irBefore);
    expect(readFileSync(specPath, "utf8")).toBe(specBefore);
    expect(readFileSync(notesPath, "utf8")).toBe(notesBefore);
  });

  it("preserves a hand-edited notes.md on re-run", () => {
    const inputPath = writeLegacy(join(workdir, "input", "active.spec.uibridge.json"));
    const pagesDir = join(workdir, "pages");

    const cap1 = captureIO();
    expect(runMigrateCli([inputPath, `--out=${pagesDir}`, "--apply"], cap1.io)).toBe(0);

    const notesPath = join(pagesDir, "active", "notes.md");
    const handAuthored = "# Active\n\nHand-authored content goes here.\n";
    writeFileSync(notesPath, handAuthored, "utf8");

    const cap2 = captureIO();
    expect(runMigrateCli([inputPath, `--out=${pagesDir}`, "--apply"], cap2.io)).toBe(0);
    expect(readFileSync(notesPath, "utf8")).toBe(handAuthored);
  });
});

describe("runMigrateCli — batch dry-run", () => {
  it("walks the repo, counts both specs, and writes nothing", () => {
    const repoRoot = workdir;
    // Place two specs at recognized per-app paths.
    writeLegacy(
      join(repoRoot, "qontinui-runner", "src", "specs", "active.spec.uibridge.json"),
    );
    writeLegacy(
      join(
        repoRoot,
        "qontinui-web",
        "frontend",
        "src",
        "app",
        "(app)",
        "settings",
        "settings.spec.uibridge.json",
      ),
    );

    const cap = captureIO();
    const code = runMigrateCli([`--root=${repoRoot}`], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout).toContain("migrated: 2");
    expect(cap.stdout).toContain("errors: 0");
    expect(cap.stdout).toContain("dry-run complete");
    // Nothing written.
    expect(existsSync(join(repoRoot, "qontinui-runner", "specs", "pages"))).toBe(false);
    expect(existsSync(join(repoRoot, "qontinui-web", "frontend", "specs", "pages"))).toBe(false);
  });

  it("warns on un-routable paths and counts them under warnings", () => {
    const repoRoot = workdir;
    writeLegacy(join(repoRoot, "random-unknown", "stray.spec.uibridge.json"));

    const cap = captureIO();
    const code = runMigrateCli([`--root=${repoRoot}`], cap.io);
    expect(code).toBe(0);
    expect(cap.stderr).toContain("no per-app routing");
    expect(cap.stdout).toContain("warnings: 1");
  });
});

describe("runMigrateCli — argument validation", () => {
  it("returns exit 0 for --help", () => {
    const cap = captureIO();
    expect(runMigrateCli(["--help"], cap.io)).toBe(0);
  });

  it("returns exit 2 when neither input nor --root is provided", () => {
    const cap = captureIO();
    expect(runMigrateCli([], cap.io)).toBe(2);
  });

  it("returns exit 2 when both input and --root are provided", () => {
    const cap = captureIO();
    expect(runMigrateCli(["foo.spec.uibridge.json", "--root=/repo"], cap.io)).toBe(2);
  });

  it("returns exit 2 in single-file mode without --out", () => {
    const cap = captureIO();
    const inputPath = writeLegacy(join(workdir, "input", "x.spec.uibridge.json"));
    expect(runMigrateCli([inputPath], cap.io)).toBe(2);
  });
});
