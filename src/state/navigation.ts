/**
 * Enhanced navigation with multiple search strategies.
 *
 * Provides BFS (unweighted), Dijkstra (weighted), and A* (heuristic-guided)
 * pathfinding over the state/transition graph. Supports reliability-adjusted
 * costs, state avoidance/preference, multi-target navigation, and timeouts.
 */

import type { TransitionDefinition } from "./state-machine";
import type { ReliabilityTracker } from "./reliability";

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
// Internal types
// ---------------------------------------------------------------------------

/** A node in the search graph (represents a set of active states). */
interface SearchNode {
  states: Set<string>;
  cost: number;
  path: TransitionDefinition[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find a path using BFS (unweighted shortest path).
 *
 * Ignores transition costs — finds the path with the fewest transitions.
 */
export function bfsSearch(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const opts = normalizeOptions(options);

  if (activeStates.has(target)) {
    return emptyResult("bfs", startTime);
  }

  const visited = new Set<string>();
  const queue: SearchNode[] = [
    { states: new Set(activeStates), cost: 0, path: [], depth: 0 },
  ];
  let statesVisited = 0;

  while (queue.length > 0) {
    if (isTimedOut(startTime, opts.timeout)) break;

    const current = queue.shift()!;
    const key = stateSetKey(current.states);

    if (visited.has(key)) continue;
    visited.add(key);
    statesVisited++;

    for (const tr of transitions) {
      if (!canApply(tr, current.states, opts)) continue;
      if (opts.maxDepth !== undefined && current.depth + 1 > opts.maxDepth) continue;

      const next = applyTransition(tr, current.states);
      const nextKey = stateSetKey(next);
      if (visited.has(nextKey)) continue;

      const newPath = [...current.path, tr];

      if (next.has(target)) {
        return {
          path: newPath,
          totalCost: newPath.length, // BFS: cost = number of transitions
          strategy: "bfs",
          searchTimeMs: Date.now() - startTime,
          statesVisited,
        };
      }

      queue.push({
        states: next,
        cost: current.cost + 1,
        path: newPath,
        depth: current.depth + 1,
      });
    }
  }

  return noPathResult("bfs", startTime, statesVisited);
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
  const opts = normalizeOptions(options);

  if (activeStates.has(target)) {
    return emptyResult("astar", startTime);
  }

  const visited = new Set<string>();
  // Priority queue sorted by f = g + h
  const openList: Array<SearchNode & { f: number }> = [
    {
      states: new Set(activeStates),
      cost: 0,
      path: [],
      depth: 0,
      f: heuristic(activeStates, target),
    },
  ];
  let statesVisited = 0;

  while (openList.length > 0) {
    if (isTimedOut(startTime, opts.timeout)) break;

    // Pop node with lowest f score
    openList.sort((a, b) => a.f - b.f);
    const current = openList.shift()!;
    const key = stateSetKey(current.states);

    if (visited.has(key)) continue;
    visited.add(key);
    statesVisited++;

    for (const tr of transitions) {
      if (!canApply(tr, current.states, opts)) continue;
      if (opts.maxDepth !== undefined && current.depth + 1 > opts.maxDepth) continue;

      const next = applyTransition(tr, current.states);
      const nextKey = stateSetKey(next);
      if (visited.has(nextKey)) continue;

      const edgeCost = getEdgeCost(tr, opts);
      const g = current.cost + edgeCost;
      const newPath = [...current.path, tr];

      if (next.has(target)) {
        return {
          path: newPath,
          totalCost: g,
          strategy: "astar",
          searchTimeMs: Date.now() - startTime,
          statesVisited,
        };
      }

      const h = heuristic(next, target);
      openList.push({
        states: next,
        cost: g,
        path: newPath,
        depth: current.depth + 1,
        f: g + h,
      });
    }
  }

  return noPathResult("astar", startTime, statesVisited);
}

/**
 * Find the cheapest path to any of multiple target states.
 *
 * Runs a single Dijkstra search that terminates when any target is reached.
 *
 * @returns The result for the cheapest reachable target.
 */
export function navigateToAny(
  activeStates: Set<string>,
  targets: string[],
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const opts = normalizeOptions(options);
  const strategy = opts.strategy ?? "dijkstra";

  // Check if any target is already active
  for (const t of targets) {
    if (activeStates.has(t)) {
      return emptyResult(strategy, startTime);
    }
  }

  const targetSet = new Set(targets);
  const visited = new Set<string>();
  const queue: SearchNode[] = [
    { states: new Set(activeStates), cost: 0, path: [], depth: 0 },
  ];
  let statesVisited = 0;

  while (queue.length > 0) {
    if (isTimedOut(startTime, opts.timeout)) break;

    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const key = stateSetKey(current.states);

    if (visited.has(key)) continue;
    visited.add(key);
    statesVisited++;

    for (const tr of transitions) {
      if (!canApply(tr, current.states, opts)) continue;
      if (opts.maxDepth !== undefined && current.depth + 1 > opts.maxDepth) continue;

      const next = applyTransition(tr, current.states);
      const nextKey = stateSetKey(next);
      if (visited.has(nextKey)) continue;

      const edgeCost = getEdgeCost(tr, opts);
      const newPath = [...current.path, tr];

      // Check if any target is reached
      for (const t of targetSet) {
        if (next.has(t)) {
          return {
            path: newPath,
            totalCost: current.cost + edgeCost,
            strategy,
            searchTimeMs: Date.now() - startTime,
            statesVisited,
          };
        }
      }

      queue.push({
        states: next,
        cost: current.cost + edgeCost,
        path: newPath,
        depth: current.depth + 1,
      });
    }
  }

  return noPathResult(strategy, startTime, statesVisited);
}

/**
 * Navigate from the active state set to a target state using the specified
 * strategy.
 *
 * Dispatches to the appropriate algorithm based on `options.strategy`.
 * For A*, uses a simple default heuristic (0 — degrades to Dijkstra).
 */
export function navigate(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const strategy = options?.strategy ?? "dijkstra";

  switch (strategy) {
    case "bfs":
      return bfsSearch(activeStates, target, transitions, options);

    case "astar":
      // Default heuristic: always 0 (admissible, degrades to Dijkstra)
      return astarSearch(
        activeStates,
        target,
        transitions,
        () => 0,
        options,
      );

    case "dijkstra":
    default:
      return dijkstraSearch(activeStates, target, transitions, options);
  }
}

// ---------------------------------------------------------------------------
// Dijkstra (internal, shared with navigate)
// ---------------------------------------------------------------------------

/**
 * Dijkstra search with reliability-adjusted costs and constraints.
 */
function dijkstraSearch(
  activeStates: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
  options?: NavigationOptions,
): NavigationResult {
  const startTime = Date.now();
  const opts = normalizeOptions(options);

  if (activeStates.has(target)) {
    return emptyResult("dijkstra", startTime);
  }

  const visited = new Set<string>();
  const queue: SearchNode[] = [
    { states: new Set(activeStates), cost: 0, path: [], depth: 0 },
  ];
  let statesVisited = 0;

  while (queue.length > 0) {
    if (isTimedOut(startTime, opts.timeout)) break;

    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const key = stateSetKey(current.states);

    if (visited.has(key)) continue;
    visited.add(key);
    statesVisited++;

    for (const tr of transitions) {
      if (!canApply(tr, current.states, opts)) continue;
      if (opts.maxDepth !== undefined && current.depth + 1 > opts.maxDepth) continue;

      const next = applyTransition(tr, current.states);
      const nextKey = stateSetKey(next);
      if (visited.has(nextKey)) continue;

      const edgeCost = getEdgeCost(tr, opts);
      const newPath = [...current.path, tr];

      if (next.has(target)) {
        return {
          path: newPath,
          totalCost: current.cost + edgeCost,
          strategy: "dijkstra",
          searchTimeMs: Date.now() - startTime,
          statesVisited,
        };
      }

      queue.push({
        states: next,
        cost: current.cost + edgeCost,
        path: newPath,
        depth: current.depth + 1,
      });
    }
  }

  return noPathResult("dijkstra", startTime, statesVisited);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Serialise a Set<string> into a stable cache key. */
function stateSetKey(states: Set<string>): string {
  return Array.from(states).sort().join("|");
}

/** Check whether a transition's preconditions are met and constraints allow it. */
function canApply(
  tr: TransitionDefinition,
  states: Set<string>,
  opts: Required<
    Pick<NavigationOptions, "avoidStates">
  > & NavigationOptions,
): boolean {
  // Preconditions: all fromStates must be active
  if (!tr.fromStates.every((s) => states.has(s))) return false;

  // Avoid constraint: don't produce state sets containing avoided states
  if (opts.avoidStates && opts.avoidStates.length > 0) {
    for (const s of tr.activateStates) {
      if (opts.avoidStates.includes(s)) return false;
    }
  }

  return true;
}

/** Apply a transition to a state set, producing the next state set. */
function applyTransition(
  tr: TransitionDefinition,
  states: Set<string>,
): Set<string> {
  const next = new Set(states);
  for (const s of tr.exitStates) next.delete(s);
  for (const s of tr.activateStates) next.add(s);
  return next;
}

/**
 * Compute the effective edge cost for a transition, accounting for
 * reliability adjustments and state preference bonuses.
 */
function getEdgeCost(tr: TransitionDefinition, opts: NavigationOptions): number {
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
}

/** Normalise options with defaults. */
function normalizeOptions(
  options?: NavigationOptions,
): NavigationOptions & { avoidStates: string[] } {
  return {
    ...options,
    avoidStates: options?.avoidStates ?? [],
  };
}

/** Build a result for when the target is already active. */
function emptyResult(strategy: SearchStrategy, startTime: number): NavigationResult {
  return {
    path: [],
    totalCost: 0,
    strategy,
    searchTimeMs: Date.now() - startTime,
    statesVisited: 0,
  };
}

/** Build a result when no path was found. */
function noPathResult(
  strategy: SearchStrategy,
  startTime: number,
  statesVisited: number,
): NavigationResult {
  return {
    path: [],
    totalCost: Infinity,
    strategy,
    searchTimeMs: Date.now() - startTime,
    statesVisited,
  };
}

/** Check if the search has exceeded its timeout. */
function isTimedOut(
  startTime: number,
  timeout: number | undefined,
): boolean {
  if (timeout === undefined) return false;
  return Date.now() - startTime > timeout;
}
