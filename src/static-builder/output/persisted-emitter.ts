/**
 * Persisted emitter — produces PersistedStateMachine JSON that is
 * loadable by the existing deserialize() function.
 *
 * This format includes version and timestamps and is the standard
 * persistence format for the state machine subsystem.
 */

import type {
  StateDefinition,
  TransitionDefinition,
} from "../../state/state-machine";
import type { PersistedStateMachine } from "../../state/persistence";

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * Produce a PersistedStateMachine from state and transition definitions.
 *
 * @param states - State definitions from the static builder.
 * @param transitions - Transition definitions from the static builder.
 * @returns A PersistedStateMachine ready for JSON serialization.
 */
export function emitPersistedStateMachine(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
): PersistedStateMachine {
  const now = Date.now();

  return {
    version: "1.0.0",
    createdAt: now,
    updatedAt: now,
    states,
    transitions,
  };
}

/**
 * Produce a PersistedStateMachine JSON string.
 *
 * Compatible with the existing `deserialize()` function in
 * `src/state/persistence.ts`.
 */
export function emitPersistedStateMachineJSON(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
): string {
  const data = emitPersistedStateMachine(states, transitions);
  return JSON.stringify(data, null, 2);
}
