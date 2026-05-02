/**
 * Round-trip integration tests against the canonical Section-5 fixture.
 *
 * Hand-verifies the report shape produced by `exploreCounterfactual` for
 * specific perturbations on the 6-event fixture session. The fixture's
 * causal graph:
 *
 *   evt-fixture-1 (action, root)
 *   ├── evt-fixture-2 (stateChange)
 *   │   ├── evt-fixture-4 (elementDisappeared)
 *   │   └── evt-fixture-6 (predicateEval, leaf)
 *   └── evt-fixture-3 (elementAppeared, leaf)
 *   evt-fixture-5 (snapshot, root — independent of action chain)
 */

import { describe, it, expect } from "vitest";
import {
  exploreCounterfactual,
  CounterfactualError,
  type Perturbation,
} from "../../counterfactual";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";

// ---------------------------------------------------------------------------
// Constants
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
// Fixture (self-contained copy of the Section-5 gold master)
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
    id: "fixture-explorer-session",
    startedAt: FIXED_STARTED_AT,
    events,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exploreCounterfactual — fixture integration", () => {
  it("flip-predicate-eval on a leaf predicate produces zero downstream divergences", () => {
    const session = buildFixtureSession();
    const perturbation: Perturbation = {
      kind: "flip-predicate-eval",
      targetEventId: PREDICATE_EVAL_ID,
    };

    const report = exploreCounterfactual(session, perturbation);

    // The predicate is a leaf — no descendants in the causal graph.
    expect(report.divergences).toEqual([]);
    expect(report.unreachableEventIds).toEqual([]);
    expect(report.deadTransitionStateIds).toEqual([]);

    // Implementation note: explorer.ts skips predicates whose forward closure
    // is empty when computing irrelevantPredicateIds (the
    // `if (closure.length === 0) continue;` guard at line ~187). A leaf
    // predicate therefore does NOT appear in irrelevantPredicateIds.
    // This documents the current semantic — if it changes, update here.
    expect(report.irrelevantPredicateIds).toEqual([]);

    // The perturbation field is preserved verbatim.
    expect(report.perturbation).toEqual(perturbation);
  });

  it("fail-action on root action propagates: state change + element appeared become unreachable", () => {
    const session = buildFixtureSession();
    const perturbation: Perturbation = {
      kind: "fail-action",
      targetEventId: ACTION_ID,
    };

    const report = exploreCounterfactual(session, perturbation);

    // Forward closure from evt-fixture-1 (excluding self):
    //   evt-fixture-2 (direct), evt-fixture-3 (direct),
    //   evt-fixture-4 (via evt-fixture-2), evt-fixture-6 (via evt-fixture-2)
    // evt-fixture-5 (snapshot) is a root and is NOT in the closure.
    expect(report.unreachableEventIds).toEqual([
      STATE_CHANGE_ID,
      ELEMENT_APPEARED_ID,
      ELEMENT_DISAPPEARED_ID,
      PREDICATE_EVAL_ID,
    ]);
    expect(report.unreachableEventIds).not.toContain(SNAPSHOT_ID);

    // One divergence per unreachable event, sorted by eventIndex.
    // Indices: stateChange=1, elementAppeared=2, elementDisappeared=3, predicateEval=5.
    expect(report.divergences).toHaveLength(4);
    expect(report.divergences.map((d) => d.eventIndex)).toEqual([1, 2, 3, 5]);
    for (const d of report.divergences) {
      expect(d.kind).toBe("missing");
      expect(d.actual).toBeNull();
      expect(d.synthetic).toBe(true);
      expect(d.message).toContain("Failing action");
    }

    // The dead-transition set comes from `entered` of unreachable
    // stateChange events. Only evt-fixture-2 qualifies → ["dialog-open"].
    expect(report.deadTransitionStateIds).toEqual(["dialog-open"]);

    // The single predicate evt-fixture-6 has empty forward closure, so the
    // explorer's `closure.length === 0` guard skips it.
    expect(report.irrelevantPredicateIds).toEqual([]);
  });

  it("fragility scores cover every predicateEval in the trace", () => {
    const session = buildFixtureSession();

    // Run with two different perturbations — fragilityScores depend only on
    // the trace's predicate population, not on the perturbation, so both
    // reports should have the same scores.
    const a = exploreCounterfactual(session, {
      kind: "fail-action",
      targetEventId: ACTION_ID,
    });
    const b = exploreCounterfactual(session, {
      kind: "flip-predicate-eval",
      targetEventId: PREDICATE_EVAL_ID,
    });

    expect(a.fragilityScores).toHaveLength(1);
    expect(b.fragilityScores).toHaveLength(1);

    const score = a.fragilityScores[0];
    expect(score.eventId).toBe(PREDICATE_EVAL_ID);
    expect(score.predicateId).toBe("dialog-visible");
    expect(score.forwardClosureSize).toBe(0); // leaf predicate
    expect(score.traceSize).toBe(6);
    expect(score.score).toBe(0); // 0 / 6

    expect(JSON.stringify(a.fragilityScores)).toBe(
      JSON.stringify(b.fragilityScores),
    );
  });

  it("CounterfactualError is thrown for nonexistent target event id", () => {
    const session = buildFixtureSession();
    expect(() =>
      exploreCounterfactual(session, {
        kind: "flip-predicate-eval",
        targetEventId: "nope",
      }),
    ).toThrow(CounterfactualError);

    expect(() =>
      exploreCounterfactual(session, {
        kind: "fail-action",
        targetEventId: "nope",
      }),
    ).toThrow(CounterfactualError);
  });

  it("CounterfactualError is thrown when flip-predicate-eval targets a non-predicate event", () => {
    const session = buildFixtureSession();

    // The action event exists but is not of type predicateEval.
    expect(() =>
      exploreCounterfactual(session, {
        kind: "flip-predicate-eval",
        targetEventId: ACTION_ID,
      }),
    ).toThrow(CounterfactualError);

    // And the symmetric error: fail-action targeting a non-action event.
    expect(() =>
      exploreCounterfactual(session, {
        kind: "fail-action",
        targetEventId: PREDICATE_EVAL_ID,
      }),
    ).toThrow(CounterfactualError);
  });
});
