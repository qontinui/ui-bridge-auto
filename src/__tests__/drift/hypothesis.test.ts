/**
 * Unit tests for `buildDriftHypotheses` (Section 7 Phase 1).
 *
 * Cases:
 *   1. One divergence + one commit that touched the obvious file → that
 *      commit ranks first with confidence ≥ 0.8.
 *   2. Multiple commits where one obviously didn't touch any relevant file
 *      → the irrelevant commit ranks lower than the relevant one.
 *   3. Empty inputs → empty array (no throw).
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
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_STARTED_AT = 1735689600000;
const FIXED_TS = 1735689600100;

/** A session with one predicateEval pointing to a state with a known source file. */
function buildSession(): RecordingSession {
  const events: RecordedEvent[] = [
    {
      id: "evt-1",
      timestamp: FIXED_TS,
      type: "predicateEval",
      causedBy: null,
      data: {
        predicateId: "submit-form-state",
        target: "Submit form",
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

/** IR document mapping the predicateId back to a source file via provenance.file. */
function buildIR(): IRDocument {
  return {
    version: "1.0",
    id: "doc-1",
    name: "Doc 1",
    states: [
      {
        id: "submit-form-state",
        name: "Submit Form",
        assertions: [],
        provenance: {
          source: "build-plugin",
          file: "src/forms/submit-form.tsx",
        },
      },
    ],
    transitions: [],
  };
}

/** A predicate-mismatch divergence at eventIndex 0 (the predicateEval event). */
function buildDivergence(): DivergenceLike {
  return {
    eventIndex: 0,
    kind: "predicateOutcomeMismatch",
    expected: { matched: true },
    actual: { matched: false },
    message: "predicate submit-form-state mismatched",
  };
}

const RELEVANT_COMMIT: GitCommitRef = {
  sha: "a".repeat(40),
  message: "fix submit-form click handler",
  author: "Alice",
  timestamp: Date.parse("2026-01-15T12:00:00Z"),
  files: ["src/forms/submit-form.tsx"],
};

const IRRELEVANT_COMMIT: GitCommitRef = {
  sha: "b".repeat(40),
  // Older — recency component will also be 0 for this one.
  message: "tweak unrelated readme",
  author: "Bob",
  timestamp: Date.parse("2026-01-01T00:00:00Z"),
  files: ["README.md"],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDriftHypotheses", () => {
  it("returns an empty array for empty inputs", () => {
    const session: RecordingSession = {
      id: "empty",
      startedAt: FIXED_STARTED_AT,
      events: [],
    };
    const out = buildDriftHypotheses([], { session, commits: [] });
    expect(out).toEqual([]);
  });

  it("ranks the obvious commit first with confidence >= 0.8 when fragility + file overlap match", () => {
    const session = buildSession();
    const ir = buildIR();
    const divergences = [buildDivergence()];
    const priors: FragilityScore[] = [
      {
        eventId: "evt-1",
        predicateId: "submit-form-state",
        forwardClosureSize: 1,
        traceSize: 1,
        score: 1.0,
      },
    ];
    const context: DriftContext = {
      session,
      ir,
      commits: [RELEVANT_COMMIT],
      priors,
    };

    const out = buildDriftHypotheses(divergences, context);

    expect(out.length).toBeGreaterThan(0);
    expect(out[0].suspectedCommits[0].sha).toBe(RELEVANT_COMMIT.sha);
    expect(out[0].confidence).toBeGreaterThanOrEqual(0.8);
    expect(out[0].evidence).toHaveLength(1);
    expect(out[0].suspectedFiles).toEqual(["src/forms/submit-form.tsx"]);
  });

  it("ranks an irrelevant commit lower than a relevant one", () => {
    const session = buildSession();
    const ir = buildIR();
    const divergences = [buildDivergence()];
    const priors: FragilityScore[] = [
      {
        eventId: "evt-1",
        predicateId: "submit-form-state",
        forwardClosureSize: 1,
        traceSize: 1,
        score: 1.0,
      },
    ];
    const context: DriftContext = {
      session,
      ir,
      commits: [IRRELEVANT_COMMIT, RELEVANT_COMMIT],
      priors,
    };

    const out = buildDriftHypotheses(divergences, context);

    // Both commits produce a hypothesis. The relevant one must rank ahead.
    const relevantIdx = out.findIndex(
      (h) => h.suspectedCommits[0]?.sha === RELEVANT_COMMIT.sha,
    );
    const irrelevantIdx = out.findIndex(
      (h) => h.suspectedCommits[0]?.sha === IRRELEVANT_COMMIT.sha,
    );
    expect(relevantIdx).toBeGreaterThanOrEqual(0);
    expect(irrelevantIdx).toBeGreaterThanOrEqual(0);
    expect(relevantIdx).toBeLessThan(irrelevantIdx);
    expect(out[relevantIdx].confidence).toBeGreaterThan(
      out[irrelevantIdx].confidence,
    );
  });

  it("does not throw when the IR is missing — falls back gracefully", () => {
    const session = buildSession();
    const divergences = [buildDivergence()];
    const context: DriftContext = {
      session,
      commits: [RELEVANT_COMMIT],
    };

    const out = buildDriftHypotheses(divergences, context);
    expect(out).toHaveLength(1);
    // Without IR resolution there's no file overlap signal — confidence
    // collapses but the engine still produces a hypothesis with the
    // commit's own files as the fallback `suspectedFiles`.
    expect(out[0].suspectedFiles).toEqual(["src/forms/submit-form.tsx"]);
  });

  it("emits a spec-drift cluster hypothesis when specDrift entries are present", () => {
    const session = buildSession();
    const ir = buildIR();
    const divergences: DivergenceLike[] = [];
    const context: DriftContext = {
      session,
      ir,
      commits: [RELEVANT_COMMIT],
      specDrift: {
        states: [
          {
            id: "submit-form-state",
            kind: "shape-mismatch",
            detail: "requiredElements length differs",
          },
        ],
        transitions: [],
      },
    };

    const out = buildDriftHypotheses(divergences, context);
    const clusterHyp = out.find((h) =>
      h.hypothesis.startsWith("spec drift cluster"),
    );
    expect(clusterHyp).toBeDefined();
    expect(clusterHyp?.suspectedFiles).toEqual(["src/forms/submit-form.tsx"]);
    expect(clusterHyp?.suspectedCommits[0]?.sha).toBe(RELEVANT_COMMIT.sha);
    expect(clusterHyp?.confidence).toBeGreaterThan(0);
  });

  it("breaks ties on equal confidence by suspectedCommits[0].timestamp desc", () => {
    // Two commits that BOTH overlap the divergent file; with identical
    // priors and identical (non-zero) recency, confidence is identical.
    // Newest commit must rank first.
    const session = buildSession();
    const ir = buildIR();
    const divergences = [buildDivergence()];
    const newer: GitCommitRef = {
      sha: "1".repeat(40),
      message: "newer fix",
      author: "X",
      timestamp: Date.parse("2026-02-01T00:00:00Z"),
      files: ["src/forms/submit-form.tsx"],
    };
    const older: GitCommitRef = {
      sha: "0".repeat(40),
      message: "older fix",
      author: "Y",
      timestamp: Date.parse("2026-01-01T00:00:00Z"),
      files: ["src/forms/submit-form.tsx"],
    };
    const context: DriftContext = {
      session,
      ir,
      commits: [older, newer],
    };

    const out = buildDriftHypotheses(divergences, context);
    expect(out[0].suspectedCommits[0].sha).toBe(newer.sha);
  });
});
