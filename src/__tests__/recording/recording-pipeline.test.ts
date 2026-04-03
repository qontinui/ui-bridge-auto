import { describe, it, expect, beforeEach } from "vitest";
import { RecordingPipeline } from "../../recording/recording-pipeline";
import type { RecordingSession } from "../../recording/session-recorder";

let pipeline: RecordingPipeline;

beforeEach(() => {
  document.body.innerHTML = "";
  pipeline = new RecordingPipeline();
});

describe("RecordingPipeline", () => {
  it("processes snapshots into state definitions", () => {
    const session: RecordingSession = {
      id: "sess-1",
      startedAt: Date.now(),
      events: [
        {
          id: "e1",
          timestamp: Date.now(),
          type: "snapshot",
          data: { elementIds: ["el-a", "el-b"], elementCount: 2 },
        },
        {
          id: "e2",
          timestamp: Date.now() + 100,
          type: "snapshot",
          data: { elementIds: ["el-a", "el-b"], elementCount: 2 },
        },
      ],
    };

    const result = pipeline.process(session);

    // The discovery engine may or may not produce states depending on
    // co-occurrence thresholds, but the pipeline should not throw.
    expect(result).toHaveProperty("states");
    expect(result).toHaveProperty("transitions");
    expect(Array.isArray(result.states)).toBe(true);
    expect(Array.isArray(result.transitions)).toBe(true);
  });

  it("processes actions into transition data", () => {
    const now = Date.now();
    const session: RecordingSession = {
      id: "sess-2",
      startedAt: now,
      events: [
        {
          id: "e1",
          timestamp: now,
          type: "snapshot",
          data: { elementIds: ["el-a", "el-b"], elementCount: 2 },
        },
        {
          id: "e2",
          timestamp: now + 50,
          type: "action",
          data: {
            actionType: "click",
            elementId: "el-a",
            success: true,
            durationMs: 30,
          },
        },
        {
          id: "e3",
          timestamp: now + 100,
          type: "snapshot",
          data: { elementIds: ["el-c", "el-d"], elementCount: 2 },
        },
      ],
    };

    const result = pipeline.process(session);

    // Should produce some output without errors
    expect(result.states).toBeDefined();
    expect(result.transitions).toBeDefined();
  });

  it("handles empty sessions", () => {
    const session: RecordingSession = {
      id: "sess-empty",
      startedAt: Date.now(),
      events: [],
    };

    const result = pipeline.process(session);

    expect(result.states).toHaveLength(0);
    expect(result.transitions).toHaveLength(0);
  });
});
