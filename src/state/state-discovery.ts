/**
 * Automatic state discovery from element snapshots.
 *
 * Observes elements over time and clusters them into states based on
 * co-occurrence patterns. Also detects transitions by correlating user
 * actions with state changes.
 */

import type { QueryableElement } from "../core/element-query";
import type { ElementFingerprint } from "../discovery/element-fingerprint";
import { computeFingerprint } from "../discovery/element-fingerprint";
import type { ActionType } from "../types/transition";
import type { StateDefinition, TransitionDefinition } from "./state-machine";
import { CoOccurrenceMatrix } from "./co-occurrence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for state discovery. */
export interface DiscoveryConfig {
  /** Minimum snapshots to consider a group a state (default 3). */
  minObservations: number;
  /** Element overlap percentage to merge states (default 0.9). */
  mergeThreshold: number;
  /** Ignore elements seen fewer than 2 times (default true). */
  ignoreTransient: boolean;
  /** Maximum number of states to discover (default 50). */
  maxStates: number;
}

/** A state discovered from observation data. */
export interface DiscoveredState {
  /** Unique identifier for this discovered state. */
  id: string;
  /** Human-readable name (auto-generated). */
  name: string;
  /** Element IDs that define this state. */
  elementIds: string[];
  /** Structural fingerprints of the defining elements. */
  fingerprints: ElementFingerprint[];
  /** How many snapshots this state was observed in. */
  observationCount: number;
  /** Epoch timestamp when first observed. */
  firstSeenAt: number;
  /** Epoch timestamp when last observed. */
  lastSeenAt: number;
}

/** A transition discovered from action/state correlations. */
export interface DiscoveredTransition {
  /** Unique identifier for this discovered transition. */
  id: string;
  /** State ID before the transition. */
  fromStateId: string;
  /** State ID after the transition. */
  toStateId: string;
  /** The action that triggered this transition (if known). */
  triggerAction?: { type: ActionType; elementId: string };
  /** How many times this transition was observed. */
  observationCount: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface Snapshot {
  elementIds: string[];
  fingerprints: Map<string, ElementFingerprint>;
  timestamp: number;
}

interface RecordedAction {
  type: ActionType;
  elementId: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// StateDiscovery
// ---------------------------------------------------------------------------

/**
 * Automatically discover states from element snapshots and interaction
 * recordings.
 *
 * Usage:
 * 1. Call `recordSnapshot()` each time the DOM changes.
 * 2. Call `recordAction()` when the user performs an action.
 * 3. Call `discover()` to cluster snapshots into states and detect transitions.
 * 4. Use `toStateDefinitions()` / `toTransitionDefinitions()` to feed results
 *    back into the StateMachine.
 */
export class StateDiscovery {
  private readonly config: DiscoveryConfig;
  private readonly _coOccurrence = new CoOccurrenceMatrix();

  private readonly snapshots: Snapshot[] = [];
  private readonly actions: RecordedAction[] = [];

  private discoveredStates: DiscoveredState[] = [];
  private discoveredTransitions: DiscoveredTransition[] = [];

  /** Maps element ID to its most recent fingerprint. */
  private readonly fingerprintCache = new Map<string, ElementFingerprint>();

  private nextStateIndex = 0;
  private nextTransitionIndex = 0;

  constructor(config?: Partial<DiscoveryConfig>) {
    this.config = {
      minObservations: config?.minObservations ?? 3,
      mergeThreshold: config?.mergeThreshold ?? 0.9,
      ignoreTransient: config?.ignoreTransient ?? true,
      maxStates: config?.maxStates ?? 50,
    };
  }

  // -----------------------------------------------------------------------
  // Recording
  // -----------------------------------------------------------------------

  /** Record a snapshot of currently visible elements with their fingerprints. */
  recordSnapshot(elements: QueryableElement[]): void {
    const elementIds: string[] = [];
    const fingerprints = new Map<string, ElementFingerprint>();

    for (const el of elements) {
      elementIds.push(el.id);
      const fp = computeFingerprint(el.element);
      fingerprints.set(el.id, fp);
      this.fingerprintCache.set(el.id, fp);
    }

    this.snapshots.push({
      elementIds,
      fingerprints,
      timestamp: Date.now(),
    });

    this._coOccurrence.record(elementIds);
  }

  /** Record an action that was performed (for transition detection). */
  recordAction(action: { type: ActionType; elementId: string }): void {
    this.actions.push({
      ...action,
      timestamp: Date.now(),
    });
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Run discovery on all recorded data.
   *
   * 1. Uses the co-occurrence matrix to find element groups.
   * 2. Filters groups by minimum observation count.
   * 3. Merges overlapping groups above the merge threshold.
   * 4. Detects transitions by looking at state changes correlated with actions.
   *
   * @returns Discovered states and transitions.
   */
  discover(): { states: DiscoveredState[]; transitions: DiscoveredTransition[] } {
    // Step 1: Find co-occurrence groups
    const groups = this._coOccurrence.findGroups(this.config.mergeThreshold);

    // Step 2: Filter transient elements if configured
    const filteredGroups = this.config.ignoreTransient
      ? groups.map((g) =>
          g.filter((id) => this._coOccurrence.elementCount(id) >= 2),
        ).filter((g) => g.length >= 2)
      : groups;

    // Step 3: Build candidate states from groups
    const candidates: DiscoveredState[] = [];
    for (const group of filteredGroups) {
      const observations = this.countGroupObservations(group);
      if (observations < this.config.minObservations) continue;

      const timestamps = this.getGroupTimestamps(group);
      const state: DiscoveredState = {
        id: `discovered-${this.nextStateIndex++}`,
        name: `State ${this.nextStateIndex}`,
        elementIds: group,
        fingerprints: group
          .map((id) => this.fingerprintCache.get(id))
          .filter((fp): fp is ElementFingerprint => fp !== undefined),
        observationCount: observations,
        firstSeenAt: timestamps.first,
        lastSeenAt: timestamps.last,
      };
      candidates.push(state);
    }

    // Step 4: Merge overlapping states
    this.discoveredStates = this.mergeOverlapping(candidates);

    // Step 5: Cap at maxStates — keep the most observed
    if (this.discoveredStates.length > this.config.maxStates) {
      this.discoveredStates.sort(
        (a, b) => b.observationCount - a.observationCount,
      );
      this.discoveredStates = this.discoveredStates.slice(
        0,
        this.config.maxStates,
      );
    }

    // Step 6: Detect transitions from state-change + action correlation
    this.discoveredTransitions = this.detectTransitions();

    return {
      states: [...this.discoveredStates],
      transitions: [...this.discoveredTransitions],
    };
  }

  /**
   * Merge two states that have been identified as duplicates.
   *
   * Combines their element sets, fingerprints, and observation data. The
   * resulting state takes `stateA`'s ID.
   */
  mergeStates(stateAId: string, stateBId: string): DiscoveredState {
    const stateA = this.discoveredStates.find((s) => s.id === stateAId);
    const stateB = this.discoveredStates.find((s) => s.id === stateBId);
    if (!stateA) throw new Error(`State "${stateAId}" not found`);
    if (!stateB) throw new Error(`State "${stateBId}" not found`);

    const mergedIds = [...new Set([...stateA.elementIds, ...stateB.elementIds])];
    const mergedFps = [...new Set([...stateA.fingerprints, ...stateB.fingerprints])];

    const merged: DiscoveredState = {
      id: stateA.id,
      name: stateA.name,
      elementIds: mergedIds,
      fingerprints: mergedFps,
      observationCount: stateA.observationCount + stateB.observationCount,
      firstSeenAt: Math.min(stateA.firstSeenAt, stateB.firstSeenAt),
      lastSeenAt: Math.max(stateA.lastSeenAt, stateB.lastSeenAt),
    };

    // Replace stateA, remove stateB
    this.discoveredStates = this.discoveredStates
      .filter((s) => s.id !== stateAId && s.id !== stateBId);
    this.discoveredStates.push(merged);

    // Update transitions referencing stateB
    for (const t of this.discoveredTransitions) {
      if (t.fromStateId === stateBId) t.fromStateId = stateAId;
      if (t.toStateId === stateBId) t.toStateId = stateAId;
    }

    return merged;
  }

  /**
   * Convert discovered states to StateDefinition format for the StateMachine.
   *
   * Each discovered state becomes a StateDefinition whose `requiredElements`
   * match by element ID.
   */
  toStateDefinitions(): StateDefinition[] {
    return this.discoveredStates.map((ds) => ({
      id: ds.id,
      name: ds.name,
      requiredElements: ds.elementIds.map((eid) => ({ id: eid })),
      group: "discovered",
    }));
  }

  /**
   * Convert discovered transitions to TransitionDefinition format.
   */
  toTransitionDefinitions(): TransitionDefinition[] {
    return this.discoveredTransitions.map((dt) => ({
      id: dt.id,
      name: `${dt.fromStateId} -> ${dt.toStateId}`,
      fromStates: [dt.fromStateId],
      activateStates: [dt.toStateId],
      exitStates: [dt.fromStateId],
      actions: dt.triggerAction
        ? [
            {
              target: { id: dt.triggerAction.elementId },
              action: dt.triggerAction.type,
            },
          ]
        : [],
      pathCost: 1.0,
    }));
  }

  /** Get the co-occurrence matrix. */
  get coOccurrence(): CoOccurrenceMatrix {
    return this._coOccurrence;
  }

  /** Reset all discovery data. */
  clear(): void {
    this.snapshots.length = 0;
    this.actions.length = 0;
    this.discoveredStates = [];
    this.discoveredTransitions = [];
    this._coOccurrence.clear();
    this.fingerprintCache.clear();
    this.nextStateIndex = 0;
    this.nextTransitionIndex = 0;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Count how many snapshots contain ALL elements in a group.
   */
  private countGroupObservations(group: string[]): number {
    let count = 0;
    for (const snapshot of this.snapshots) {
      const ids = new Set(snapshot.elementIds);
      if (group.every((id) => ids.has(id))) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get the first and last timestamp for snapshots containing all group elements.
   */
  private getGroupTimestamps(group: string[]): { first: number; last: number } {
    let first = Infinity;
    let last = -Infinity;
    for (const snapshot of this.snapshots) {
      const ids = new Set(snapshot.elementIds);
      if (group.every((id) => ids.has(id))) {
        if (snapshot.timestamp < first) first = snapshot.timestamp;
        if (snapshot.timestamp > last) last = snapshot.timestamp;
      }
    }
    return {
      first: first === Infinity ? Date.now() : first,
      last: last === -Infinity ? Date.now() : last,
    };
  }

  /**
   * Merge overlapping candidate states.
   *
   * Two states are merged if the element overlap exceeds `mergeThreshold`.
   * Overlap is defined as `|intersection| / |smaller set|`.
   */
  private mergeOverlapping(candidates: DiscoveredState[]): DiscoveredState[] {
    const result: DiscoveredState[] = [...candidates];
    let merged = true;

    while (merged) {
      merged = false;
      for (let i = 0; i < result.length && !merged; i++) {
        for (let j = i + 1; j < result.length && !merged; j++) {
          const overlap = this.computeOverlap(
            result[i].elementIds,
            result[j].elementIds,
          );
          if (overlap >= this.config.mergeThreshold) {
            // Merge j into i
            const mergedIds = [
              ...new Set([...result[i].elementIds, ...result[j].elementIds]),
            ];
            const mergedFps = [
              ...new Set([
                ...result[i].fingerprints,
                ...result[j].fingerprints,
              ]),
            ];
            result[i] = {
              ...result[i],
              elementIds: mergedIds,
              fingerprints: mergedFps,
              observationCount:
                result[i].observationCount + result[j].observationCount,
              firstSeenAt: Math.min(
                result[i].firstSeenAt,
                result[j].firstSeenAt,
              ),
              lastSeenAt: Math.max(
                result[i].lastSeenAt,
                result[j].lastSeenAt,
              ),
            };
            result.splice(j, 1);
            merged = true;
          }
        }
      }
    }

    return result;
  }

  /** Compute element overlap ratio between two ID sets. */
  private computeOverlap(a: string[], b: string[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const id of setA) {
      if (setB.has(id)) intersection++;
    }
    const smaller = Math.min(setA.size, setB.size);
    return smaller === 0 ? 0 : intersection / smaller;
  }

  /**
   * Detect transitions by correlating actions with state changes.
   *
   * Walks through snapshots in order. When the active state set changes
   * and an action was recorded between the two snapshots, a transition
   * is recorded.
   */
  private detectTransitions(): DiscoveredTransition[] {
    if (this.discoveredStates.length === 0 || this.snapshots.length < 2) {
      return [];
    }

    const transitionMap = new Map<string, DiscoveredTransition>();

    for (let i = 1; i < this.snapshots.length; i++) {
      const prevSnapshot = this.snapshots[i - 1];
      const currSnapshot = this.snapshots[i];

      const prevState = this.matchSnapshotToState(prevSnapshot);
      const currState = this.matchSnapshotToState(currSnapshot);

      if (!prevState || !currState || prevState.id === currState.id) continue;

      // Find actions between these snapshots
      const relevantAction = this.actions.find(
        (a) =>
          a.timestamp >= prevSnapshot.timestamp &&
          a.timestamp <= currSnapshot.timestamp,
      );

      const key = `${prevState.id}->${currState.id}`;
      const existing = transitionMap.get(key);

      if (existing) {
        existing.observationCount++;
        // Keep the first observed trigger action
      } else {
        transitionMap.set(key, {
          id: `discovered-t-${this.nextTransitionIndex++}`,
          fromStateId: prevState.id,
          toStateId: currState.id,
          triggerAction: relevantAction
            ? { type: relevantAction.type, elementId: relevantAction.elementId }
            : undefined,
          observationCount: 1,
        });
      }
    }

    return Array.from(transitionMap.values());
  }

  /**
   * Find the best matching discovered state for a snapshot.
   *
   * Returns the state whose element set has the highest overlap with the
   * snapshot's element IDs.
   */
  private matchSnapshotToState(snapshot: Snapshot): DiscoveredState | null {
    let bestState: DiscoveredState | null = null;
    let bestOverlap = 0;

    const snapshotIds = new Set(snapshot.elementIds);

    for (const state of this.discoveredStates) {
      let matched = 0;
      for (const eid of state.elementIds) {
        if (snapshotIds.has(eid)) matched++;
      }
      const overlap =
        state.elementIds.length === 0
          ? 0
          : matched / state.elementIds.length;

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestState = state;
      }
    }

    // Only return if at least 50% of the state's elements are present
    return bestOverlap >= 0.5 ? bestState : null;
  }
}
