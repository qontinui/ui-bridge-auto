import { describe, it, expect } from "vitest";
import {
  createEmptyStateSet,
  diffStateSets,
  getStateLifecycle,
  evaluateCondition,
  type ActiveStateSet,
  type StateCondition,
} from "../../types/state";

describe("createEmptyStateSet", () => {
  it("creates an empty set with current timestamp by default", () => {
    const before = Date.now();
    const set = createEmptyStateSet();
    expect(set.states.size).toBe(0);
    expect(set.elementCount).toBe(0);
    expect(set.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("uses provided timestamp", () => {
    const set = createEmptyStateSet(12345);
    expect(set.timestamp).toBe(12345);
  });
});

describe("diffStateSets", () => {
  const makeSet = (ids: string[]): ActiveStateSet => ({
    states: new Set(ids),
    timestamp: Date.now(),
    elementCount: 0,
  });

  it("detects entered states", () => {
    const diff = diffStateSets(makeSet(["a"]), makeSet(["a", "b"]));
    expect(diff.entered).toEqual(["b"]);
    expect(diff.exited).toEqual([]);
  });

  it("detects exited states", () => {
    const diff = diffStateSets(makeSet(["a", "b"]), makeSet(["a"]));
    expect(diff.entered).toEqual([]);
    expect(diff.exited).toEqual(["b"]);
  });

  it("detects both entered and exited", () => {
    const diff = diffStateSets(makeSet(["a", "b"]), makeSet(["b", "c"]));
    expect(diff.entered).toEqual(["c"]);
    expect(diff.exited).toEqual(["a"]);
  });

  it("returns empty arrays when sets are identical", () => {
    const diff = diffStateSets(makeSet(["a"]), makeSet(["a"]));
    expect(diff.entered).toEqual([]);
    expect(diff.exited).toEqual([]);
  });
});

describe("getStateLifecycle", () => {
  const makeSet = (ids: string[]): ActiveStateSet => ({
    states: new Set(ids),
    timestamp: Date.now(),
    elementCount: 0,
  });

  it("returns entering when newly appeared", () => {
    expect(getStateLifecycle("x", makeSet([]), makeSet(["x"]))).toBe("entering");
  });

  it("returns active when present in both", () => {
    expect(getStateLifecycle("x", makeSet(["x"]), makeSet(["x"]))).toBe("active");
  });

  it("returns exiting when disappeared", () => {
    expect(getStateLifecycle("x", makeSet(["x"]), makeSet([]))).toBe("exiting");
  });

  it("returns hidden when absent from both", () => {
    expect(getStateLifecycle("x", makeSet([]), makeSet([]))).toBe("hidden");
  });
});

describe("evaluateCondition", () => {
  const cond = (
    expected: unknown,
    comparator?: StateCondition["comparator"],
  ): StateCondition => ({
    element: { role: "button" },
    property: "text",
    expected,
    comparator,
  });

  it("equals (default comparator)", () => {
    expect(evaluateCondition(cond("hello"), "hello")).toBe(true);
    expect(evaluateCondition(cond("hello"), "world")).toBe(false);
  });

  it("contains", () => {
    expect(evaluateCondition(cond("ell", "contains"), "hello")).toBe(true);
    expect(evaluateCondition(cond("xyz", "contains"), "hello")).toBe(false);
    expect(evaluateCondition(cond("a", "contains"), 123)).toBe(false);
  });

  it("matches with string pattern", () => {
    expect(evaluateCondition(cond("^hel", "matches"), "hello")).toBe(true);
    expect(evaluateCondition(cond("^world", "matches"), "hello")).toBe(false);
    expect(evaluateCondition(cond(".*", "matches"), 42)).toBe(false);
  });

  it("greaterThan", () => {
    expect(evaluateCondition(cond(5, "greaterThan"), 10)).toBe(true);
    expect(evaluateCondition(cond(10, "greaterThan"), 5)).toBe(false);
    expect(evaluateCondition(cond(5, "greaterThan"), "not a number")).toBe(false);
  });

  it("lessThan", () => {
    expect(evaluateCondition(cond(10, "lessThan"), 5)).toBe(true);
    expect(evaluateCondition(cond(5, "lessThan"), 10)).toBe(false);
  });
});
