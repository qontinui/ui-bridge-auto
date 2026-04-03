import { describe, it, expect } from "vitest";
import {
  navigate,
  bfsSearch,
  astarSearch,
  navigateToAny,
  navigateToAll,
} from "../../state/navigation";
import { ReliabilityTracker } from "../../state/reliability";
import type { TransitionDefinition } from "../../state/state-machine";

// ---------------------------------------------------------------------------
// Fixtures — simple state graph
//
//   A --t1(cost 1)--> B --t2(cost 1)--> C --t4(cost 1)--> D
//   A --t3(cost 3)---------------------> C
// ---------------------------------------------------------------------------

const transitions: TransitionDefinition[] = [
  {
    id: "t1",
    name: "A to B",
    fromStates: ["A"],
    activateStates: ["B"],
    exitStates: ["A"],
    actions: [],
    pathCost: 1,
  },
  {
    id: "t2",
    name: "B to C",
    fromStates: ["B"],
    activateStates: ["C"],
    exitStates: ["B"],
    actions: [],
    pathCost: 1,
  },
  {
    id: "t3",
    name: "A to C (expensive)",
    fromStates: ["A"],
    activateStates: ["C"],
    exitStates: ["A"],
    actions: [],
    pathCost: 3,
  },
  {
    id: "t4",
    name: "C to D",
    fromStates: ["C"],
    activateStates: ["D"],
    exitStates: ["C"],
    actions: [],
    pathCost: 1,
  },
];

// ---------------------------------------------------------------------------
// navigate (dijkstra)
// ---------------------------------------------------------------------------

describe("navigate with dijkstra", () => {
  it("finds cheapest path from A to C", () => {
    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
    });

    expect(result.path).toHaveLength(2);
    expect(result.path[0].id).toBe("t1");
    expect(result.path[1].id).toBe("t2");
    expect(result.totalCost).toBe(2);
    expect(result.strategy).toBe("dijkstra");
  });

  it("returns statesSequence showing state configs at each step", () => {
    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
    });

    expect(result.statesSequence.length).toBeGreaterThanOrEqual(2);
    // First state config should contain A
    expect(result.statesSequence[0].has("A")).toBe(true);
    // Last state config should contain C
    const last = result.statesSequence[result.statesSequence.length - 1];
    expect(last.has("C")).toBe(true);
  });

  it("returns targetsReached", () => {
    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
    });
    expect(result.targetsReached.has("C")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bfsSearch
// ---------------------------------------------------------------------------

describe("bfsSearch", () => {
  it("finds shortest hop count A->C (1 hop via t3)", () => {
    const result = bfsSearch(new Set(["A"]), "C", transitions);

    expect(result.path).toHaveLength(1);
    expect(result.path[0].id).toBe("t3");
    expect(result.strategy).toBe("bfs");
  });
});

// ---------------------------------------------------------------------------
// astarSearch
// ---------------------------------------------------------------------------

describe("astarSearch", () => {
  it("finds path with heuristic", () => {
    const heuristic = () => 0; // Degenerates to dijkstra
    const result = astarSearch(new Set(["A"]), "C", transitions, heuristic);

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.strategy).toBe("astar");

    const finalStates = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) finalStates.delete(s);
      for (const s of t.activateStates) finalStates.add(s);
    }
    expect(finalStates.has("C")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// navigateToAny
// ---------------------------------------------------------------------------

describe("navigateToAny", () => {
  it("picks cheapest single target from set", () => {
    const result = navigateToAny(new Set(["A"]), ["C", "D"], transitions);

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.totalCost).toBeLessThan(Infinity);

    // Verify path reaches C or D
    const states = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) states.delete(s);
      for (const s of t.activateStates) states.add(s);
    }
    expect(states.has("C") || states.has("D")).toBe(true);
  });

  it("returns immediately if already at a target", () => {
    const result = navigateToAny(new Set(["C"]), ["C", "D"], transitions);
    expect(result.path).toHaveLength(0);
    expect(result.totalCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// navigateToAll
// ---------------------------------------------------------------------------

describe("navigateToAll", () => {
  it("reaches ALL targets via multi-target pathfinding", () => {
    // Must visit both B and D: path is A->B->C->D
    const result = navigateToAll(
      new Set(["A"]),
      ["B", "D"],
      transitions,
    );

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.totalCost).toBeLessThan(Infinity);
    expect(result.targetsReached.has("B")).toBe(true);
    expect(result.targetsReached.has("D")).toBe(true);
  });

  it("returns empty path if all targets already active", () => {
    const result = navigateToAll(
      new Set(["B", "D"]),
      ["B", "D"],
      transitions,
    );
    expect(result.path).toHaveLength(0);
    expect(result.totalCost).toBe(0);
  });

  it("returns Infinity cost if targets unreachable", () => {
    const result = navigateToAll(
      new Set(["D"]),
      ["A", "B"],
      transitions,
    );
    expect(result.totalCost).toBe(Infinity);
    expect(result.path).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// avoidStates
// ---------------------------------------------------------------------------

describe("avoidStates", () => {
  it("avoids specified states in path", () => {
    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
      avoidStates: ["B"],
    });

    expect(result.path).toHaveLength(1);
    expect(result.path[0].id).toBe("t3");
  });
});

// ---------------------------------------------------------------------------
// Reliability-adjusted costs
// ---------------------------------------------------------------------------

describe("reliability-adjusted costs", () => {
  it("unreliable transition gets higher cost, changing path selection", () => {
    const tracker = new ReliabilityTracker();
    // Make t1 unreliable (50% success)
    tracker.record("t1", true, 100);
    tracker.record("t1", false, 100);
    // Make t3 reliable (100% success)
    tracker.record("t3", true, 100);
    tracker.record("t3", true, 100);

    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
      reliability: tracker,
    });

    // With reliability adjustment, t1 cost increases, so direct t3 may be preferred
    expect(result.path.length).toBeGreaterThanOrEqual(1);
    const finalStates = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) finalStates.delete(s);
      for (const s of t.activateStates) finalStates.add(s);
    }
    expect(finalStates.has("C")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("already at target returns empty path with statesSequence", () => {
    const result = navigate(new Set(["C"]), "C", transitions, {
      strategy: "dijkstra",
    });
    expect(result.path).toHaveLength(0);
    expect(result.totalCost).toBe(0);
    expect(result.statesSequence).toHaveLength(1);
    expect(result.statesSequence[0].has("C")).toBe(true);
    expect(result.targetsReached.has("C")).toBe(true);
  });

  it("no path returns empty path with Infinity cost", () => {
    const result = navigate(new Set(["D"]), "A", transitions, {
      strategy: "dijkstra",
    });
    expect(result.path).toHaveLength(0);
    expect(result.totalCost).toBe(Infinity);
  });

  it("maxDepth limits search depth", () => {
    const result = navigate(new Set(["A"]), "D", transitions, {
      strategy: "dijkstra",
      maxDepth: 5,
    });
    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.path.length).toBeLessThanOrEqual(5);
  });
});
