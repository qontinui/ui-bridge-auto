import { describe, it, expect, beforeEach } from "vitest";
import { CoOccurrenceMatrix } from "../../state/co-occurrence";

let matrix: CoOccurrenceMatrix;

beforeEach(() => {
  matrix = new CoOccurrenceMatrix();
});

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

describe("record", () => {
  it("tracks element co-occurrence across snapshots", () => {
    matrix.record(["a", "b", "c"]);
    matrix.record(["a", "b"]);

    expect(matrix.snapshotCount).toBe(2);
    expect(matrix.elementCount("a")).toBe(2);
    expect(matrix.elementCount("b")).toBe(2);
    expect(matrix.elementCount("c")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// score
// ---------------------------------------------------------------------------

describe("score", () => {
  it("returns 1.0 for elements that always appear together", () => {
    matrix.record(["a", "b"]);
    matrix.record(["a", "b"]);
    matrix.record(["a", "b"]);

    expect(matrix.score("a", "b")).toBe(1.0);
  });

  it("returns 0.0 for elements that never appear together", () => {
    matrix.record(["a"]);
    matrix.record(["b"]);

    expect(matrix.score("a", "b")).toBe(0.0);
  });

  it("returns fraction for partial co-occurrence", () => {
    // a appears in 3 snapshots, b appears in 2, both appear in 1
    matrix.record(["a", "b"]);
    matrix.record(["a"]);
    matrix.record(["a", "c"]);
    matrix.record(["b"]);

    // pairCount(a,b) = 1, min(count(a), count(b)) = min(3, 2) = 2
    expect(matrix.score("a", "b")).toBe(0.5);
  });

  it("returns 1.0 for self-score", () => {
    matrix.record(["a"]);
    expect(matrix.score("a", "a")).toBe(1.0);
  });

  it("returns 0 for unknown elements", () => {
    expect(matrix.score("x", "y")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findGroups
// ---------------------------------------------------------------------------

describe("findGroups", () => {
  it("groups elements with high co-occurrence", () => {
    // a, b, c always appear together
    matrix.record(["a", "b", "c"]);
    matrix.record(["a", "b", "c"]);
    matrix.record(["a", "b", "c"]);

    const groups = matrix.findGroups(0.8);
    expect(groups.length).toBeGreaterThanOrEqual(1);

    // All three should be in the same group
    const group = groups.find((g) => g.includes("a"));
    expect(group).toBeDefined();
    expect(group).toContain("b");
    expect(group).toContain("c");
  });

  it("doesn't group elements with low co-occurrence", () => {
    // a and b only appear together 1 out of 5 times
    matrix.record(["a", "b"]);
    matrix.record(["a"]);
    matrix.record(["a"]);
    matrix.record(["a"]);
    matrix.record(["b"]);

    const groups = matrix.findGroups(0.8);
    // a and b should NOT be in the same group
    const groupWithBoth = groups.find(
      (g) => g.includes("a") && g.includes("b"),
    );
    expect(groupWithBoth).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// snapshotCount
// ---------------------------------------------------------------------------

describe("snapshotCount", () => {
  it("tracks total snapshots", () => {
    expect(matrix.snapshotCount).toBe(0);
    matrix.record(["a"]);
    expect(matrix.snapshotCount).toBe(1);
    matrix.record(["b"]);
    expect(matrix.snapshotCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("clear", () => {
  it("resets all data", () => {
    matrix.record(["a", "b"]);
    matrix.record(["a", "b"]);
    matrix.clear();

    expect(matrix.snapshotCount).toBe(0);
    expect(matrix.elementIds).toHaveLength(0);
    expect(matrix.score("a", "b")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toJSON / fromJSON
// ---------------------------------------------------------------------------

describe("toJSON / fromJSON", () => {
  it("round-trip serialization", () => {
    matrix.record(["a", "b", "c"]);
    matrix.record(["a", "b"]);
    matrix.record(["b", "c"]);

    const json = matrix.toJSON();
    const restored = CoOccurrenceMatrix.fromJSON(json);

    expect(restored.snapshotCount).toBe(matrix.snapshotCount);
    expect(restored.score("a", "b")).toBe(matrix.score("a", "b"));
    expect(restored.score("b", "c")).toBe(matrix.score("b", "c"));
    expect(restored.score("a", "c")).toBe(matrix.score("a", "c"));
    expect(restored.elementCount("a")).toBe(matrix.elementCount("a"));
  });
});
