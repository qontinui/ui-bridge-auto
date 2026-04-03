/**
 * Dijkstra pathfinding over the state/transition graph.
 *
 * Given a set of currently-active states and a target state, finds the
 * cheapest sequence of transitions to activate the target.
 */

import type { TransitionDefinition } from "./state-machine";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class NoPathError extends Error {
  public readonly from: Set<string>;
  public readonly target: string;

  constructor(from: Set<string>, target: string) {
    super(
      `No path from [${Array.from(from).join(", ")}] to state "${target}"`,
    );
    this.name = "NoPathError";
    this.from = from;
    this.target = target;
  }
}

// ---------------------------------------------------------------------------
// Pathfinder
// ---------------------------------------------------------------------------

/**
 * Serialise a Set<string> into a stable cache key.
 */
function stateSetKey(states: Set<string>): string {
  return Array.from(states).sort().join("|");
}

/**
 * Find the cheapest sequence of transitions from the current active state
 * set to one that includes `target`.
 *
 * Each node in the search graph is a set of active states. Edges are
 * transitions whose `fromStates` are all contained in the current set.
 * Applying a transition produces a new state set by adding `activateStates`
 * and removing `exitStates`.
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
  // Already there
  if (from.has(target)) return [];

  // Dijkstra
  interface Node {
    states: Set<string>;
    cost: number;
    path: TransitionDefinition[];
  }

  const startKey = stateSetKey(from);
  const visited = new Set<string>();

  // Priority queue (simple array; fine for realistic graph sizes)
  const queue: Node[] = [{ states: new Set(from), cost: 0, path: [] }];

  while (queue.length > 0) {
    // Pop lowest-cost node
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift()!;
    const key = stateSetKey(current.states);

    if (visited.has(key)) continue;
    visited.add(key);

    // Try every transition whose preconditions are met
    for (const tr of transitions) {
      const preOk = tr.fromStates.every((s) => current.states.has(s));
      if (!preOk) continue;

      // Compute next state set
      const next = new Set(current.states);
      for (const s of tr.exitStates) next.delete(s);
      for (const s of tr.activateStates) next.add(s);

      const nextKey = stateSetKey(next);
      if (visited.has(nextKey)) continue;

      const edgeCost = tr.pathCost ?? 1.0;
      const newPath = [...current.path, tr];

      // Found target?
      if (next.has(target)) {
        return newPath;
      }

      queue.push({ states: next, cost: current.cost + edgeCost, path: newPath });
    }
  }

  throw new NoPathError(from, target);
}
