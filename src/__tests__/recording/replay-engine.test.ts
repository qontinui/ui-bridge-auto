import { describe, it, expect, beforeEach } from "vitest";
import { ReplayEngine } from "../../recording/replay-engine";
import type { RecordingSession } from "../../recording/session-recorder";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  resetIdCounter,
} from "../../test-utils/mock-elements";

let executor: MockActionExecutor;
let registry: MockRegistry;
let engine: ReplayEngine;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  executor = new MockActionExecutor();
  registry = new MockRegistry();
  engine = new ReplayEngine(executor, registry);
});

function makeSession(events: RecordingSession["events"]): RecordingSession {
  return {
    id: "test-session",
    startedAt: Date.now(),
    events,
  };
}

describe("ReplayEngine", () => {
  it("replays action events in order", async () => {
    const btn = createButton("Submit", { id: "btn-1" });
    registry.addElement(btn);

    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-1",
          success: true,
          durationMs: 50,
        },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-1",
          success: true,
          durationMs: 50,
        },
      },
    ]);

    const result = await engine.replay(session, { pauseBetweenActions: 0 });

    expect(result.success).toBe(true);
    expect(result.eventsReplayed).toBe(2);
    expect(executor.executedActions).toHaveLength(2);
  });

  it("skips non-action events", async () => {
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "stateChange",
        data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "snapshot",
        data: { elementIds: ["el-1"], elementCount: 1 },
      },
    ]);

    const result = await engine.replay(session);

    expect(result.success).toBe(true);
    expect(result.eventsReplayed).toBe(0);
    expect(executor.executedActions).toHaveLength(0);
  });

  it("reports errors when element not found", async () => {
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "missing-el",
          success: true,
          durationMs: 50,
        },
      },
    ]);

    const result = await engine.replay(session);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain("not found");
  });

  it("stops on error when stopOnError is true", async () => {
    const btn = createButton("OK", { id: "btn-ok" });
    registry.addElement(btn);

    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "missing",
          success: true,
          durationMs: 50,
        },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-ok",
          success: true,
          durationMs: 50,
        },
      },
    ]);

    const result = await engine.replay(session, { stopOnError: true, pauseBetweenActions: 0 });

    expect(result.success).toBe(false);
    expect(result.eventsReplayed).toBe(0);
    // Second action was NOT executed because we stopped
    expect(executor.executedActions).toHaveLength(0);
  });

  it("cancel stops replay", async () => {
    const btn = createButton("OK", { id: "btn-ok" });
    registry.addElement(btn);

    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-ok",
          success: true,
          durationMs: 50,
        },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-ok",
          success: true,
          durationMs: 50,
        },
      },
    ]);

    // Cancel during the onEvent callback (after first event processed)
    const result = await engine.replay(session, {
      pauseBetweenActions: 10,
      onEvent: (_event, index) => {
        if (index === 0) {
          engine.cancel();
        }
      },
    });

    // Should not have completed successfully due to cancellation
    expect(result.success).toBe(false);
    // At most one action should have been executed before cancel took effect
    expect(executor.executedActions.length).toBeLessThanOrEqual(1);
  });

  it("invokes onEvent callback for each event", async () => {
    const btn = createButton("OK", { id: "btn-ok" });
    registry.addElement(btn);

    const events: number[] = [];
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-ok",
          success: true,
          durationMs: 50,
        },
      },
    ]);

    await engine.replay(session, {
      pauseBetweenActions: 0,
      onEvent: (_event, index, total) => {
        events.push(index);
        expect(total).toBe(1);
      },
    });

    expect(events).toEqual([0]);
  });
});
