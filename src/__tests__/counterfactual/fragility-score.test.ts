/**
 * Unit tests for the fragility-score logic in the counterfactual explorer.
 *
 * Fragility = forwardClosureSize / traceSize for each predicateEval event.
 * High fragility means the predicate gates many downstream events; flipping
 * its outcome would invalidate a large slice of the trace.
 *
 * These tests build small custom sessions to isolate the score logic from
 * the rest of the report.
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
// Constants
// ---------------------------------------------------------------------------

const FIXED_STARTED_AT = 1735689600000;
const FIXED_TS = 1735689600100;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exploreCounterfactual — fragility score", () => {
  it("a high-fanout predicate has a high fragility score", () => {
    // 6-event trace:
    //   evt-pred (predicateEval, root)
    //   ├── evt-sc1 (stateChange)
    //   │   └── evt-disappear (elementDisappeared)
    //   ├── evt-appear (elementAppeared)
    //   └── evt-action (action)
    //   evt-snap (snapshot, root — independent)
    // Forward closure of evt-pred = 4 descendants (sc1, disappear, appear, action).
    // Trace size = 6. Score = 4/6.
    //
    // Wait — we want 5 descendants out of 6 total. Make evt-snap depend on
    // the predicate too so closure = 5.
    const events: RecordedEvent[] = [
      {
        id: "evt-pred",
        timestamp: FIXED_TS,
        type: "predicateEval",
        causedBy: null,
        data: {
          predicateId: "high-fanout",
          target: "Many things",
          matched: true,
        },
      },
      {
        id: "evt-sc1",
        timestamp: FIXED_TS,
        type: "stateChange",
        causedBy: "evt-pred",
        data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
      },
      {
        id: "evt-disappear",
        timestamp: FIXED_TS,
        type: "elementDisappeared",
        causedBy: "evt-sc1",
        data: { elementId: "el-1" },
      },
      {
        id: "evt-appear",
        timestamp: FIXED_TS,
        type: "elementAppeared",
        causedBy: "evt-pred",
        data: { elementId: "el-2" },
      },
      {
        id: "evt-action",
        timestamp: FIXED_TS,
        type: "action",
        causedBy: "evt-pred",
        data: {
          actionType: "click",
          elementId: "btn-x",
          success: true,
          durationMs: 5,
        },
      },
      {
        id: "evt-snap",
        timestamp: FIXED_TS,
        type: "snapshot",
        causedBy: "evt-pred",
        data: { elementIds: [], elementCount: 0 },
      },
    ];
    const session: RecordingSession = {
      id: "fragility-high",
      startedAt: FIXED_STARTED_AT,
      events,
    };

    const perturbation: Perturbation = {
      kind: "flip-predicate-eval",
      targetEventId: "evt-pred",
    };
    const report = exploreCounterfactual(session, perturbation);

    expect(report.fragilityScores).toHaveLength(1);
    const score = report.fragilityScores[0];
    expect(score.eventId).toBe("evt-pred");
    expect(score.predicateId).toBe("high-fanout");
    expect(score.forwardClosureSize).toBe(5);
    expect(score.traceSize).toBe(6);
    expect(score.score).toBeCloseTo(5 / 6, 12);
  });

  it("a leaf predicate has fragility score 0", () => {
    const events: RecordedEvent[] = [
      {
        id: "evt-action",
        timestamp: FIXED_TS,
        type: "action",
        causedBy: null,
        data: {
          actionType: "click",
          elementId: "btn-1",
          success: true,
          durationMs: 1,
        },
      },
      {
        id: "evt-pred",
        timestamp: FIXED_TS,
        type: "predicateEval",
        causedBy: "evt-action",
        data: { predicateId: "leaf-pred", matched: true },
      },
    ];
    const session: RecordingSession = {
      id: "fragility-leaf",
      startedAt: FIXED_STARTED_AT,
      events,
    };

    const report = exploreCounterfactual(session, {
      kind: "flip-predicate-eval",
      targetEventId: "evt-pred",
    });

    expect(report.fragilityScores).toHaveLength(1);
    const score = report.fragilityScores[0];
    expect(score.eventId).toBe("evt-pred");
    expect(score.predicateId).toBe("leaf-pred");
    expect(score.forwardClosureSize).toBe(0);
    expect(score.traceSize).toBe(2);
    expect(score.score).toBe(0);
  });

  it("multiple predicates each get their own score, sorted deterministically", () => {
    // 5 events:
    //   evt-action (root)
    //   evt-pred-a (caused by evt-action) — predicate A
    //   evt-sc-a (caused by evt-pred-a) — descendant of A
    //   evt-pred-b (caused by evt-sc-a) — predicate B (deeper, leaf)
    //   evt-elem (caused by evt-pred-a) — another descendant of A
    //
    // Closure of evt-pred-a = {evt-sc-a, evt-pred-b, evt-elem} → size 3.
    // Closure of evt-pred-b = {} → size 0.
    // Trace size = 5. Scores: A = 3/5 = 0.6, B = 0/5 = 0.
    const events: RecordedEvent[] = [
      {
        id: "evt-action",
        timestamp: FIXED_TS,
        type: "action",
        causedBy: null,
        data: {
          actionType: "click",
          elementId: "btn-x",
          success: true,
          durationMs: 1,
        },
      },
      {
        id: "evt-pred-a",
        timestamp: FIXED_TS,
        type: "predicateEval",
        causedBy: "evt-action",
        data: { predicateId: "pred-a", matched: true },
      },
      {
        id: "evt-sc-a",
        timestamp: FIXED_TS,
        type: "stateChange",
        causedBy: "evt-pred-a",
        data: { entered: ["s-a"], exited: [], activeStates: ["s-a"] },
      },
      {
        id: "evt-pred-b",
        timestamp: FIXED_TS,
        type: "predicateEval",
        causedBy: "evt-sc-a",
        data: { predicateId: "pred-b", matched: false },
      },
      {
        id: "evt-elem",
        timestamp: FIXED_TS,
        type: "elementAppeared",
        causedBy: "evt-pred-a",
        data: { elementId: "el-x" },
      },
    ];
    const session: RecordingSession = {
      id: "fragility-multi",
      startedAt: FIXED_STARTED_AT,
      events,
    };

    const report = exploreCounterfactual(session, {
      kind: "fail-action",
      targetEventId: "evt-action",
    });

    expect(report.fragilityScores).toHaveLength(2);

    // fragilityScores is sorted by eventId lex. "evt-pred-a" < "evt-pred-b".
    expect(report.fragilityScores.map((s) => s.eventId)).toEqual([
      "evt-pred-a",
      "evt-pred-b",
    ]);

    const [a, b] = report.fragilityScores;
    expect(a.predicateId).toBe("pred-a");
    expect(a.forwardClosureSize).toBe(3);
    expect(a.traceSize).toBe(5);
    expect(a.score).toBeCloseTo(3 / 5, 12);

    expect(b.predicateId).toBe("pred-b");
    expect(b.forwardClosureSize).toBe(0);
    expect(b.traceSize).toBe(5);
    expect(b.score).toBe(0);

    // Determinism: a second run is byte-identical.
    const report2 = exploreCounterfactual(session, {
      kind: "fail-action",
      targetEventId: "evt-action",
    });
    expect(JSON.stringify(report2.fragilityScores)).toBe(
      JSON.stringify(report.fragilityScores),
    );
  });

  it("an empty predicate population produces zero fragility scores", () => {
    // Trace with no predicateEval events at all.
    const events: RecordedEvent[] = [
      {
        id: "evt-action",
        timestamp: FIXED_TS,
        type: "action",
        causedBy: null,
        data: {
          actionType: "click",
          elementId: "btn",
          success: true,
          durationMs: 1,
        },
      },
      {
        id: "evt-sc",
        timestamp: FIXED_TS,
        type: "stateChange",
        causedBy: "evt-action",
        data: { entered: ["s"], exited: [], activeStates: ["s"] },
      },
    ];
    const session: RecordingSession = {
      id: "fragility-empty-predicates",
      startedAt: FIXED_STARTED_AT,
      events,
    };

    const report = exploreCounterfactual(session, {
      kind: "fail-action",
      targetEventId: "evt-action",
    });

    expect(report.fragilityScores).toEqual([]);
  });
});
