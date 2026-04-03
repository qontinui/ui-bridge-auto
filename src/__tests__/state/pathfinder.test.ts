import { describe, it, expect } from "vitest";
import {
  findPath,
  NoPathError,
  PathNode,
  applyTransition,
  getAvailableTransitions,
  bfs,
  dijkstra,
  astar,
  reconstructPath,
} from "../../state/pathfinder";
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

// Shared transitions for multi-hop graph:
//   A --t1(1)--> B --t2(1)--> C --t4(1)--> D
//   A --t3(3)--------------> C
const transitions: TransitionDefinition[] = [
  makeTransition("t1", ["A"], ["B"], ["A"], 1),
  makeTransition("t2", ["B"], ["C"], ["B"], 1),
  makeTransition("t3", ["A"], ["C"], ["A"], 3),
  makeTransition("t4", ["C"], ["D"], ["C"], 1),
];

// ---------------------------------------------------------------------------
// applyTransition
// ---------------------------------------------------------------------------

describe("applyTransition", () => {
  it("removes exitStates and adds activateStates", () => {
    const tr = makeTransition("x", ["A"], ["B", "C"], ["A"]);
    const result = applyTransition(new Set(["A", "Z"]), tr);
    expect(result).toEqual(new Set(["Z", "B", "C"]));
  });

  it("does not mutate the input set", () => {
    const original = new Set(["A"]);
    const tr = makeTransition("x", ["A"], ["B"], ["A"]);
    applyTransition(original, tr);
    expect(original).toEqual(new Set(["A"]));
  });
});

// ---------------------------------------------------------------------------
// getAvailableTransitions
// ---------------------------------------------------------------------------

describe("getAvailableTransitions", () => {
  it("filters by fromStates precondition", () => {
    const available = getAvailableTransitions(new Set(["A"]), transitions);
    const ids = available.map((t) => t.id);
    expect(ids).toContain("t1");
    expect(ids).toContain("t3");
    expect(ids).not.toContain("t2");
    expect(ids).not.toContain("t4");
  });

  it("excludes transitions activating avoided states", () => {
    const available = getAvailableTransitions(new Set(["A"]), transitions, [
      "B",
    ]);
    const ids = available.map((t) => t.id);
    expect(ids).not.toContain("t1"); // activates B
    expect(ids).toContain("t3"); // activates C, not B
  });

  it("requires ALL fromStates to be active", () => {
    const tr = makeTransition("need-both", ["A", "B"], ["C"], []);
    const available = getAvailableTransitions(new Set(["A"]), [tr]);
    expect(available).toHaveLength(0);
    const available2 = getAvailableTransitions(new Set(["A", "B"]), [tr]);
    expect(available2).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PathNode key identity
// ---------------------------------------------------------------------------

describe("PathNode", () => {
  it("key is canonical sorted (activeStates|targetsReached)", () => {
    const node = new PathNode({
      activeStates: new Set(["B", "A"]),
      targetsReached: new Set(["C"]),
    });
    expect(node.key).toBe('["A","B"]|["C"]');
  });

  it("two nodes with same states and reached have same key", () => {
    const n1 = new PathNode({
      activeStates: new Set(["A", "B"]),
      targetsReached: new Set(["C"]),
    });
    const n2 = new PathNode({
      activeStates: new Set(["B", "A"]),
      targetsReached: new Set(["C"]),
    });
    expect(n1.key).toBe(n2.key);
  });

  it("different targetsReached produce different keys", () => {
    const n1 = new PathNode({
      activeStates: new Set(["A"]),
      targetsReached: new Set(["C"]),
    });
    const n2 = new PathNode({
      activeStates: new Set(["A"]),
      targetsReached: new Set(["D"]),
    });
    expect(n1.key).not.toBe(n2.key);
  });
});

// ---------------------------------------------------------------------------
// BFS
// ---------------------------------------------------------------------------

describe("bfs", () => {
  it("finds single target", () => {
    const result = bfs(new Set(["A"]), new Set(["C"]), transitions);
    expect(result).not.toBeNull();
    // BFS finds fewest transitions: A->C direct (1 hop via t3)
    expect(result!.transitionsSequence).toHaveLength(1);
    expect(result!.transitionsSequence[0].id).toBe("t3");
    expect(result!.isComplete).toBe(true);
  });

  it("finds ALL targets (multi-target)", () => {
    // Graph: A->B, B->C, C->D — need to reach both B and D
    // This requires going A->B->C->D but B is only active at step 1
    // Actually with exit states, B is exited when going to C.
    // So we need a graph where targets can be visited along the way.
    // In the (activeStates, targetsReached) model, reaching B at any point
    // adds it to targetsReached even if we later exit B.
    const result = bfs(new Set(["A"]), new Set(["B", "D"]), transitions);
    expect(result).not.toBeNull();
    expect(result!.isComplete).toBe(true);
    expect(result!.targets).toEqual(new Set(["B", "D"]));
  });

  it("returns null when unreachable", () => {
    const result = bfs(new Set(["D"]), new Set(["A"]), transitions);
    expect(result).toBeNull();
  });

  it("already at target returns empty path", () => {
    const result = bfs(new Set(["A"]), new Set(["A"]), transitions);
    expect(result).not.toBeNull();
    expect(result!.transitionsSequence).toHaveLength(0);
    expect(result!.isComplete).toBe(true);
  });

  it("respects maxDepth", () => {
    // Path to D can be done in 2 hops (A->C via t3, C->D via t4)
    // With maxDepth 1, it should fail since minimum is 2 hops
    const result = bfs(new Set(["A"]), new Set(["D"]), transitions, {
      maxDepth: 1,
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dijkstra
// ---------------------------------------------------------------------------

describe("dijkstra", () => {
  it("picks cheapest path (2-hop cost 2 vs 1-hop cost 3)", () => {
    const result = dijkstra(new Set(["A"]), new Set(["C"]), transitions);
    expect(result).not.toBeNull();
    // A->B (cost 1) + B->C (cost 1) = 2, cheaper than A->C (cost 3)
    expect(result!.totalCost).toBe(2);
    expect(result!.transitionsSequence).toHaveLength(2);
  });

  it("multi-target picks cheapest path visiting all", () => {
    const result = dijkstra(new Set(["A"]), new Set(["B", "D"]), transitions);
    expect(result).not.toBeNull();
    expect(result!.isComplete).toBe(true);
    // Must visit B and D: A->B->C->D (cost 3)
    expect(result!.totalCost).toBe(3);
  });

  it("custom getCost overrides pathCost", () => {
    // Make all transitions cost 10
    const result = dijkstra(new Set(["A"]), new Set(["C"]), transitions, {
      getCost: () => 10,
    });
    expect(result).not.toBeNull();
    // Cheapest is now 1-hop (10) vs 2-hop (20)
    expect(result!.totalCost).toBe(10);
    expect(result!.transitionsSequence).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

describe("astar", () => {
  it("works with default heuristic (remaining target count)", () => {
    const result = astar(new Set(["A"]), new Set(["C"]), transitions);
    expect(result).not.toBeNull();
    expect(result!.isComplete).toBe(true);
    // Should find same cost as dijkstra
    expect(result!.totalCost).toBe(2);
  });

  it("works with custom heuristic", () => {
    const result = astar(new Set(["A"]), new Set(["D"]), transitions, {
      heuristic: () => 0, // degenerate to dijkstra
    });
    expect(result).not.toBeNull();
    expect(result!.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NoPathError
// ---------------------------------------------------------------------------

describe("NoPathError", () => {
  it("has from and targets properties", () => {
    const err = new NoPathError(new Set(["X"]), new Set(["Y", "Z"]));
    expect(err.from).toEqual(new Set(["X"]));
    expect(err.targets).toEqual(new Set(["Y", "Z"]));
    expect(err.name).toBe("NoPathError");
  });

  it("has backward-compat target (singular) property", () => {
    const err = new NoPathError(new Set(["X"]), new Set(["Y"]));
    expect(err.target).toBe("Y");
  });

  it("accepts custom message", () => {
    const err = new NoPathError(new Set(["X"]), new Set(["Y"]), "custom msg");
    expect(err.message).toBe("custom msg");
  });
});

// ---------------------------------------------------------------------------
// findPath (legacy wrapper)
// ---------------------------------------------------------------------------

describe("findPath", () => {
  it("returns empty array when already at target", () => {
    const path = findPath(new Set(["dashboard"]), "dashboard", []);
    expect(path).toEqual([]);
  });

  it("finds simple A->B path", () => {
    const path = findPath(new Set(["A"]), "B", transitions);
    expect(path).toHaveLength(1);
    expect(path[0].id).toBe("t1");
  });

  it("finds multi-hop A->B->C path (cheapest)", () => {
    const path = findPath(new Set(["A"]), "C", transitions);
    expect(path).toHaveLength(2);
    expect(path[0].id).toBe("t1");
    expect(path[1].id).toBe("t2");
  });

  it("throws NoPathError when no path exists", () => {
    expect(() => findPath(new Set(["D"]), "A", transitions)).toThrow(
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
});
