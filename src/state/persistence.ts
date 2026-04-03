/**
 * State machine persistence — save, load, merge, and validate.
 *
 * Serialises the full state machine (definitions, transitions, reliability
 * data, co-occurrence data) to JSON and deserialises it back. Also supports
 * merging discovered states with manually defined ones.
 */

import type { StateDefinition, TransitionDefinition } from "./state-machine";
import { ReliabilityTracker } from "./reliability";
import type { ReliabilityRecord } from "./reliability";
import { CoOccurrenceMatrix } from "./co-occurrence";
import type { CoOccurrenceData } from "./co-occurrence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Version string for the persistence format. */
const PERSISTENCE_VERSION = "1.0.0";

/** Full persisted state machine structure. */
export interface PersistedStateMachine {
  /** Format version for forwards-compatibility. */
  version: string;
  /** Epoch timestamp when first created. */
  createdAt: number;
  /** Epoch timestamp when last updated. */
  updatedAt: number;
  /** All state definitions. */
  states: StateDefinition[];
  /** All transition definitions. */
  transitions: TransitionDefinition[];
  /** Optional transition reliability data. */
  reliability?: ReliabilityRecord[];
  /** Optional co-occurrence discovery data. */
  discovery?: CoOccurrenceData;
}

// ---------------------------------------------------------------------------
// Serialize / Deserialize
// ---------------------------------------------------------------------------

/**
 * Serialise a state machine and its supporting data to a JSON string.
 *
 * @param states - State definitions.
 * @param transitions - Transition definitions.
 * @param reliability - Optional reliability tracker.
 * @param coOccurrence - Optional co-occurrence matrix.
 * @returns JSON string.
 */
export function serialize(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
  reliability?: ReliabilityTracker,
  coOccurrence?: CoOccurrenceMatrix,
): string {
  const data: PersistedStateMachine = {
    version: PERSISTENCE_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    states,
    transitions,
    reliability: reliability?.toJSON(),
    discovery: coOccurrence?.toJSON(),
  };

  return JSON.stringify(data, null, 2);
}

/**
 * Deserialise a state machine from a JSON string.
 *
 * @param json - JSON string produced by `serialize()`.
 * @returns Parsed state definitions, transitions, and optional tracker/matrix.
 */
export function deserialize(json: string): {
  states: StateDefinition[];
  transitions: TransitionDefinition[];
  reliability?: ReliabilityTracker;
  coOccurrence?: CoOccurrenceMatrix;
} {
  const data: PersistedStateMachine = JSON.parse(json);

  const result: {
    states: StateDefinition[];
    transitions: TransitionDefinition[];
    reliability?: ReliabilityTracker;
    coOccurrence?: CoOccurrenceMatrix;
  } = {
    states: data.states ?? [],
    transitions: data.transitions ?? [],
  };

  if (data.reliability && data.reliability.length > 0) {
    result.reliability = ReliabilityTracker.fromJSON(data.reliability);
  }

  if (data.discovery) {
    result.coOccurrence = CoOccurrenceMatrix.fromJSON(data.discovery);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge discovered states/transitions with manually defined ones.
 *
 * Manual definitions win on ID conflict. Discovered states/transitions with
 * IDs that already exist in the manual set are discarded.
 *
 * @param manual - Manually defined states and transitions.
 * @param discovered - Auto-discovered states and transitions.
 * @returns Merged state and transition arrays.
 */
export function mergeStateMachines(
  manual: { states: StateDefinition[]; transitions: TransitionDefinition[] },
  discovered: { states: StateDefinition[]; transitions: TransitionDefinition[] },
): { states: StateDefinition[]; transitions: TransitionDefinition[] } {
  // Build lookup sets of manual IDs
  const manualStateIds = new Set(manual.states.map((s) => s.id));
  const manualTransitionIds = new Set(manual.transitions.map((t) => t.id));

  // Add discovered states that don't conflict
  const mergedStates = [...manual.states];
  for (const ds of discovered.states) {
    if (!manualStateIds.has(ds.id)) {
      mergedStates.push(ds);
    }
  }

  // Add discovered transitions that don't conflict
  const mergedTransitions = [...manual.transitions];
  for (const dt of discovered.transitions) {
    if (!manualTransitionIds.has(dt.id)) {
      // Verify that fromStates and activateStates reference valid states
      const allStateIds = new Set(mergedStates.map((s) => s.id));
      const fromValid = dt.fromStates.every((s) => allStateIds.has(s));
      const toValid = dt.activateStates.every((s) => allStateIds.has(s));

      if (fromValid && toValid) {
        mergedTransitions.push(dt);
      }
    }
  }

  return { states: mergedStates, transitions: mergedTransitions };
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate a persisted state machine for internal consistency.
 *
 * Checks:
 * - Version string is present.
 * - No duplicate state IDs.
 * - No duplicate transition IDs.
 * - All transition fromStates/activateStates/exitStates reference existing states.
 * - Timestamps are reasonable.
 *
 * @param data - The persisted state machine to validate.
 * @returns Validation result with any errors found.
 */
export function validate(data: PersistedStateMachine): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Version
  if (!data.version) {
    errors.push("Missing version field.");
  }

  // States
  if (!Array.isArray(data.states)) {
    errors.push("States must be an array.");
  } else {
    const stateIds = new Set<string>();
    for (const state of data.states) {
      if (!state.id) {
        errors.push("State is missing an ID.");
      } else if (stateIds.has(state.id)) {
        errors.push(`Duplicate state ID: "${state.id}".`);
      } else {
        stateIds.add(state.id);
      }

      if (!state.name) {
        errors.push(`State "${state.id}" is missing a name.`);
      }

      if (!Array.isArray(state.requiredElements)) {
        errors.push(
          `State "${state.id}" has invalid requiredElements (must be an array).`,
        );
      }
    }

    // Transitions
    if (!Array.isArray(data.transitions)) {
      errors.push("Transitions must be an array.");
    } else {
      const transitionIds = new Set<string>();
      for (const tr of data.transitions) {
        if (!tr.id) {
          errors.push("Transition is missing an ID.");
        } else if (transitionIds.has(tr.id)) {
          errors.push(`Duplicate transition ID: "${tr.id}".`);
        } else {
          transitionIds.add(tr.id);
        }

        // Check state references
        for (const sid of tr.fromStates ?? []) {
          if (!stateIds.has(sid)) {
            errors.push(
              `Transition "${tr.id}" references unknown fromState "${sid}".`,
            );
          }
        }
        for (const sid of tr.activateStates ?? []) {
          if (!stateIds.has(sid)) {
            errors.push(
              `Transition "${tr.id}" references unknown activateState "${sid}".`,
            );
          }
        }
        for (const sid of tr.exitStates ?? []) {
          if (!stateIds.has(sid)) {
            errors.push(
              `Transition "${tr.id}" references unknown exitState "${sid}".`,
            );
          }
        }
      }
    }
  }

  // Timestamps
  if (typeof data.createdAt !== "number" || data.createdAt <= 0) {
    errors.push("Invalid createdAt timestamp.");
  }
  if (typeof data.updatedAt !== "number" || data.updatedAt <= 0) {
    errors.push("Invalid updatedAt timestamp.");
  }
  if (
    typeof data.createdAt === "number" &&
    typeof data.updatedAt === "number" &&
    data.updatedAt < data.createdAt
  ) {
    errors.push("updatedAt is earlier than createdAt.");
  }

  return { valid: errors.length === 0, errors };
}
