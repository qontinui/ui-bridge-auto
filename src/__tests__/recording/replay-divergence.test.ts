import { describe, it, expect, beforeEach } from "vitest";
import { ReplayEngine } from "../../recording/replay-engine";
import type { RecordingSession } from "../../recording/session-recorder";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { MockRegistry } from "../../test-utils/mock-registry";
import { resetIdCounter } from "../../test-utils/mock-elements";

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
    id: "test-divergence-session",
    startedAt: Date.now(),
    events,
  };
}

describe("ReplayEngine — divergence detection", () => {
  it("returns no divergences for a valid causal chain", async () => {
    // e1 is a root (no causedBy), e2 is caused by e1, e3 is caused by e1.
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        causedBy: null,
        data: {
          actionType: "click",
          elementId: "btn-x",
          success: true,
          durationMs: 10,
        },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "stateChange",
        causedBy: "e1",
        data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
      },
      {
        id: "e3",
        timestamp: Date.now(),
        type: "elementAppeared",
        causedBy: "e1",
        data: { elementId: "el-1" },
      },
    ]);

    const result = await engine.replay(session, { pauseBetweenActions: 0 });

    expect(result.divergences).toEqual([]);
  });

  it("returns no divergences for old fixtures without causedBy", async () => {
    // Pre-Phase-1 fixture shape: events without causedBy at all.
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

    expect(result.divergences).toEqual([]);
  });

  it("reports a causedByMismatch divergence for a forward reference", async () => {
    // e1 references e2, but e2 doesn't appear until later in the session.
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "stateChange",
        causedBy: "e2",
        data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
      },
      {
        id: "e2",
        timestamp: Date.now(),
        type: "snapshot",
        causedBy: null,
        data: { elementIds: ["el-1"], elementCount: 1 },
      },
    ]);

    const result = await engine.replay(session);

    expect(result.divergences).toHaveLength(1);
    const div = result.divergences[0];
    expect(div.kind).toBe("causedByMismatch");
    expect(div.eventIndex).toBe(0);
    expect(div.expected).toEqual({ id: "e1", causedBy: "e2" });
    expect(div.actual).toBeNull();
    expect(div.message).toContain("e1");
    expect(div.message).toContain("e2");
  });

  it("reports a causedByMismatch divergence for a dangling reference", async () => {
    // e1 references "ghost", which never appears in the session.
    const session = makeSession([
      {
        id: "e1",
        timestamp: Date.now(),
        type: "stateChange",
        causedBy: "ghost",
        data: { entered: ["s1"], exited: [], activeStates: ["s1"] },
      },
    ]);

    const result = await engine.replay(session);

    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].kind).toBe("causedByMismatch");
    expect(result.divergences[0].eventIndex).toBe(0);
  });
});
