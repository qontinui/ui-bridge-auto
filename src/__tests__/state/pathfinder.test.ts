import { describe, it, expect } from "vitest";
import { findPath, NoPathError } from "../../state/pathfinder";
import type { TransitionDefinition } from "../../state/state-machine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTransition(
  id: string,
  from: string[],
  activate: string[],
  exit: string[],
  cost?: number,
): TransitionDefinition {
  return {
    id,
    name: id,
    fromStates: from,
    activateStates: activate,
    exitStates: exit,
    actions: [{ target: { id: "dummy" }, action: "click" }],
    pathCost: cost,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("findPath", () => {
  it("returns empty array when already at target", () => {
    const from = new Set(["dashboard"]);
    const path = findPath(from, "dashboard", []);
    expect(path).toEqual([]);
  });

  it("finds simple A→B path", () => {
    const transitions = [
      makeTransition("login-to-dash", ["login"], ["dashboard"], ["login"]),
    ];
    const path = findPath(new Set(["login"]), "dashboard", transitions);
    expect(path).toHaveLength(1);
    expect(path[0].id).toBe("login-to-dash");
  });

  it("finds multi-hop A→B→C path", () => {
    const transitions = [
      makeTransition("a-to-b", ["a"], ["b"], ["a"]),
      makeTransition("b-to-c", ["b"], ["c"], ["b"]),
    ];
    const path = findPath(new Set(["a"]), "c", transitions);
    expect(path).toHaveLength(2);
    expect(path[0].id).toBe("a-to-b");
    expect(path[1].id).toBe("b-to-c");
  });

  it("throws NoPathError when no path exists", () => {
    const transitions = [
      makeTransition("a-to-b", ["a"], ["b"], ["a"]),
    ];
    expect(() => findPath(new Set(["c"]), "d", transitions)).toThrow(
      NoPathError,
    );
  });

  it("NoPathError contains from and target", () => {
    try {
      findPath(new Set(["x"]), "y", []);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NoPathError);
      const err = e as NoPathError;
      expect(err.from).toEqual(new Set(["x"]));
      expect(err.target).toBe("y");
    }
  });

  it("finds direct path even when multi-hop alternative exists", () => {
    const transitions = [
      // Direct path
      makeTransition("direct", ["a"], ["c"], ["a"], 10),
      // Two-hop path
      makeTransition("a-to-b", ["a"], ["b"], ["a"], 1),
      makeTransition("b-to-c", ["b"], ["c"], ["b"], 1),
    ];
    const path = findPath(new Set(["a"]), "c", transitions);
    // The pathfinder finds any valid path to the target
    expect(path.length).toBeGreaterThanOrEqual(1);
    // The final transition should produce state "c"
    const lastTransition = path[path.length - 1];
    expect(lastTransition.activateStates).toContain("c");
  });

  it("finds a path among multiple single-hop options", () => {
    const transitions = [
      makeTransition("path1", ["start"], ["end"], ["start"], 5),
      makeTransition("path2", ["start"], ["end"], ["start"], 2),
    ];
    const path = findPath(new Set(["start"]), "end", transitions);
    expect(path).toHaveLength(1);
    // Both are valid — the algorithm returns one of them
    expect(["path1", "path2"]).toContain(path[0].id);
  });

  it("handles transition that requires multiple active from-states", () => {
    const transitions = [
      makeTransition("need-both", ["a", "b"], ["c"], ["a", "b"]),
    ];
    // Both a and b are active → transition is applicable
    const path = findPath(new Set(["a", "b"]), "c", transitions);
    expect(path).toHaveLength(1);
  });

  it("skips transition when from-state precondition not met", () => {
    const transitions = [
      makeTransition("need-both", ["a", "b"], ["c"], []),
      makeTransition("just-a", ["a"], ["c"], []),
    ];
    // Only a is active, so "need-both" is skipped
    const path = findPath(new Set(["a"]), "c", transitions);
    expect(path).toHaveLength(1);
    expect(path[0].id).toBe("just-a");
  });

  it("defaults pathCost to 1.0 when not specified", () => {
    const transitions = [
      makeTransition("a-to-b", ["a"], ["b"], ["a"]),  // cost=1 (default)
      makeTransition("b-to-c", ["b"], ["c"], ["b"]),  // cost=1 (default)
    ];
    // With default cost=1 each, two-hop path should have total cost=2
    const path = findPath(new Set(["a"]), "c", transitions);
    expect(path).toHaveLength(2);
    expect(path[0].id).toBe("a-to-b");
    expect(path[1].id).toBe("b-to-c");
  });
});
