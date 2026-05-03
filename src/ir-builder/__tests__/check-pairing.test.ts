/**
 * Tests for the Phase B5e CI gate (`check-spec-pairing`).
 *
 * Covers the three pairing outcomes:
 *   - paired       — legacy + IR present and structurally agree.
 *   - missing      — legacy present but no IR exists at the expected path.
 *   - mismatched   — legacy + IR present but structural fingerprints diverge.
 *
 * Plus the CLI-level concerns:
 *   - `--mode=warn` (default) returns exit 0 even when missing/mismatched.
 *   - `--mode=block` returns exit 1 in those cases.
 *
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  projectIRToBundledPage,
  projectLegacyToIR,
  type IRDocument,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  applyAcceptDrift,
  checkOne,
  isPolicyExpired,
  parseArgs,
  runCheckPairingCli,
  type IRAcceptDriftPolicy,
  type IRPairingAxis,
} from "../check-pairing";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A small but complete legacy bundled-page spec. Two groups, three
 * assertions total — enough variation that the fingerprint comparison has
 * something to chew on.
 */
const SAMPLE_LEGACY = {
  version: "1.0.0",
  description: "check-pairing test fixture",
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
        {
          id: "idle-elem-1",
          description: "Title visible",
          category: "element-presence",
          severity: "critical" as const,
          assertionType: "exists",
          target: {
            type: "search" as const,
            criteria: { role: "heading", textContent: "Welcome" },
            label: "Title",
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
        description: "",
        elements: [{ role: "button", textContent: "Start" }],
        isInitial: true,
        transitions: [],
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
  metadata: { component: "check-pairing-test" },
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
  workdir = mkdtempSync(join(tmpdir(), "check-pairing-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/**
 * Build a synthetic `qontinui-runner` repo at `<workdir>/qontinui-runner/`
 * with one legacy spec at `src/specs/<name>.spec.uibridge.json`. Optionally
 * write an IR file to the corresponding `specs/pages/<name>/` directory.
 */
function setupRunnerFixture(opts: {
  pageId: string;
  legacy: unknown;
  ir?: IRDocument | "from-legacy" | "mismatched";
}): { repoRoot: string; legacyPath: string; pagesDir: string; pageId: string } {
  const repoRoot = join(workdir, "qontinui-runner");
  const specsDir = join(repoRoot, "src", "specs");
  mkdirSync(specsDir, { recursive: true });
  const legacyPath = join(specsDir, `${opts.pageId}.spec.uibridge.json`);
  writeFileSync(legacyPath, JSON.stringify(opts.legacy, null, 2) + "\n", "utf8");
  const pagesDir = join(repoRoot, "specs", "pages");

  if (opts.ir !== undefined) {
    const pageDir = join(pagesDir, opts.pageId);
    mkdirSync(pageDir, { recursive: true });
    let ir: IRDocument;
    if (opts.ir === "from-legacy") {
      // Real round-trip — what the codemod would have produced.
      ir = projectLegacyToIR(opts.legacy as never, { docId: opts.pageId });
    } else if (opts.ir === "mismatched") {
      // Drop one state from the IR so its forward projection has fewer
      // groups than the legacy. Triggers `groupCount` mismatch.
      const fullIR = projectLegacyToIR(opts.legacy as never, {
        docId: opts.pageId,
      });
      ir = {
        ...fullIR,
        states: fullIR.states.slice(0, 1),
      };
    } else {
      ir = opts.ir;
    }
    writeFileSync(
      join(pageDir, "state-machine.derived.json"),
      JSON.stringify(ir, null, 2) + "\n",
      "utf8",
    );
    // Also write the projected spec.uibridge.json so the per-page directory
    // matches the layout the codemod produces — not strictly required for
    // this test, but keeps the fixture realistic.
    const projected = projectIRToBundledPage(ir);
    writeFileSync(
      join(pageDir, "spec.uibridge.json"),
      JSON.stringify(projected, null, 2) + "\n",
      "utf8",
    );
  }
  return { repoRoot, legacyPath, pagesDir, pageId: opts.pageId };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("parseArgs", () => {
  it("defaults mode to warn and all to false", () => {
    const args = parseArgs([]);
    expect(args.mode).toBe("warn");
    expect(args.all).toBe(false);
    expect(args.help).toBe(false);
  });

  it("parses --mode=block", () => {
    expect(parseArgs(["--mode=block"]).mode).toBe("block");
  });

  it("parses --root <path>", () => {
    expect(parseArgs(["--root", "/tmp/repo"]).root).toBe("/tmp/repo");
  });

  it("parses --root=<path>", () => {
    expect(parseArgs(["--root=/tmp/repo"]).root).toBe("/tmp/repo");
  });

  it("parses --all", () => {
    expect(parseArgs(["--all"]).all).toBe(true);
  });

  it("parses --app qontinui-runner", () => {
    expect(parseArgs(["--app", "qontinui-runner"]).app).toBe("qontinui-runner");
  });

  it("ignores --app values that aren't a known app", () => {
    expect(parseArgs(["--app", "qontinui-bogus"]).app).toBeUndefined();
  });
});

describe("checkOne — single-repo mode", () => {
  it("reports `paired` for a legacy spec with a matching IR file", () => {
    const fx = setupRunnerFixture({
      pageId: "active",
      legacy: SAMPLE_LEGACY,
      ir: "from-legacy",
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("paired");
    expect(result.pageId).toBe("active");
    expect(result.irPath).toBe(
      join(fx.pagesDir, "active", "state-machine.derived.json"),
    );
  });

  it("reports `missing` when the IR file is absent", () => {
    const fx = setupRunnerFixture({
      pageId: "no-ir",
      legacy: SAMPLE_LEGACY,
      // Intentionally omit `ir` — no state-machine.derived.json on disk.
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("missing");
    expect(result.irPath).toBe(
      join(fx.pagesDir, "no-ir", "state-machine.derived.json"),
    );
  });

  it("reports `mismatched` when the IR has a different group count than the legacy", () => {
    const fx = setupRunnerFixture({
      pageId: "drift",
      legacy: SAMPLE_LEGACY,
      ir: "mismatched",
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("mismatched");
    expect(result.mismatches).toBeDefined();
    // The fixture drops one state, so groupCount must differ.
    const fields = (result.mismatches ?? []).map((m) => m.field);
    expect(fields).toContain("groupCount");
  });
});

describe("runCheckPairingCli — exit codes by mode", () => {
  it("warn-mode exits 0 even when a spec is missing its IR", () => {
    const fx = setupRunnerFixture({
      pageId: "warn-missing",
      legacy: SAMPLE_LEGACY,
      // No IR.
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      ["--root", fx.repoRoot, "--app", "qontinui-runner", "--mode=warn"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/missing: 1/);
  });

  it("block-mode exits 1 when a spec is missing its IR", () => {
    const fx = setupRunnerFixture({
      pageId: "block-missing",
      legacy: SAMPLE_LEGACY,
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      ["--root", fx.repoRoot, "--app", "qontinui-runner", "--mode=block"],
      cap.io,
    );
    expect(code).toBe(1);
  });

  it("block-mode exits 0 when every spec is paired", () => {
    setupRunnerFixture({
      pageId: "block-paired",
      legacy: SAMPLE_LEGACY,
      ir: "from-legacy",
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      [
        "--root",
        join(workdir, "qontinui-runner"),
        "--app",
        "qontinui-runner",
        "--mode=block",
      ],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/paired: 1, missing: 0, mismatched: 0/);
  });

  it("auto-detects --app from the basename of --root when not passed", () => {
    setupRunnerFixture({
      pageId: "auto-detected",
      legacy: SAMPLE_LEGACY,
      ir: "from-legacy",
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      ["--root", join(workdir, "qontinui-runner"), "--mode=block"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/paired: 1/);
  });
});

// ===========================================================================
// IRPairingPolicy.acceptDrift
// ===========================================================================

describe("isPolicyExpired", () => {
  it("returns false when expiresAt is undefined", () => {
    const policy: IRAcceptDriftPolicy = {
      axes: ["assertionCount"],
      reason: "test",
      since: "2026-01-01",
    };
    expect(isPolicyExpired(policy)).toBe(false);
  });

  it("returns false when expiresAt is in the future", () => {
    const policy: IRAcceptDriftPolicy = {
      axes: ["assertionCount"],
      reason: "test",
      since: "2026-01-01",
      expiresAt: "2099-12-31",
    };
    expect(isPolicyExpired(policy)).toBe(false);
  });

  it("returns true when expiresAt is strictly before today", () => {
    const policy: IRAcceptDriftPolicy = {
      axes: ["assertionCount"],
      reason: "test",
      since: "2020-01-01",
      expiresAt: "2020-12-31",
    };
    // Pin "now" so the test is deterministic.
    expect(isPolicyExpired(policy, new Date("2026-05-03T00:00:00Z"))).toBe(true);
  });

  it("returns false when expiresAt is today (exclusive comparison)", () => {
    const policy: IRAcceptDriftPolicy = {
      axes: ["assertionCount"],
      reason: "test",
      since: "2020-01-01",
      expiresAt: "2026-05-03",
    };
    expect(isPolicyExpired(policy, new Date("2026-05-03T12:00:00Z"))).toBe(false);
  });
});

describe("applyAcceptDrift", () => {
  it("partitions mismatches into kept (unaccepted) and accepted (tolerated)", () => {
    const mismatches = [
      { field: "groupCount" as const, legacy: 3, ir: 2 },
      { field: "assertionCount" as const, legacy: 10, ir: 8 },
    ];
    const { kept, accepted } = applyAcceptDrift(mismatches, ["groupCount"]);
    expect(kept).toEqual([{ field: "assertionCount", legacy: 10, ir: 8 }]);
    expect(accepted).toEqual([{ field: "groupCount", legacy: 3, ir: 2 }]);
  });

  it("keeps everything when axes is empty", () => {
    const mismatches = [{ field: "groupCount" as const, legacy: 3, ir: 2 }];
    const { kept, accepted } = applyAcceptDrift(mismatches, []);
    expect(kept).toEqual(mismatches);
    expect(accepted).toEqual([]);
  });

  it("accepts everything when all axes are listed", () => {
    const mismatches = [
      { field: "groupCount" as const, legacy: 3, ir: 2 },
      { field: "assertionCount" as const, legacy: 10, ir: 8 },
    ];
    const allAxes: IRPairingAxis[] = [
      "groupCount",
      "groupIds",
      "assertionCount",
    ];
    const { kept, accepted } = applyAcceptDrift(mismatches, allAxes);
    expect(kept).toEqual([]);
    expect(accepted).toEqual(mismatches);
  });
});

/**
 * Build an IR document that diverges from `SAMPLE_LEGACY`'s shape, optionally
 * carrying a `pairingPolicy.acceptDrift` block. Used to exercise the policy
 * reader.
 */
function setupDriftFixture(opts: {
  pageId: string;
  policy?: IRAcceptDriftPolicy;
}) {
  // Build an IR where the IR's forward projection has fewer groups + fewer
  // assertions than SAMPLE_LEGACY — ordinary mismatch surface.
  const fullIR = projectLegacyToIR(SAMPLE_LEGACY as never, { docId: opts.pageId });
  const driftedIR: IRDocument & { pairingPolicy?: unknown } = {
    ...fullIR,
    states: fullIR.states.slice(0, 1),
  };
  if (opts.policy !== undefined) {
    driftedIR.pairingPolicy = { acceptDrift: opts.policy };
  }
  return setupRunnerFixture({
    pageId: opts.pageId,
    legacy: SAMPLE_LEGACY,
    ir: driftedIR as IRDocument,
  });
}

describe("checkOne — pairingPolicy.acceptDrift", () => {
  it("reports `accepted-drift` when policy covers all mismatched axes", () => {
    const fx = setupDriftFixture({
      pageId: "active",
      policy: {
        axes: ["groupCount", "groupIds", "assertionCount"],
        reason: "section-2 hand-authored canonical-state sample",
        since: "2026-04-15",
      },
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("accepted-drift");
    expect(result.acceptedAxes).toEqual(
      expect.arrayContaining(["groupCount", "assertionCount"]),
    );
    expect(result.policyReason).toBe(
      "section-2 hand-authored canonical-state sample",
    );
    expect(result.mismatches).toBeUndefined();
  });

  it("still reports `mismatched` when policy covers only some axes", () => {
    const fx = setupDriftFixture({
      pageId: "active-partial",
      policy: {
        axes: ["groupIds"], // doesn't cover groupCount/assertionCount
        reason: "partial",
        since: "2026-04-15",
      },
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("mismatched");
    // The remaining unaccepted axes should be in mismatches.
    const fields = (result.mismatches ?? []).map((m) => m.field);
    expect(fields).toContain("groupCount");
  });

  it("ignores policy when expiresAt has passed and downgrades to `mismatched`", () => {
    const fx = setupDriftFixture({
      pageId: "expired",
      policy: {
        axes: ["groupCount", "groupIds", "assertionCount"],
        reason: "stale",
        since: "2020-01-01",
        expiresAt: "2020-12-31",
      },
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("mismatched");
    expect(result.policyExpired).toBe(true);
    expect(result.policyReason).toBe("stale");
  });

  it("still reports `paired` when there are no mismatches even with a policy declared", () => {
    // Use `from-legacy` IR (clean round-trip) plus a policy block — the
    // policy should be a no-op since there's nothing to filter.
    const cleanIR = projectLegacyToIR(SAMPLE_LEGACY as never, {
      docId: "clean-with-policy",
    });
    const irWithPolicy = {
      ...cleanIR,
      pairingPolicy: {
        acceptDrift: {
          axes: ["groupCount" as const],
          reason: "unused",
          since: "2026-01-01",
        },
      },
    };
    const fx = setupRunnerFixture({
      pageId: "clean-with-policy",
      legacy: SAMPLE_LEGACY,
      ir: irWithPolicy as IRDocument,
    });
    const result = checkOne(fx.legacyPath, fx.repoRoot, "qontinui-runner");
    expect(result.status).toBe("paired");
    expect(result.acceptedAxes).toBeUndefined();
  });
});

describe("runCheckPairingCli — block mode honors acceptDrift", () => {
  it("exits 0 in block mode when all mismatches are policy-tolerated", () => {
    const fullIR = projectLegacyToIR(SAMPLE_LEGACY as never, { docId: "active" });
    const driftedIR = {
      ...fullIR,
      states: fullIR.states.slice(0, 1),
      pairingPolicy: {
        acceptDrift: {
          axes: ["groupCount", "groupIds", "assertionCount"],
          reason: "intentional",
          since: "2026-04-15",
        },
      },
    };
    setupRunnerFixture({
      pageId: "active",
      legacy: SAMPLE_LEGACY,
      ir: driftedIR as IRDocument,
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      [
        "--root",
        join(workdir, "qontinui-runner"),
        "--app",
        "qontinui-runner",
        "--mode=block",
      ],
      cap.io,
    );
    expect(code).toBe(0);
    expect(cap.stdout).toMatch(/accepted-drift: 1/);
    expect(cap.stdout).toMatch(/mismatched: 0/);
  });

  it("exits 1 in block mode when an exempted policy has expired", () => {
    const fullIR = projectLegacyToIR(SAMPLE_LEGACY as never, { docId: "expired" });
    const driftedIR = {
      ...fullIR,
      states: fullIR.states.slice(0, 1),
      pairingPolicy: {
        acceptDrift: {
          axes: ["groupCount", "groupIds", "assertionCount"],
          reason: "stale",
          since: "2020-01-01",
          expiresAt: "2020-12-31",
        },
      },
    };
    setupRunnerFixture({
      pageId: "expired",
      legacy: SAMPLE_LEGACY,
      ir: driftedIR as IRDocument,
    });
    const cap = captureIO();
    const code = runCheckPairingCli(
      [
        "--root",
        join(workdir, "qontinui-runner"),
        "--app",
        "qontinui-runner",
        "--mode=block",
      ],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stdout).toMatch(/expired-policies: 1/);
    expect(cap.stderr).toMatch(/policy EXPIRED/);
  });
});
