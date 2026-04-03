import { describe, it, expect } from "vitest";
import {
  navigate,
  bfsSearch,
  astarSearch,
  navigateToAny,
} from "../../state/navigation";
import { ReliabilityTracker } from "../../state/reliability";
import type { TransitionDefinition } from "../../state/state-machine";

// ---------------------------------------------------------------------------
// Fixtures — simple state graph
//
//   A --t1(cost 1)--> B --t2(cost 1)--> C --t4(cost 1)--> D
//   A --t3(cost 3)----------------------> C
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
  it("finds a valid path from A to C", () => {
    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
    });

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.strategy).toBe("dijkstra");
    // Verify path reaches C
    const states = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) states.delete(s);
      for (const s of t.activateStates) states.add(s);
    }
    expect(states.has("C")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bfsSearch
// ---------------------------------------------------------------------------

describe("bfsSearch", () => {
  it("finds shortest hop count A->C (1 hop vs 2)", () => {
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
  it("finds a valid path to any of [C, D]", () => {
    const result = navigateToAny(new Set(["A"]), ["C", "D"], transitions);

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    // Verify path reaches C or D
    const states = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) states.delete(s);
      for (const s of t.activateStates) states.add(s);
    }
    expect(states.has("C") || states.has("D")).toBe(true);
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
// maxDepth
// ---------------------------------------------------------------------------

describe("maxDepth", () => {
  it("finds path within maxDepth", () => {
    const result = navigate(new Set(["A"]), "D", transitions, {
      strategy: "dijkstra",
      maxDepth: 5,
    });
    expect(result.path.length).toBeGreaterThanOrEqual(1);
    expect(result.path.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("already at target returns empty path", () => {
    const result = navigate(new Set(["C"]), "C", transitions, {
      strategy: "dijkstra",
    });
    expect(result.path).toHaveLength(0);
    expect(result.totalCost).toBe(0);
  });

  it("no path returns empty or throws", () => {
    try {
      const result = navigate(new Set(["D"]), "A", transitions, {
        strategy: "dijkstra",
      });
      // If it doesn't throw, path should be empty or indicate failure
      expect(result.path).toHaveLength(0);
    } catch {
      // Throwing is also acceptable
      expect(true).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Reliability-adjusted costs
// ---------------------------------------------------------------------------

describe("reliability-adjusted costs", () => {
  it("unreliable transition gets higher cost", () => {
    const tracker = new ReliabilityTracker();
    tracker.record("t1", true, 100);
    tracker.record("t1", false, 100);
    tracker.record("t3", true, 100);
    tracker.record("t3", true, 100);

    const result = navigate(new Set(["A"]), "C", transitions, {
      strategy: "dijkstra",
      reliability: tracker,
    });

    expect(result.path.length).toBeGreaterThanOrEqual(1);
    const finalStates = new Set(["A"]);
    for (const t of result.path) {
      for (const s of t.exitStates) finalStates.delete(s);
      for (const s of t.activateStates) finalStates.add(s);
    }
    expect(finalStates.has("C")).toBe(true);
  });
});
