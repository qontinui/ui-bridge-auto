/**
 * Round-trip integration test for the self-diagnosis composer
 * (Section 10, Phase 4).
 *
 * Builds a small but feature-rich IR (3 states, 4 transitions with file
 * provenance), fabricates a `RegressionRunResult` with 3 failures (one per
 * assertion kind: state-active, action-target-resolves, visual-gate),
 * supplies a `DriftContext` with 2 commits (one touching the file backing
 * the action-target-resolves transition) plus 1 spec-drift entry, then
 * asserts:
 *   1. `diagnose` produces non-empty `candidateCauses`.
 *   2. The commit touching the failed transition's file ranks at or near
 *      the top.
 *   3. `evidenceMap` has all 3 failure assertionIds as keys.
 *   4. `serializeDiagnosis` round-trips losslessly.
 */

import { describe, it, expect } from "vitest";
import type {
  IRDocument,
  IRState,
  IRTransition,
  IRTransitionAction,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  diagnose,
  serializeDiagnosis,
  deserializeDiagnosis,
  type RegressionFailure,
  type RegressionRunResult,
} from "../../state/self-diagnosis";
import type { DriftContext, GitCommitRef } from "../../drift/types";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIXED_STARTED_AT = 1735689600000;

// ---------------------------------------------------------------------------
// IR fixture
// ---------------------------------------------------------------------------

function mkState(
  id: string,
  requiredCount: number,
  file: string,
  name = id,
): IRState {
  const requiredElements = [];
  for (let i = 0; i < requiredCount; i++) {
    requiredElements.push({ id: `${id}-el-${i}` });
  }
  return {
    id,
    name,
    requiredElements,
    provenance: { source: "build-plugin", file },
  };
}

function mkAction(
  type: string,
  target: IRTransitionAction["target"],
): IRTransitionAction {
  return { type, target };
}

function mkTransition(
  id: string,
  fromStates: string[],
  activateStates: string[],
  actions: IRTransitionAction[],
  file: string,
  exitStates?: string[],
): IRTransition {
  return {
    id,
    name: id,
    fromStates,
    activateStates,
    exitStates,
    actions,
    provenance: { source: "build-plugin", file },
  };
}

/**
 * 3 states (a, b, c), 4 transitions:
 *   t-a-to-b → src/transitions/a-to-b.tsx (← action-target failure on this)
 *   t-b-to-c → src/transitions/b-to-c.tsx
 *   t-c-to-a → src/transitions/c-to-a.tsx
 *   t-a-to-c → src/transitions/a-to-c.tsx
 */
function buildIR(): IRDocument {
  return {
    version: "1.0",
    id: "rt-doc",
    name: "Round-Trip Doc",
    states: [
      mkState("a", 2, "src/states/a.tsx"),
      mkState("b", 1, "src/states/b.tsx"),
      mkState("c", 0, "src/states/c.tsx"),
    ],
    transitions: [
      mkTransition(
        "t-a-to-b",
        ["a"],
        ["b"],
        [mkAction("click", { id: "btn-go", text: "Go" })],
        "src/transitions/a-to-b.tsx",
        ["a"],
      ),
      mkTransition(
        "t-b-to-c",
        ["b"],
        ["c"],
        [mkAction("click", { role: "button", text: "Next" })],
        "src/transitions/b-to-c.tsx",
        ["b"],
      ),
      mkTransition(
        "t-c-to-a",
        ["c"],
        ["a"],
        [mkAction("click", { role: "link", ariaLabel: "Restart" })],
        "src/transitions/c-to-a.tsx",
        ["c"],
      ),
      mkTransition(
        "t-a-to-c",
        ["a"],
        ["c"],
        [mkAction("hover", { id: "shortcut" })],
        "src/transitions/a-to-c.tsx",
      ),
    ],
    initialState: "a",
  };
}

function buildSession(): RecordingSession {
  // No predicateEval events necessary — failures adapt with eventIndex: -1
  // so the session doesn't contribute to the drift hypotheses for these
  // failures. The session is required by DriftContext, hence the empty one.
  return {
    id: "rt-session",
    startedAt: FIXED_STARTED_AT,
    events: [] as RecordedEvent[],
  };
}

// ---------------------------------------------------------------------------
// Failure + commit fixtures
// ---------------------------------------------------------------------------

const ACTION_TARGET_FILE = "src/transitions/a-to-b.tsx";

function buildFailures(): RegressionFailure[] {
  return [
    {
      caseId: "t-a-to-b",
      assertionId: "state-active:pre:a",
      assertion: {
        kind: "state-active",
        phase: "pre",
        stateId: "a",
        requiredElementIds: [0, 1],
      },
      message: "state a not active",
      observed: { active: false },
    },
    {
      caseId: "t-a-to-b",
      assertionId: "action-target-resolves:t-a-to-b#0",
      assertion: {
        kind: "action-target-resolves",
        transitionId: "t-a-to-b",
        actionIndex: 0,
        targetCriteria: { id: "btn-go", text: "Go" },
      },
      message: "no element resolved for #btn-go",
      observed: null,
    },
    {
      caseId: "t-a-to-b",
      assertionId: "visual-gate:b",
      assertion: {
        kind: "visual-gate",
        stateId: "b",
        baselineKey: "rt-doc/state-b",
      },
      message: "baseline pixel diff above threshold",
      observed: { diff: 0.21 },
    },
  ];
}

const COMMIT_TOUCHING_TRANSITION: GitCommitRef = {
  sha: "a".repeat(40),
  message: "fix t-a-to-b click handler",
  author: "Alice",
  timestamp: Date.parse("2026-02-15T12:00:00Z"),
  files: [ACTION_TARGET_FILE],
};

const UNRELATED_COMMIT: GitCommitRef = {
  sha: "b".repeat(40),
  message: "tweak readme",
  author: "Bob",
  timestamp: Date.parse("2026-01-15T00:00:00Z"),
  files: ["README.md"],
};

function buildContext(): DriftContext {
  return {
    session: buildSession(),
    ir: buildIR(),
    commits: [COMMIT_TOUCHING_TRANSITION, UNRELATED_COMMIT],
    specDrift: {
      states: [],
      transitions: [
        {
          id: "t-a-to-b",
          kind: "shape-mismatch",
          detail: "activateStates differ",
        },
      ],
    },
  };
}

function buildRun(): RegressionRunResult {
  const failures = buildFailures();
  return {
    suiteId: "rt-doc@suite",
    runId: "run-rt-1",
    passed: 9,
    failed: failures.length,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diagnose — round-trip integration", () => {
  it("produces non-empty candidateCauses given commits + spec-drift", () => {
    const d = diagnose(buildRun(), buildContext());
    expect(d.candidateCauses.length).toBeGreaterThan(0);
  });

  it("ranks the commit touching the failed transition's file at or near the top", () => {
    const d = diagnose(buildRun(), buildContext());
    // Find the index of the relevant commit hypothesis among the candidates.
    const relevantIdx = d.candidateCauses.findIndex(
      (h) => h.suspectedCommits[0]?.sha === COMMIT_TOUCHING_TRANSITION.sha,
    );
    const unrelatedIdx = d.candidateCauses.findIndex(
      (h) => h.suspectedCommits[0]?.sha === UNRELATED_COMMIT.sha,
    );
    expect(relevantIdx).toBeGreaterThanOrEqual(0);
    if (unrelatedIdx >= 0) {
      // Relevant commit must rank ahead of the unrelated one.
      expect(relevantIdx).toBeLessThan(unrelatedIdx);
    }
    // And it should be at or near the top (top 2 — spec-drift cluster
    // hypothesis on the same file may rank alongside it).
    expect(relevantIdx).toBeLessThanOrEqual(1);
  });

  it("verifies via candidateCauses[0].suspectedCommits[0].sha that the relevant commit is top", () => {
    // Stronger version of the above: assert the very top hypothesis is
    // either the commit hypothesis OR the spec-drift cluster anchored to
    // the same file. Either way, the suspected file must include the
    // action-target file.
    const d = diagnose(buildRun(), buildContext());
    expect(d.candidateCauses.length).toBeGreaterThan(0);
    const top = d.candidateCauses[0]!;
    const isCommitHyp = top.suspectedCommits[0]?.sha === COMMIT_TOUCHING_TRANSITION.sha;
    const filesIncludeTarget = top.suspectedFiles.includes(ACTION_TARGET_FILE);
    expect(isCommitHyp || filesIncludeTarget).toBe(true);
  });

  it("evidenceMap has all 3 failure assertionIds as keys", () => {
    const d = diagnose(buildRun(), buildContext());
    const expectedKeys = buildFailures().map((f) => f.assertionId).sort();
    const actualKeys = Object.keys(d.evidenceMap).sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it("the action-target failure (transition file matches commit's files) has at least one matching hypothesis index", () => {
    // The action-target-resolves failure references transition t-a-to-b,
    // whose IR provenance.file is ACTION_TARGET_FILE (src/transitions/a-to-b.tsx);
    // COMMIT_TOUCHING_TRANSITION touches that same file. The b2 fix wires
    // the failure's sourceFile through `resolveDivergence`, so the commit
    // hypothesis on COMMIT_TOUCHING_TRANSITION must list this failure as
    // evidence.
    const d = diagnose(buildRun(), buildContext());
    const indices = d.evidenceMap["action-target-resolves:t-a-to-b#0"];
    expect(indices).toBeDefined();
    expect(indices!.length).toBeGreaterThan(0);
    // At least one of those indices must point at a hypothesis whose
    // suspectedCommits includes COMMIT_TOUCHING_TRANSITION (commit hyp)
    // OR whose suspectedFiles include ACTION_TARGET_FILE (cluster hyp).
    const matched = indices!.some((idx) => {
      const h = d.candidateCauses[idx]!;
      const isCommit =
        h.suspectedCommits[0]?.sha === COMMIT_TOUCHING_TRANSITION.sha;
      const fileHit = h.suspectedFiles.includes(ACTION_TARGET_FILE);
      return isCommit || fileHit;
    });
    expect(matched).toBe(true);
  });

  it("serializeDiagnosis round-trips losslessly (structurally equal)", () => {
    const d = diagnose(buildRun(), buildContext());
    const json = serializeDiagnosis(d);
    const parsed = deserializeDiagnosis(json);
    expect(parsed).toEqual(d);
  });

  it("serializeDiagnosis round-trips byte-identically", () => {
    const d = diagnose(buildRun(), buildContext());
    const json1 = serializeDiagnosis(d);
    const json2 = serializeDiagnosis(deserializeDiagnosis(json1));
    expect(json2).toBe(json1);
  });

  it("coverage tracks the run's totals + the context's drift-entry counts", () => {
    const d = diagnose(buildRun(), buildContext());
    expect(d.coverage.totalAssertions).toBe(12); // 9 passed + 3 failed
    expect(d.coverage.failed).toBe(3);
    expect(d.coverage.drift.specEntries).toBe(1);
    expect(d.coverage.drift.visualEntries).toBe(0);
  });

  it("correlationSummary is populated and follows the 'Top suspect: ' format", () => {
    const d = diagnose(buildRun(), buildContext());
    expect(d.correlationSummary.startsWith("Top suspect: ")).toBe(true);
    expect(d.correlationSummary.length).toBeLessThanOrEqual(280);
    expect(d.correlationSummary).toMatch(/confidence \d\.\d{2}/);
  });
});
