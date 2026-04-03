/**
 * Enhanced navigation with multiple search strategies.
 *
 * Provides BFS, Dijkstra, and A* pathfinding over the state/transition graph.
 * Supports reliability-adjusted costs, state avoidance/preference,
 * single-target, multi-target (any), and multi-target (all) navigation.
 *
 * Aligned with the multistate Python library's multi-target pathfinding.
 */

import type { TransitionDefinition } from "./state-machine";
import type { ReliabilityTracker } from "./reliability";
import {
  type Path,
  PathNode,
  bfs as coreBfs,
  dijkstra as coreDijkstra,
  astar as coreAstar,
} from "./pathfinder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available search strategies. */
export type SearchStrategy = "dijkstra" | "bfs" | "astar";

/** Options for navigation pathfinding. */
export interface NavigationOptions {
  /** Search strategy to use (default 'dijkstra'). */
  strategy?: SearchStrategy;
  /** Adjust transition costs based on reliability data. */
  reliability?: ReliabilityTracker;
  /** State IDs to avoid during pathfinding. */
  avoidStates?: string[];
  /** Prefer paths through these states (reduces their cost by 50%). */
  preferStates?: string[];
  /** Maximum number of transitions in the path. */
  maxDepth?: number;
  /** Maximum time for pathfinding in milliseconds. */
  timeout?: number;
}

/** Result of a navigation search. */
export interface NavigationResult {
  /** Ordered sequence of transitions to execute. */
  path: TransitionDefinition[];
  /** State configuration at each step (including initial). */
  statesSequence: Set<string>[];
  /** Which target states were reached. */
  targetsReached: Set<string>;
  /** Total weighted cost of the path. */
  totalCost: number;
  /** Strategy that was used. */
  strategy: SearchStrategy;
  /** Time spent searching (ms). */
  searchTimeMs: number;
  /** Number of state-set nodes visited during search. */
  statesVisited: number;
}

// ---------------------------------------------------------------------------
// Cost function builder
// ---------------------------------------------------------------------------

/**
 * Build a cost function that accounts for reliability adjustments and
 * state preference bonuses.
 */
function buildCostFn(
  opts: NavigationOptions,
): (t: TransitionDefinition) => number {
  return (tr: TransitionDefinition) => {
    let cost = tr.pathCost ?? 1.0;

    // Reliability adjustment
    if (opts.reliability) {
      cost = opts.reliability.adjustedCost(tr.id, cost);
    }

    // Prefer certain target states (reduce cost by 50%)
    if (opts.preferStates && opts.preferStates.length > 0) {
      const prefersTarget = tr.activateStates.some((s) =>
        opts.preferStates!.includes(s),
      );
      if (prefersTarget) {
        cost *= 0.5;
      }
    }

    return cost;
  };
}

// ---------------------------------------------------------------------------
// Path result conversion
// ---------------------------------------------------------------------------

/** Convert a core Path to a NavigationResult. */
function pathToResult(
  path: Path | null,
  strategy: SearchStrategy,
  startTime: number,
  statesVisited: number,
): NavigationResult {
  if (path === null) {
    return {
      path: [],
      statesSequence: [],
      targetsReached: new Set(),
      totalCost: Infinity,
      strategy,
      searchTimeMs: Date.now() - startTime,
      statesVisited,
    };
  }

  return {
    path: path.transitionsSequence,
    statesSequence: path.statesSequence,
    targetsReached: new Set(
      [...path.targets].filter((t) => {
        // Check if target appears in any state along the path
        for (const states of path.statesSequence) {
          if (states.has(t)) return true;
        }
        return false;
      }),
    ),
    totalCost: path.totalCost,
    strategy,
    searchTimeMs: Date.now() - startTime,
    statesVisited,
  };
}

/** Build an empty (already-at-target) result. */
function emptyResult(
  strategy: SearchStrategy,
  startTime: number,
  activeStates: Set<string>,
  targets: Set<string>,
): NavigationResult {
  return {
    path: [],
    statesSequence: [new Set(activeStates)],
    targetsReached: new Set([...targets].filter((t) => activeStates.has(t))),
    totalCost: 0,
    strategy,
    searchTimeMs: Date.now() - startTime,
    statesVisited: 0,
  };
}

// ---------------------------------------------------------------------------
// Internal dispatch
// ---------------------------------------------------------------------------

/**
 * Run the appropriate algorithm on targets.
 */
function runSearch(
  activeStates: Set<string>,
  targetStates: Set<string>,
  transitions: TransitionDefinition[],
  options: NavigationOptions,
): { path: Path | null; statesVisited: number } {
  const strategy = options.strategy ?? "dijkstra";
  const avoidStates = options.avoidStates;
  const maxDepth = options.maxDepth;
  const getCost = buildCostFn(options);

  // We don't have direct access to visited count from core algorithms,
  // so we wrap with a counting proxy by intercepting transitions.
  // For simplicity, we estimate via the path depth.
  let path: Path | null = null;

  switch (strategy) {
    case "bfs":
      path = coreBfs(activeStates, targetStates, transitions, {
        avoidStates,
        maxDepth,
      });
      break;

    case "astar":
      path = coreAstar(activeStates, targetStates, transitions, {
        avoidStates,
        maxDepth,
        getCost,
        // Default heuristic: remaining targets not yet reached
      });
      break;

    case "dijkstra":
    default:
      path = coreDijkstra(activeStates, targetStates, transitions, {
        avoidStates,
        maxDepth,
        getCost,
      });
      break;
  }

  // Approximate statesVisited from path length (exact count not exposed from core)
  const statesVisited = path ? path.transitionsSequence.length + 1 : 0;
  return { path, statesVisited };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Navigate from the active state set to a single target state using the
 * specified strategy.
 */
export function navigate(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const strategy = options?.strategy ?? "dijkstra";
  const targetSet = new Set([target]);

  // Already there
  if (activeStates.has(target)) {
    return emptyResult(strategy, startTime, activeStates, targetSet);
  }

  const { path, statesVisited } = runSearch(
    activeStates,
    targetSet,
    transitions,
    options ?? {},
  );

  return pathToResult(path, strategy, startTime, statesVisited);
}

/**
 * Find a path using BFS (unweighted shortest path).
 * Ignores transition costs -- finds the path with the fewest transitions.
 */
export function bfsSearch(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  return navigate(activeStates, target, transitions, {
    ...options,
    strategy: "bfs",
  });
}

/**
 * Find a path using A* with a caller-provided heuristic.
 *
 * The heuristic should estimate the remaining cost from a state set to the
 * target. It must be admissible (never overestimate) for optimality.
 */
export function astarSearch(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  heuristic: (stateSet: Set<string>, target: string) => number,
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const targetSet = new Set([target]);

  if (activeStates.has(target)) {
    return emptyResult("astar", startTime, activeStates, targetSet);
  }

  const getCost = buildCostFn(options ?? {});

  // Wrap the user's single-target heuristic into the multi-target form
  const multiHeuristic = (node: PathNode, _targets: Set<string>): number => {
    // If target already reached, no remaining cost
    if (node.targetsReached.has(target)) return 0;
    return heuristic(node.activeStates, target);
  };

  const path = coreAstar(activeStates, targetSet, transitions, {
    avoidStates: options?.avoidStates,
    maxDepth: options?.maxDepth,
    getCost,
    heuristic: multiHeuristic,
  });

  const statesVisited = path ? path.transitionsSequence.length + 1 : 0;
  return pathToResult(path, "astar", startTime, statesVisited);
}

/**
 * Find the cheapest path to ANY of multiple target states.
 *
 * Runs a separate search for each target individually and returns the
 * cheapest result.
 */
export function navigateToAny(
  activeStates: Set<string>,
  targets: string[],
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const strategy = options?.strategy ?? "dijkstra";

  // Check if any target is already active
  for (const t of targets) {
    if (activeStates.has(t)) {
      return emptyResult(strategy, startTime, activeStates, new Set([t]));
    }
  }

  let bestResult: NavigationResult | null = null;

  for (const target of targets) {
    const { path, statesVisited } = runSearch(
      activeStates,
      new Set([target]),
      transitions,
      options ?? {},
    );

    if (path !== null) {
      const result = pathToResult(path, strategy, startTime, statesVisited);
      if (bestResult === null || result.totalCost < bestResult.totalCost) {
        bestResult = result;
      }
    }
  }

  if (bestResult !== null) {
    return bestResult;
  }

  // No path to any target
  return {
    path: [],
    statesSequence: [],
    targetsReached: new Set(),
    totalCost: Infinity,
    strategy,
    searchTimeMs: Date.now() - startTime,
    statesVisited: 0,
  };
}

/**
 * Find a path reaching ALL of multiple target states (multi-target
 * pathfinding aligned with multistate).
 *
 * The search space is O(V * 2^k) where k = number of targets.
 */
export function navigateToAll(
  activeStates: Set<string>,
  targets: string[],
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const strategy = options?.strategy ?? "dijkstra";
  const targetSet = new Set(targets);

  // Check if all targets already active
  if ([...targetSet].every((t) => activeStates.has(t))) {
    return emptyResult(strategy, startTime, activeStates, targetSet);
  }

  const { path, statesVisited } = runSearch(
    activeStates,
    targetSet,
    transitions,
    options ?? {},
  );

  return pathToResult(path, strategy, startTime, statesVisited);
}
