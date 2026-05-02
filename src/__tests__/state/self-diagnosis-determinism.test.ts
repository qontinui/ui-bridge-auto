/**
 * Determinism gate for the self-diagnosis composer (Section 10, Phase 4).
 *
 * Mirrors `regression-generator-determinism.test.ts` and
 * `hypothesis-determinism.test.ts`: the SAME `failedRun` + `DriftContext` +
 * `DiagnoseOptions` run 10x must produce byte-identical
 * `serializeDiagnosis(...)` output. If this test ever fails, the diagnose
 * function (or one of its inputs through `buildDriftHypotheses`) has
 * acquired a non-determinism leak — Map iteration order escaping into
 * output, an unstable sort, `Date.now()`, etc. Fix the leak. Do NOT relax
 * this test.
 */

import { describe, it, expect } from "vitest";
import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import {
  diagnose,
  serializeDiagnosis,
  type DiagnoseOptions,
  type RegressionFailure,
  type RegressionRunResult,
} from "../../state/self-diagnosis";
import type {
  DriftContext,
  GitCommitRef,
} from "../../drift/types";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";
import type { FragilityScore } from "../../counterfactual/types";

// ---------------------------------------------------------------------------
// Constants — fixed timestamps + ids. NEVER derived from Date.now() / random.
// ---------------------------------------------------------------------------

const RUNS = 10;
const FIXED_STARTED_AT = 1735689600000;
const FIXED_TS = 1735689600100;

// ---------------------------------------------------------------------------
// Fixture builders — deliberately rebuilt fresh on each call so no shared
// mutable state can leak between runs of the determinism gate.
// ---------------------------------------------------------------------------

function buildSession(): RecordingSession {
  const events: RecordedEvent[] = [
    {
      id: "evt-1",
      timestamp: FIXED_TS,
      type: "predicateEval",
      causedBy: null,
      data: {
        predicateId: "state-A",
        target: "A",
        matched: true,
      },
    },
  ];
  return {
    id: "fixture-session",
    startedAt: FIXED_STARTED_AT,
    events,
  };
}

function buildIR(): IRDocument {
  return {
    version: "1.0",
    id: "doc-1",
    name: "Doc 1",
    states: [
      {
        id: "state-A",
        name: "State A",
        requiredElements: [{ id: "el-0" }, { id: "el-1" }],
        provenance: { source: "build-plugin", file: "src/a.tsx" },
      },
      {
        id: "state-B",
        name: "State B",
        requiredElements: [{ id: "el-0" }],
        provenance: { source: "build-plugin", file: "src/b.tsx" },
      },
    ],
    transitions: [
      {
        id: "t-a-to-b",
        name: "t-a-to-b",
        fromStates: ["state-A"],
        activateStates: ["state-B"],
        actions: [
          { type: "click", target: { id: "btn-go" } },
        ],
        provenance: { source: "build-plugin", file: "src/a.tsx" },
      },
    ],
  };
}

function buildFailures(): RegressionFailure[] {
  // Authored out of (assertionId, caseId) order on purpose so the diagnose
  // function's internal sort gets exercised.
  return [
    {
      caseId: "t-a-to-b",
      assertionId: "overlay-visibility-state-A-el-0",
      assertion: {
        kind: "overlay",
        overlayId: "visibility",
        assertionId: "overlay-visibility-state-A-el-0",
        payload: { stateId: "state-A", elementIndex: 0 },
      },
      message: "element not visible",
      observed: { visible: false },
    },
    {
      caseId: "t-a-to-b",
      assertionId: "action-target-resolves:t-a-to-b#0",
      assertion: {
        kind: "action-target-resolves",
        transitionId: "t-a-to-b",
        actionIndex: 0,
        targetCriteria: { id: "btn-go" },
      },
      message: "no element resolved for criteria",
      observed: null,
    },
    {
      caseId: "t-a-to-b",
      assertionId: "state-active:pre:state-A",
      assertion: {
        kind: "state-active",
        phase: "pre",
        stateId: "state-A",
        requiredElementIds: [0, 1],
      },
      message: "state A not active",
    },
  ];
}

function buildRunResult(): RegressionRunResult {
  return {
    suiteId: "doc-1@suite",
    runId: "run-fixture",
    passed: 5,
    failed: 3,
    failures: buildFailures(),
  };
}

function buildPriors(): FragilityScore[] {
  return [
    {
      eventId: "evt-1",
      predicateId: "state-A",
      forwardClosureSize: 3,
      traceSize: 5,
      score: 0.6,
    },
  ];
}

function buildCommits(): GitCommitRef[] {
  return [
    {
      sha: "a".repeat(40),
      message: "fix state-A button",
      author: "Alice",
      timestamp: Date.parse("2026-02-01T00:00:00Z"),
      files: ["src/a.tsx"],
    },
    {
      sha: "b".repeat(40),
      message: "tweak state-B",
      author: "Bob",
      timestamp: Date.parse("2026-01-15T00:00:00Z"),
      files: ["src/b.tsx"],
    },
    {
      sha: "c".repeat(40),
      message: "unrelated readme",
      author: "Carol",
      timestamp: Date.parse("2026-01-01T00:00:00Z"),
      files: ["README.md"],
    },
  ];
}

/**
 * Fixture A — multiple failures, multiple kinds, full DriftContext (commits +
 * priors + spec/visual drift + IR).
 */
function buildContextFull(): DriftContext {
  return {
    session: buildSession(),
    ir: buildIR(),
    commits: buildCommits(),
    priors: buildPriors(),
    specDrift: {
      states: [
        {
          id: "state-A",
          kind: "shape-mismatch",
          detail: "requiredElements length differs — IR=2 runtime=1",
        },
      ],
      transitions: [],
    },
    visualDrift: {
      states: [
        {
          id: "state-B",
          kind: "visual-drift",
          detail: "5px shift on state-B baseline",
        },
      ],
      transitions: [],
    },
  };
}

/**
 * Fixture B — only commits supplied; no IR, no priors, no spec/visual drift.
 * Exercises the graceful-degradation paths in `buildDriftHypotheses`.
 */
function buildContextCommitsOnly(): DriftContext {
  return {
    session: buildSession(),
    commits: buildCommits(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diagnose — determinism gate", () => {
  it("produces byte-identical serialized diagnosis across 10 runs (full context, multiple failures)", () => {
    const opts: DiagnoseOptions = { topN: 5 };
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const run = buildRunResult();
      const ctx = buildContextFull();
      const d = diagnose(run, ctx, opts);
      serialized.push(serializeDiagnosis(d));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical serialized diagnosis across 10 runs (commits-only context, multiple failures)", () => {
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const run = buildRunResult();
      const ctx = buildContextCommitsOnly();
      const d = diagnose(run, ctx);
      serialized.push(serializeDiagnosis(d));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output regardless of input failure order", () => {
    // Same set, shuffled. The diagnose function must sort failures
    // internally so the output is the same regardless of input order.
    const baseline = serializeDiagnosis(
      diagnose(buildRunResult(), buildContextFull()),
    );
    const shuffledRun: RegressionRunResult = {
      ...buildRunResult(),
      failures: [...buildFailures()].reverse(),
    };
    const reshuffled = serializeDiagnosis(
      diagnose(shuffledRun, buildContextFull()),
    );
    expect(reshuffled).toBe(baseline);
  });

  it("produces byte-identical output across 10 runs with topN=2 (overrides default)", () => {
    const opts: DiagnoseOptions = { topN: 2 };
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const run = buildRunResult();
      const ctx = buildContextFull();
      const d = diagnose(run, ctx, opts);
      serialized.push(serializeDiagnosis(d));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output across 10 runs with empty failures", () => {
    const emptyRun: RegressionRunResult = {
      suiteId: "empty-suite",
      runId: "empty-run",
      passed: 0,
      failed: 0,
      failures: [],
    };
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = buildContextFull();
      const d = diagnose(emptyRun, ctx);
      serialized.push(serializeDiagnosis(d));
    }
    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });
});
