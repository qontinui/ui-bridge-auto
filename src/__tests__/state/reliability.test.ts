import { describe, it, expect, beforeEach } from "vitest";
import { ReliabilityTracker } from "../../state/reliability";

let tracker: ReliabilityTracker;

beforeEach(() => {
  tracker = new ReliabilityTracker();
});

describe("record", () => {
  it("tracks success/failure counts", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", true, 200);
    tracker.record("t1", false, 150);

    const rec = tracker.get("t1");
    expect(rec).toBeDefined();
    expect(rec!.successCount).toBe(2);
    expect(rec!.failureCount).toBe(1);
  });
});

describe("successRate", () => {
  it("returns 100% when all succeed", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", true, 100);
    expect(tracker.successRate("t1")).toBe(1.0);
  });

  it("returns 50% when half fail", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", false, 100);
    expect(tracker.successRate("t1")).toBe(0.5);
  });

  it("returns a default for unknown transitions", () => {
    const rate = tracker.successRate("unknown");
    // Implementation may return 0.5 (neutral prior) or 1.0 (assume reliable)
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });
});

describe("adjustedCost", () => {
  it("returns base cost for 100% reliable transition", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", true, 100);
    expect(tracker.adjustedCost("t1", 1.0)).toBe(1.0);
  });

  it("returns higher cost for unreliable transition", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", false, 100);
    expect(tracker.adjustedCost("t1", 1.0)).toBeGreaterThan(1.0);
  });
});

describe("get", () => {
  it("returns record for specific transition", () => {
    tracker.record("t1", true, 100);
    tracker.record("t2", false, 100);

    expect(tracker.get("t1")?.successCount).toBe(1);
    expect(tracker.get("t2")?.failureCount).toBe(1);
  });

  it("returns undefined for untracked transition", () => {
    expect(tracker.get("nonexistent")).toBeUndefined();
  });
});

describe("clear", () => {
  it("resets all records", () => {
    tracker.record("t1", true, 100);
    tracker.record("t2", false, 100);
    tracker.clear();

    expect(tracker.get("t1")).toBeUndefined();
    expect(tracker.get("t2")).toBeUndefined();
  });
});

describe("toJSON / fromJSON", () => {
  it("round-trip serialization", () => {
    tracker.record("t1", true, 100);
    tracker.record("t1", true, 200);
    tracker.record("t1", false, 150);
    tracker.record("t2", false, 100);

    const json = tracker.toJSON();
    const restored = ReliabilityTracker.fromJSON(json);

    expect(restored.successRate("t1")).toBe(tracker.successRate("t1"));
    expect(restored.get("t1")?.successCount).toBe(tracker.get("t1")?.successCount);
    expect(restored.get("t2")?.failureCount).toBe(tracker.get("t2")?.failureCount);
  });
});
