/**
 * Determinism gate for the counterfactual explorer.
 *
 * Mirrors the structure of `recording/causal-replay-determinism.test.ts`:
 * the SAME perturbation applied to the SAME fixture session must produce
 * byte-identical reports across N runs. The explorer is pure (no Date.now,
 * no Math.random, no async timers), so the comparison is full JSON equality —
 * there are no wall-clock fields to exclude.
 *
 * If this test ever fails, the explorer has acquired a non-determinism leak
 * (Map/Set iteration order escaping into output, unstable sort, etc.). Fix
 * the leak, do not relax the test.
 */

import { describe, it, expect } from "vitest";
import {
  exploreCounterfactual,
  type Perturbation,
} from "../../counterfactual";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";

// ---------------------------------------------------------------------------
// Constants — fixed timestamps + ids. Never derived from Date.now() / random.
// ---------------------------------------------------------------------------

const FIXED_STARTED_AT = 1735689600000;
const FIXED_TS = 1735689600100;

const ACTION_ID = "evt-fixture-1";
const STATE_CHANGE_ID = "evt-fixture-2";
const ELEMENT_APPEARED_ID = "evt-fixture-3";
const ELEMENT_DISAPPEARED_ID = "evt-fixture-4";
const SNAPSHOT_ID = "evt-fixture-5";
const PREDICATE_EVAL_ID = "evt-fixture-6";

// ---------------------------------------------------------------------------
// Fixture — copied locally (self-contained) from causal-replay-determinism.
// ---------------------------------------------------------------------------

function buildFixtureSession(): RecordingSession {
  const events: RecordedEvent[] = [
    {
      id: ACTION_ID,
      timestamp: FIXED_TS,
      type: "action",
      causedBy: null,
      data: {
        actionType: "click",
        elementId: "btn-fixture",
        elementLabel: "Fixture Button",
        success: true,
        durationMs: 12,
      },
    },
    {
      id: STATE_CHANGE_ID,
      timestamp: FIXED_TS,
      type: "stateChange",
      causedBy: ACTION_ID,
      data: {
        entered: ["dialog-open"],
        exited: ["idle"],
        activeStates: ["dialog-open"],
      },
    },
    {
      id: ELEMENT_APPEARED_ID,
      timestamp: FIXED_TS,
      type: "elementAppeared",
      causedBy: ACTION_ID,
      data: { elementId: "dialog-1", elementLabel: "Dialog" },
    },
    {
      id: ELEMENT_DISAPPEARED_ID,
      timestamp: FIXED_TS,
      type: "elementDisappeared",
      causedBy: STATE_CHANGE_ID,
      data: { elementId: "spinner-1", elementLabel: "Spinner" },
    },
    {
      id: SNAPSHOT_ID,
      timestamp: FIXED_TS,
      type: "snapshot",
      causedBy: null,
      data: {
        elementIds: ["btn-fixture", "dialog-1"],
        elementCount: 2,
        activeStateIds: ["dialog-open"],
      },
    },
    {
      id: PREDICATE_EVAL_ID,
      timestamp: FIXED_TS,
      type: "predicateEval",
      causedBy: STATE_CHANGE_ID,
      data: {
        predicateId: "dialog-visible",
        target: "Dialog",
        matched: true,
        snapshotRef: SNAPSHOT_ID,
      },
    },
  ];

  return {
    id: "fixture-determinism-session",
    startedAt: FIXED_STARTED_AT,
    events,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const RUNS = 10;

describe("exploreCounterfactual — determinism gate", () => {
  it("produces byte-identical reports across 10 runs of the same flip-predicate-eval perturbation", () => {
    const perturbation: Perturbation = {
      kind: "flip-predicate-eval",
      targetEventId: PREDICATE_EVAL_ID,
    };

    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      // Rebuild the fixture each run to ensure no shared mutable state can
      // sneak into the output.
      const session = buildFixtureSession();
      const report = exploreCounterfactual(session, perturbation);
      serialized.push(JSON.stringify(report));
    }

    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("produces byte-identical reports across 10 runs of fail-action", () => {
    const perturbation: Perturbation = {
      kind: "fail-action",
      targetEventId: ACTION_ID,
    };

    const serialized: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const session = buildFixtureSession();
      const report = exploreCounterfactual(session, perturbation);
      serialized.push(JSON.stringify(report));
    }

    for (let i = 1; i < RUNS; i++) {
      expect(serialized[i]).toBe(serialized[0]);
    }
  });

  it("orders divergences, fragilityScores, and unreachableEventIds deterministically across two runs", () => {
    const perturbation: Perturbation = {
      kind: "fail-action",
      targetEventId: ACTION_ID,
    };

    const a = exploreCounterfactual(buildFixtureSession(), perturbation);
    const b = exploreCounterfactual(buildFixtureSession(), perturbation);

    expect(JSON.stringify(a.divergences)).toBe(JSON.stringify(b.divergences));
    expect(JSON.stringify(a.fragilityScores)).toBe(
      JSON.stringify(b.fragilityScores),
    );
    expect(JSON.stringify(a.unreachableEventIds)).toBe(
      JSON.stringify(b.unreachableEventIds),
    );
    expect(JSON.stringify(a.deadTransitionStateIds)).toBe(
      JSON.stringify(b.deadTransitionStateIds),
    );
    expect(JSON.stringify(a.irrelevantPredicateIds)).toBe(
      JSON.stringify(b.irrelevantPredicateIds),
    );
  });
});
