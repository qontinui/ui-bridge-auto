/**
 * Workflow emitter — produces WorkflowConfig JSON from the static builder output.
 *
 * Maps StateDefinition/TransitionDefinition (from state-machine.ts) to the
 * WorkflowConfig format (from config/workflow.ts). The key difference is that
 * TransitionDefinition uses `action: string` while Transition uses `type: ActionType`,
 * and element queries use ElementQuery vs ElementCriteria (superset → subset, safe).
 */

import type {
  StateDefinition,
  TransitionDefinition,
  TransitionAction as SMTransitionAction,
} from "../../state/state-machine";
import type {
  WorkflowConfig,
  WorkflowSettings,
  StateConfig,
  TransitionConfig,
} from "../../config/workflow";
import type { TransitionAction } from "../../types/transition";
import type { ActionType } from "../../types/transition";
import type { ElementCriteria } from "../../types/match";
import { createDefaultSettings, mergeSettings } from "../../config/workflow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the workflow emitter. */
export interface WorkflowEmitterOptions {
  /** Workflow identifier. */
  id: string;
  /** Workflow name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** Semantic version (default "1.0.0"). */
  version?: string;
  /** Initial state ID (default: first state). */
  initialState?: string;
  /** Workflow settings overrides. */
  settings?: Partial<WorkflowSettings>;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * Produce a WorkflowConfig from state and transition definitions.
 *
 * Explicitly maps fields between the two type systems to avoid unsafe casts.
 */
export function emitWorkflowConfig(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
  options: WorkflowEmitterOptions,
): WorkflowConfig {
  const settings = options.settings
    ? mergeSettings(createDefaultSettings(), options.settings)
    : createDefaultSettings();

  return {
    id: options.id,
    name: options.name,
    description: options.description,
    version: options.version ?? "1.0.0",
    states: states.map(toStateConfig),
    transitions: transitions.map(toTransitionConfig),
    initialState: options.initialState ?? states[0]?.id,
    settings,
  };
}

/**
 * Produce a WorkflowConfig JSON string.
 */
export function emitWorkflowConfigJSON(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
  options: WorkflowEmitterOptions,
): string {
  const config = emitWorkflowConfig(states, transitions, options);
  return JSON.stringify(config, null, 2);
}

// ---------------------------------------------------------------------------
// Mapping functions
// ---------------------------------------------------------------------------

/**
 * Map StateDefinition to StateConfig.
 * ElementQuery is a superset of ElementCriteria — safe to narrow.
 */
function toStateConfig(sd: StateDefinition): StateConfig {
  return {
    id: sd.id,
    name: sd.name,
    requiredElements: sd.requiredElements as unknown as ElementCriteria[],
    excludedElements: sd.excludedElements as unknown as
      | ElementCriteria[]
      | undefined,
    conditions: sd.conditions?.map((c) => ({
      element: c.element as unknown as ElementCriteria,
      property: c.property as any,
      expected: c.expected,
    })),
    blocking: sd.blocking,
    group: sd.group,
    pathCost: sd.pathCost,
  };
}

/**
 * Map TransitionDefinition to TransitionConfig.
 * Key difference: TransitionDefinition.actions[].action (string)
 * → Transition.actions[].type (ActionType).
 */
function toTransitionConfig(td: TransitionDefinition): TransitionConfig {
  return {
    id: td.id,
    name: td.name,
    fromStates: td.fromStates,
    activateStates: td.activateStates,
    exitStates: td.exitStates,
    actions: td.actions.map(toTransitionAction),
    pathCost: td.pathCost,
  };
}

/**
 * Map a state-machine TransitionAction to a types/transition TransitionAction.
 * Renames `action` field to `type`.
 */
function toTransitionAction(a: SMTransitionAction): TransitionAction {
  return {
    type: a.action as ActionType,
    target: a.target as unknown as ElementCriteria,
    params: a.params,
    waitAfter: a.waitAfter as TransitionAction["waitAfter"],
  };
}
