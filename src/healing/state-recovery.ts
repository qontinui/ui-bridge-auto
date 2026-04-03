/**
 * State recovery after navigation failures.
 *
 * When a transition or navigation fails, StateRecovery detects the
 * current state, re-plans a path to the target, and reports a diagnosis.
 */

import type { StateMachine, TransitionDefinition } from "../state/state-machine";
import type { StateDetector, RegistryLike } from "../state/state-detector";
import { findFirst } from "../core/element-query";
import type { NavigationOptions } from "../state/navigation";
import { navigate } from "../state/navigation";

// ---------------------------------------------------------------------------
// StateRecovery
// ---------------------------------------------------------------------------

/**
 * Recovers from navigation failures by detecting the current state and
 * re-planning a path to the target.
 */
export class StateRecovery {
  constructor(
    private readonly stateMachine: StateMachine,
    private readonly stateDetector: StateDetector,
    private readonly registry: RegistryLike,
  ) {}

  /**
   * Detect the current state by evaluating all state definitions against
   * the current registry elements.
   *
   * Returns the set of state IDs that are currently active.
   */
  detectCurrentState(): Set<string> {
    const elements = this.registry.getAllElements();
    const activeStates = new Set<string>();

    for (const stateDef of this.stateMachine.getAllStateDefinitions()) {
      const allRequired = stateDef.requiredElements.every((query) =>
        findFirst(elements, query) !== null,
      );

      if (!allRequired) continue;

      // Check excluded elements
      const anyExcluded = stateDef.excludedElements?.some((query) =>
        findFirst(elements, query) !== null,
      );

      if (anyExcluded) continue;

      activeStates.add(stateDef.id);
    }

    return activeStates;
  }

  /**
   * Re-plan navigation from the current state to the target.
   *
   * Detects the current state and uses the navigation module to find
   * a path to the target state.
   */
  rePlan(
    targetState: string,
    transitions: TransitionDefinition[],
    options?: NavigationOptions,
  ): TransitionDefinition[] {
    const currentStates = this.detectCurrentState();

    if (currentStates.has(targetState)) {
      return [];
    }

    try {
      const result = navigate(currentStates, targetState, transitions, options);
      return result.path;
    } catch {
      return [];
    }
  }

  /**
   * Full recovery: detect state, re-plan, and report diagnosis.
   *
   * Attempts to determine the current state, find a new path to the
   * target, and provides a diagnostic message about what happened.
   */
  recover(
    targetState: string,
    transitions: TransitionDefinition[],
    error: Error,
  ): {
    recovered: boolean;
    currentStates: Set<string>;
    newPath: TransitionDefinition[];
    diagnosis: string;
  } {
    const currentStates = this.detectCurrentState();

    // Already at target
    if (currentStates.has(targetState)) {
      return {
        recovered: true,
        currentStates,
        newPath: [],
        diagnosis: `Already at target state "${targetState}" despite error: ${error.message}`,
      };
    }

    // Try to re-plan
    const newPath = this.rePlan(targetState, transitions);

    if (newPath.length > 0) {
      const stateList = Array.from(currentStates).join(", ");
      return {
        recovered: true,
        currentStates,
        newPath,
        diagnosis:
          `Recovery found alternative path from [${stateList}] to "${targetState}" ` +
          `(${newPath.length} transitions). Original error: ${error.message}`,
      };
    }

    // Cannot recover
    const stateList = Array.from(currentStates).join(", ");
    return {
      recovered: false,
      currentStates,
      newPath: [],
      diagnosis:
        `Cannot recover: no path from [${stateList}] to "${targetState}". ` +
        `Original error: ${error.message}`,
    };
  }
}
