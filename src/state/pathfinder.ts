/**
 * Multi-target pathfinding engine aligned with the multistate Python library.
 *
 * Supports BFS, Dijkstra, and A* strategies over a state/transition graph.
 * The search space tracks (activeStates, targetsReached) tuples to support
 * finding paths that visit ALL target states, not just one.
 */

import type { TransitionDefinition } from "./state-machine";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoPathError extends Error {
  public readonly from: Set<string>;
  public readonly targets: Set<string>;

  /** @deprecated Use `targets` instead. Kept for backward compatibility. */
  public readonly target: string;

  constructor(from: Set<string>, targets: Set<string>, message?: string) {
    const targetArr = Array.from(targets);
    super(
      message ??
        `No path from [${Array.from(from).join(", ")}] to targets [${targetArr.join(", ")}]`,
    );
    this.name = "NoPathError";
    this.from = from;
    this.targets = targets;
    // backward compat: expose first target as singular `target`
    this.target = targetArr[0] ?? "";
  }
}

// ---------------------------------------------------------------------------
// PathNode
// ---------------------------------------------------------------------------

/** Node in the search tree. Identity = (activeStates, targetsReached). */
export class PathNode {
  readonly activeStates: Set<string>;
  readonly targetsReached: Set<string>;
  readonly transitionTaken: TransitionDefinition | null;
  readonly parent: PathNode | null;
  readonly cost: number;
  readonly depth: number;

  constructor(params: {
    activeStates: Set<string>;
    targetsReached: Set<string>;
    transitionTaken?: TransitionDefinition | null;
    parent?: PathNode | null;
    cost?: number;
    depth?: number;
  }) {
    this.activeStates = params.activeStates;
    this.targetsReached = params.targetsReached;
    this.transitionTaken = params.transitionTaken ?? null;
    this.parent = params.parent ?? null;
    this.cost = params.cost ?? 0;
    this.depth = params.depth ?? 0;
  }

  /** Hash key for visited set. Canonical sorted string of (active, reached). */
  get key(): string {
    return (
      JSON.stringify([...this.activeStates].sort()) +
      "|" +
      JSON.stringify([...this.targetsReached].sort())
    );
  }
}

// ---------------------------------------------------------------------------
// Path result
// ---------------------------------------------------------------------------

/** A complete path through the state space. */
export interface Path {
  /** State configurations at each step. */
  statesSequence: Set<string>[];
  /** Transitions executed at each step. */
  transitionsSequence: TransitionDefinition[];
  /** All target states. */
  targets: Set<string>;
  /** Total path cost. */
  totalCost: number;
  /** Whether all targets were reached. */
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Simulate applying a transition: remove exitStates, add activateStates. */
export function applyTransition(
  currentStates: Set<string>,
  transition: TransitionDefinition,
): Set<string> {
  const next = new Set(currentStates);
  for (const s of transition.exitStates) next.delete(s);
  for (const s of transition.activateStates) next.add(s);
  return next;
}

/** Get transitions available from the current active states. */
export function getAvailableTransitions(
  activeStates: Set<string>,
  transitions: TransitionDefinition[],
  avoidStates?: string[],
): TransitionDefinition[] {
  const avoidSet = avoidStates ? new Set(avoidStates) : null;
  return transitions.filter((tr) => {
    // Precondition: all fromStates must be active
    if (!tr.fromStates.every((s) => activeStates.has(s))) return false;
    // Avoid constraint: don't activate avoided states
    if (avoidSet) {
      for (const s of tr.activateStates) {
        if (avoidSet.has(s)) return false;
      }
    }
    return true;
  });
}

/** Reconstruct the path from a goal node back to root. */
export function reconstructPath(
  goalNode: PathNode,
  targets: Set<string>,
): Path {
  const statesSequence: Set<string>[] = [];
  const transitionsSequence: TransitionDefinition[] = [];

  // Walk back to root
  let current: PathNode | null = goalNode;
  while (current !== null) {
    statesSequence.unshift(current.activeStates);
    if (current.transitionTaken !== null) {
      transitionsSequence.unshift(current.transitionTaken);
    }
    current = current.parent;
  }

  return {
    statesSequence,
    transitionsSequence,
    targets,
    totalCost: goalNode.cost,
    isComplete:
      goalNode.targetsReached.size === targets.size &&
      [...targets].every((t) => goalNode.targetsReached.has(t)),
  };
}

// ---------------------------------------------------------------------------
// Goal check helper
// ---------------------------------------------------------------------------

function isGoal(node: PathNode, targetStates: Set<string>): boolean {
  return (
    node.targetsReached.size === targetStates.size &&
    [...targetStates].every((t) => node.targetsReached.has(t))
  );
}

/** Compute which targets are reached in a state set. */
function computeReached(
  currentReached: Set<string>,
  newStates: Set<string>,
  targetStates: Set<string>,
): Set<string> {
  const reached = new Set(currentReached);
  for (const t of targetStates) {
    if (newStates.has(t)) reached.add(t);
  }
  return reached;
}

// ---------------------------------------------------------------------------
// BFS
// ---------------------------------------------------------------------------

/** BFS: find path reaching ALL targets (fewest transitions). */
export function bfs(
  currentStates: Set<string>,
  targetStates: Set<string>,
  transitions: TransitionDefinition[],
  options?: { avoidStates?: string[]; maxDepth?: number },
): Path | null {
  const avoidStates = options?.avoidStates;
  const maxDepth = options?.maxDepth;

  const initialReached = computeReached(new Set(), currentStates, targetStates);
  const startNode = new PathNode({
    activeStates: new Set(currentStates),
    targetsReached: initialReached,
  });

  if (isGoal(startNode, targetStates)) {
    return reconstructPath(startNode, targetStates);
  }

  const visited = new Set<string>();
  visited.add(startNode.key);

  // BFS queue (FIFO): shift from front, push to back
  const queue: PathNode[] = [startNode];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (maxDepth !== undefined && current.depth >= maxDepth) continue;

    const available = getAvailableTransitions(
      current.activeStates,
      transitions,
      avoidStates,
    );

    for (const tr of available) {
      const newStates = applyTransition(current.activeStates, tr);
      const newReached = computeReached(
        current.targetsReached,
        newStates,
        targetStates,
      );

      const child = new PathNode({
        activeStates: newStates,
        targetsReached: newReached,
        transitionTaken: tr,
        parent: current,
        cost: current.cost + 1,
        depth: current.depth + 1,
      });

      if (visited.has(child.key)) continue;
      visited.add(child.key);

      if (isGoal(child, targetStates)) {
        return reconstructPath(child, targetStates);
      }

      queue.push(child);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Dijkstra
// ---------------------------------------------------------------------------

/** Dijkstra: find path reaching ALL targets (lowest cost). */
export function dijkstra(
  currentStates: Set<string>,
  targetStates: Set<string>,
  transitions: TransitionDefinition[],
  options?: {
    avoidStates?: string[];
    maxDepth?: number;
    getCost?: (t: TransitionDefinition) => number;
  },
): Path | null {
  const avoidStates = options?.avoidStates;
  const maxDepth = options?.maxDepth;
  const getCost = options?.getCost ?? ((t: TransitionDefinition) => t.pathCost ?? 1.0);

  const initialReached = computeReached(new Set(), currentStates, targetStates);
  const startNode = new PathNode({
    activeStates: new Set(currentStates),
    targetsReached: initialReached,
  });

  if (isGoal(startNode, targetStates)) {
    return reconstructPath(startNode, targetStates);
  }

  const visited = new Set<string>();
  // Simple priority queue via sorted array (fine for realistic graph sizes)
  const openList: PathNode[] = [startNode];

  while (openList.length > 0) {
    // Extract minimum cost node
    openList.sort((a, b) => a.cost - b.cost);
    const current = openList.shift()!;

    const key = current.key;
    if (visited.has(key)) continue;
    visited.add(key);

    if (isGoal(current, targetStates)) {
      return reconstructPath(current, targetStates);
    }

    if (maxDepth !== undefined && current.depth >= maxDepth) continue;

    const available = getAvailableTransitions(
      current.activeStates,
      transitions,
      avoidStates,
    );

    for (const tr of available) {
      const newStates = applyTransition(current.activeStates, tr);
      const newReached = computeReached(
        current.targetsReached,
        newStates,
        targetStates,
      );

      const edgeCost = getCost(tr);
      const child = new PathNode({
        activeStates: newStates,
        targetsReached: newReached,
        transitionTaken: tr,
        parent: current,
        cost: current.cost + edgeCost,
        depth: current.depth + 1,
      });

      if (visited.has(child.key)) continue;

      openList.push(child);
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// A*
// ---------------------------------------------------------------------------

/** A*: find path reaching ALL targets with heuristic. */
export function astar(
  currentStates: Set<string>,
  targetStates: Set<string>,
  transitions: TransitionDefinition[],
  options?: {
    avoidStates?: string[];
    maxDepth?: number;
    getCost?: (t: TransitionDefinition) => number;
    heuristic?: (node: PathNode, targets: Set<string>) => number;
  },
): Path | null {
  const avoidStates = options?.avoidStates;
  const maxDepth = options?.maxDepth;
  const getCost = options?.getCost ?? ((t: TransitionDefinition) => t.pathCost ?? 1.0);
  const heuristic =
    options?.heuristic ??
    ((node: PathNode, targets: Set<string>) => {
      // Default: number of remaining targets not yet reached
      let remaining = 0;
      for (const t of targets) {
        if (!node.targetsReached.has(t)) remaining++;
      }
      return remaining;
    });

  const initialReached = computeReached(new Set(), currentStates, targetStates);
  const startNode = new PathNode({
    activeStates: new Set(currentStates),
    targetsReached: initialReached,
  });

  if (isGoal(startNode, targetStates)) {
    return reconstructPath(startNode, targetStates);
  }

  const visited = new Set<string>();
  // Open list sorted by f = g + h
  interface AStarEntry {
    node: PathNode;
    f: number;
  }
  const openList: AStarEntry[] = [
    { node: startNode, f: startNode.cost + heuristic(startNode, targetStates) },
  ];

  while (openList.length > 0) {
    openList.sort((a, b) => a.f - b.f);
    const { node: current } = openList.shift()!;

    const key = current.key;
    if (visited.has(key)) continue;
    visited.add(key);

    if (isGoal(current, targetStates)) {
      return reconstructPath(current, targetStates);
    }

    if (maxDepth !== undefined && current.depth >= maxDepth) continue;

    const available = getAvailableTransitions(
      current.activeStates,
      transitions,
      avoidStates,
    );

    for (const tr of available) {
      const newStates = applyTransition(current.activeStates, tr);
      const newReached = computeReached(
        current.targetsReached,
        newStates,
        targetStates,
      );

      const edgeCost = getCost(tr);
      const child = new PathNode({
        activeStates: newStates,
        targetsReached: newReached,
        transitionTaken: tr,
        parent: current,
        cost: current.cost + edgeCost,
        depth: current.depth + 1,
      });

      if (visited.has(child.key)) continue;

      const f = child.cost + heuristic(child, targetStates);
      openList.push({ node: child, f });
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Legacy single-target wrapper
// ---------------------------------------------------------------------------

/**
 * Find the cheapest sequence of transitions from the current active state set
 * to one that includes `target`.
 *
 * @returns The ordered list of transitions to execute. Empty if `target` is
 *          already active.
 * @throws  NoPathError if no sequence of transitions can reach the target.
 */
export function findPath(
  from: Set<string>,
  target: string,
  transitions: TransitionDefinition[],
): TransitionDefinition[] {
  const targetSet = new Set([target]);
  const result = dijkstra(from, targetSet, transitions);

  if (result === null) {
    throw new NoPathError(from, targetSet);
  }

  return result.transitionsSequence;
}
