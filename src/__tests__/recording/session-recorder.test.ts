import { describe, it, expect, beforeEach } from "vitest";
import {
  SessionRecorder,
  type RecordedAction,
  type RecordedStateChange,
  type RecordedSnapshot,
} from "../../recording/session-recorder";

let recorder: SessionRecorder;

beforeEach(() => {
  recorder = new SessionRecorder();
});

describe("SessionRecorder", () => {
  it("starts and stops a session", () => {
    const id = recorder.start();
    expect(id).toBeTruthy();
    expect(recorder.isRecording).toBe(true);

    const session = recorder.stop();
    expect(session.id).toBe(id);
    expect(session.startedAt).toBeGreaterThan(0);
    expect(session.endedAt).toBeGreaterThan(0);
    expect(session.events).toHaveLength(0);
    expect(recorder.isRecording).toBe(false);
  });

  it("throws when stopping without a session", () => {
    expect(() => recorder.stop()).toThrow("No recording session in progress");
  });

  it("throws when recording without a session", () => {
    const action: RecordedAction = {
      actionType: "click",
      elementId: "btn-1",
      success: true,
      durationMs: 50,
    };
    expect(() => recorder.recordAction(action)).toThrow(
      "No recording session in progress",
    );
  });

  it("records actions", () => {
    recorder.start();
    const action: RecordedAction = {
      actionType: "click",
      elementId: "btn-1",
      elementLabel: "Submit",
      success: true,
      durationMs: 100,
    };
    recorder.recordAction(action);

    const session = recorder.stop();
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("action");
    expect(session.events[0].data).toEqual(action);
  });

  it("records state changes", () => {
    recorder.start();
    const change: RecordedStateChange = {
      entered: ["logged-in"],
      exited: ["login-form"],
      activeStates: ["logged-in", "dashboard"],
    };
    recorder.recordStateChange(change);

    const session = recorder.stop();
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("stateChange");
  });

  it("records snapshots", () => {
    recorder.start();
    const snapshot: RecordedSnapshot = {
      elementIds: ["el-1", "el-2", "el-3"],
      elementCount: 3,
    };
    recorder.recordSnapshot(snapshot);

    const session = recorder.stop();
    expect(session.events).toHaveLength(1);
    expect(session.events[0].type).toBe("snapshot");
  });

  it("records element appeared/disappeared events", () => {
    recorder.start();
    recorder.recordElementAppeared({ elementId: "el-1", elementLabel: "OK" });
    recorder.recordElementDisappeared({ elementId: "el-2" });

    const session = recorder.stop();
    expect(session.events).toHaveLength(2);
    expect(session.events[0].type).toBe("elementAppeared");
    expect(session.events[1].type).toBe("elementDisappeared");
  });

  it("round-trips through toJSON/fromJSON", () => {
    recorder.start({ env: "test" });
    recorder.recordAction({
      actionType: "click",
      elementId: "btn-1",
      success: true,
      durationMs: 50,
    });
    const session = recorder.stop();

    const json = SessionRecorder.toJSON(session);
    const restored = SessionRecorder.fromJSON(json);

    expect(restored.id).toBe(session.id);
    expect(restored.events).toHaveLength(1);
    expect(restored.metadata).toEqual({ env: "test" });
  });

  it("fromJSON rejects invalid JSON", () => {
    expect(() => SessionRecorder.fromJSON("{}")).toThrow(
      "Invalid recording session JSON",
    );
  });

  it("currentSession returns session while recording", () => {
    expect(recorder.currentSession).toBeNull();
    recorder.start();
    expect(recorder.currentSession).not.toBeNull();
    recorder.stop();
    expect(recorder.currentSession).toBeNull();
  });
});
