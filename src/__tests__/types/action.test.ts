import { describe, it, expect } from "vitest";
import {
  createActionRecord,
  markExecuting,
  markCompleted,
  markFailed,
  markCancelled,
  markSkipped,
  isTerminalStatus,
  createDefaultExecutionOptions,
} from "../../types/action";

describe("createActionRecord", () => {
  it("creates a pending record with required fields", () => {
    const r = createActionRecord("a1", "click", "el-1", "Submit", { force: true });
    expect(r.id).toBe("a1");
    expect(r.type).toBe("click");
    expect(r.elementId).toBe("el-1");
    expect(r.elementLabel).toBe("Submit");
    expect(r.params).toEqual({ force: true });
    expect(r.status).toBe("pending");
    expect(r.startedAt).toBeGreaterThan(0);
  });

  it("works without optional params", () => {
    const r = createActionRecord("a2", "type", "el-2");
    expect(r.elementLabel).toBeUndefined();
    expect(r.params).toBeUndefined();
  });
});

describe("lifecycle transitions", () => {
  it("markExecuting sets status and updates startedAt", () => {
    const r = createActionRecord("a1", "click", "el-1");
    const result = markExecuting(r);
    expect(result.status).toBe("executing");
    expect(result).toBe(r); // mutates in place
  });

  it("markCompleted sets status, completedAt, durationMs", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markExecuting(r);
    const result = markCompleted(r, { value: "42" });
    expect(result.status).toBe("completed");
    expect(result.completedAt).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.extractedValues).toEqual({ value: "42" });
  });

  it("markCompleted without extractedValues", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markCompleted(r);
    expect(r.extractedValues).toBeUndefined();
  });

  it("markFailed sets error", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markFailed(r, "Element not found");
    expect(r.status).toBe("failed");
    expect(r.error).toBe("Element not found");
  });

  it("markCancelled sets terminal status", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markCancelled(r);
    expect(r.status).toBe("cancelled");
    expect(r.completedAt).toBeGreaterThan(0);
  });

  it("markSkipped sets reason as error field", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markSkipped(r, "precondition failed");
    expect(r.status).toBe("skipped");
    expect(r.error).toBe("precondition failed");
  });

  it("markSkipped without reason", () => {
    const r = createActionRecord("a1", "click", "el-1");
    markSkipped(r);
    expect(r.status).toBe("skipped");
    expect(r.error).toBeUndefined();
  });
});

describe("isTerminalStatus", () => {
  it("returns true for terminal statuses", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("skipped")).toBe(true);
  });

  it("returns false for non-terminal statuses", () => {
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("executing")).toBe(false);
  });
});

describe("createDefaultExecutionOptions", () => {
  it("returns expected defaults", () => {
    const o = createDefaultExecutionOptions();
    expect(o.timeout).toBe(5000);
    expect(o.retryCount).toBe(0);
    expect(o.retryDelayMs).toBe(500);
    expect(o.waitForIdle).toBe(true);
    expect(o.idleTimeout).toBe(5000);
    expect(o.scrollIntoView).toBe(true);
    expect(o.pauseBeforeAction).toBe(0);
    expect(o.pauseAfterAction).toBe(0);
  });
});
