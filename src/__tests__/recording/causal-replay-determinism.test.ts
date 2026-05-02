/**
 * Determinism gate for causal-trace replay.
 *
 * Asserts that replaying the SAME fixture session N times produces
 * byte-identical results across all deterministic-comparable fields
 * (success, counts, divergences, errors). The wall-clock `durationMs`
 * field is intentionally excluded from comparison.
 *
 * If this test ever fails, replay has acquired a non-determinism leak —
 * Date.now() drift in a comparable field, Math.random(), Map/Set iteration
 * order escaping into output, etc. Fix the leak, do not relax the test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ReplayEngine, type ReplayResult } from "../../recording/replay-engine";
import type {
  RecordedEvent,
  RecordingSession,
} from "../../recording/session-recorder";
import type { QueryableElement } from "../../core/element-query";
import type { ActionExecutorLike } from "../../state/transition-executor";

// ---------------------------------------------------------------------------
// Constants — all timestamps and ids are fixed strings/numbers, never derived
// from Date.now() or Math.random().
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
// Deterministic stubs — no Date.now(), no Math.random(), no async timers.
// ---------------------------------------------------------------------------

class DeterministicExecutor implements ActionExecutorLike {
  findElement(): { id: string } | null {
    return { id: "btn-fixture" };
  }
  async executeAction(): Promise<void> {
    // intentionally synchronous-resolving; no timers, no randomness
  }
  async waitForIdle(): Promise<void> {
    // no-op
  }
}

function deterministicRegistry(): { getAllElements(): QueryableElement[] } {
  // A frozen single-element list. The element's getState() is a constant.
  const element: QueryableElement = {
    id: "btn-fixture",
    element: {} as unknown as HTMLElement,
    type: "button",
    label: "Fixture Button",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      checked: undefined,
      textContent: "Fixture",
      value: undefined,
      rect: { x: 0, y: 0, width: 100, height: 30 },
      computedStyles: {},
    }),
  };
  const list: QueryableElement[] = [element];
  return { getAllElements: () => list };
}

// ---------------------------------------------------------------------------
// Fixture session — exercises the full event-type surface, hand-rolled
// with stable ids and a constant timestamp.
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
// Comparison helper — drop wall-clock fields before stringifying.
// ---------------------------------------------------------------------------

function deterministicSubset(r: ReplayResult): unknown {
  return {
    success: r.success,
    eventsReplayed: r.eventsReplayed,
    eventsTotal: r.eventsTotal,
    divergences: r.divergences,
    errors: r.errors,
    // explicitly omit: durationMs (wall-clock)
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let engine: ReplayEngine;

beforeEach(() => {
  engine = new ReplayEngine(new DeterministicExecutor(), deterministicRegistry());
});

describe("ReplayEngine — determinism gate", () => {
  it("produces byte-identical replay results across 10 runs of the same fixture", async () => {
    const session = buildFixtureSession();
    const results: string[] = [];

    for (let i = 0; i < 10; i++) {
      const r = await engine.replay(session, {
        pauseBetweenActions: 0,
        verifyStates: false,
      });
      results.push(JSON.stringify(deterministicSubset(r)));
    }

    for (let i = 1; i < 10; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  it("validateCausalChain produces byte-identical divergences across 10 runs", async () => {
    // Same fixture, but bend the causal chain so it produces divergences:
    // a forward reference and a dangling reference. Then assert that the
    // divergence array (and its order) is identical across runs — proves
    // there is no Map/Set iteration-order leak in the integrity-check path.
    const session: RecordingSession = {
      id: "fixture-divergent-session",
      startedAt: FIXED_STARTED_AT,
      events: [
        {
          id: "e-a",
          timestamp: FIXED_TS,
          type: "stateChange",
          causedBy: "e-b", // forward reference
          data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
        },
        {
          id: "e-b",
          timestamp: FIXED_TS,
          type: "snapshot",
          causedBy: null,
          data: { elementIds: [], elementCount: 0 },
        },
        {
          id: "e-c",
          timestamp: FIXED_TS,
          type: "stateChange",
          causedBy: "ghost", // dangling reference
          data: { entered: ["s2"], exited: ["s1"], activeStates: ["s2"] },
        },
      ],
    };

    const results: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await engine.replay(session, {
        pauseBetweenActions: 0,
        verifyStates: false,
      });
      results.push(JSON.stringify(r.divergences));
    }

    for (let i = 1; i < 10; i++) {
      expect(results[i]).toBe(results[0]);
    }

    const parsed = JSON.parse(results[0]) as Array<{ kind: string }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].kind).toBe("causedByMismatch");
    expect(parsed[1].kind).toBe("causedByMismatch");
  });
});
