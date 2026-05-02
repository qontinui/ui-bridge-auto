/**
 * Determinism gate for the drift-hypothesis engine.
 *
 * Mirrors the structure of the counterfactual explorer's determinism gate:
 * the SAME inputs run 10× must produce byte-identical output. If this test
 * ever fails, the engine has acquired a non-determinism leak (Map iteration
 * order escaping into output, unstable sort, `Date.now()`, etc.). Fix the
 * leak — do NOT relax the test.
 */

import { describe, it, expect } from "vitest";
import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import type { DivergenceLike, FragilityScore } from "../../counterfactual/types";
import { buildDriftHypotheses } from "../../drift/hypothesis";
import type { DriftContext, GitCommitRef } from "../../drift/types";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";

// ---------------------------------------------------------------------------
// Constants — fixed timestamps + ids. NEVER derived from Date.now() / random.
// ---------------------------------------------------------------------------

const FIXED_STARTED_AT = 1735689600000;
const FIXED_TS = 1735689600100;

const RUNS = 10;

// ---------------------------------------------------------------------------
// Fixtures — deliberately built fresh in each run so no shared mutable
// state can leak between runs.
// ---------------------------------------------------------------------------

function buildSession(): RecordingSession {
  const events: RecordedEvent[] = [
    {
      id: "evt-pred-A",
      timestamp: FIXED_TS,
      type: "predicateEval",
      causedBy: null,
      data: {
        predicateId: "state-A",
        target: "A",
        matched: true,
      },
    },
    {
      id: "evt-pred-B",
      timestamp: FIXED_TS,
      type: "predicateEval",
      causedBy: null,
      data: {
        predicateId: "state-B",
        target: "B",
        matched: false,
      },
    },
  ];
  return {
    id: "fixture-determinism",
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
        requiredElements: [],
        provenance: { source: "build-plugin", file: "src/a.tsx" },
      },
      {
        id: "state-B",
        name: "State B",
        requiredElements: [],
        provenance: { source: "build-plugin", file: "src/b.tsx" },
      },
    ],
    transitions: [],
  };
}

function buildDivergences(): DivergenceLike[] {
  return [
    {
      eventIndex: 0,
      kind: "predicateOutcomeMismatch",
      expected: { matched: true },
      actual: { matched: false },
      message: "predicate state-A mismatched",
    },
    {
      eventIndex: 1,
      kind: "predicateOutcomeMismatch",
      expected: { matched: false },
      actual: { matched: true },
      message: "predicate state-B mismatched",
    },
  ];
}

function buildPriors(): FragilityScore[] {
  return [
    {
      eventId: "evt-pred-A",
      predicateId: "state-A",
      forwardClosureSize: 3,
      traceSize: 5,
      score: 0.6,
    },
    {
      eventId: "evt-pred-B",
      predicateId: "state-B",
      forwardClosureSize: 1,
      traceSize: 5,
      score: 0.2,
    },
  ];
}

function buildCommits(): GitCommitRef[] {
  return [
    {
      sha: "a".repeat(40),
      message: "fix state-A",
      author: "Alice",
      timestamp: Date.parse("2026-02-01T00:00:00Z"),
      files: ["src/a.tsx", "src/shared.ts"],
    },
    {
      sha: "b".repeat(40),
      message: "fix state-B",
      author: "Bob",
      timestamp: Date.parse("2026-01-15T00:00:00Z"),
      files: ["src/b.tsx"],
    },
    {
      sha: "c".repeat(40),
      message: "unrelated readme tweak",
      author: "Carol",
      timestamp: Date.parse("2026-01-01T00:00:00Z"),
      files: ["README.md"],
    },
  ];
}

function buildContext(): DriftContext {
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
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDriftHypotheses — determinism gate", () => {
  it("produces byte-identical output across 10 runs of the same inputs", () => {
    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const divergences = buildDivergences();
      const context = buildContext();
      const out = buildDriftHypotheses(divergences, context);
      serialized.push(JSON.stringify(out));
    }

    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical output when divergences arrive in different order", () => {
    // Same set, shuffled. The engine must sort internally so the output
    // is the same regardless of input order.
    const baseline = JSON.stringify(
      buildDriftHypotheses(buildDivergences(), buildContext()),
    );
    const shuffled = [...buildDivergences()].reverse();
    const reshuffled = JSON.stringify(
      buildDriftHypotheses(shuffled, buildContext()),
    );
    expect(reshuffled).toBe(baseline);
  });

  it("produces byte-identical output when commits arrive in different order", () => {
    const ctxA = buildContext();
    const ctxB = buildContext();
    ctxB.commits = [...ctxB.commits].reverse();

    const a = JSON.stringify(buildDriftHypotheses(buildDivergences(), ctxA));
    const b = JSON.stringify(buildDriftHypotheses(buildDivergences(), ctxB));
    expect(b).toBe(a);
  });
});
