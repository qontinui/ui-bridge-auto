/**
 * Generate reusable playbooks from recording sessions.
 *
 * A playbook is a high-level sequence of steps extracted from a recording,
 * with element targets converted to ElementCriteria for flexible re-matching.
 * Playbooks can be converted to FlowDefinitions or ActionSteps for execution.
 */

import type { ElementCriteria } from "../types/match";
import type { ActionType } from "../types/transition";
import type { ActionStep } from "../batch/action-sequence";
import type { FlowDefinition } from "../batch/flow";
import type {
  RecordedAction,
  RecordedStateChange,
  RecordingSession,
} from "./session-recorder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A reusable playbook generated from a recording. */
export interface Playbook {
  id: string;
  name: string;
  description?: string;
  steps: PlaybookStep[];
  createdFrom?: string;
  createdAt: number;
}

/** A single step in a playbook. */
export interface PlaybookStep {
  action: string;
  target: ElementCriteria;
  params?: Record<string, unknown>;
  expectedStateAfter?: string;
  waitAfterMs?: number;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let playbookCounter = 0;

function nextPlaybookId(): string {
  return `playbook-${++playbookCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// PlaybookGenerator
// ---------------------------------------------------------------------------

/**
 * Generates playbooks from recording sessions.
 *
 * Extracts action events from a recording and converts them into playbook
 * steps with element criteria derived from the recorded element IDs and
 * labels. State changes following actions are captured as expected states.
 */
export class PlaybookGenerator {
  /**
   * Generate a playbook from a recording session.
   *
   * Walks through the session events, converting action events into playbook
   * steps. If a stateChange event follows an action, the entered states are
   * recorded as the expected state after the action.
   */
  generate(session: RecordingSession, name: string): Playbook {
    const steps: PlaybookStep[] = [];

    for (let i = 0; i < session.events.length; i++) {
      const event = session.events[i];

      if (event.type === "action") {
        const action = event.data as RecordedAction;
        if (!action.success) continue;

        const target: ElementCriteria = this.buildCriteria(action);
        const step: PlaybookStep = {
          action: action.actionType,
          target,
          params: action.params,
          waitAfterMs: Math.max(100, action.durationMs),
        };

        // Look ahead for a state change
        const nextEvent = session.events[i + 1];
        if (nextEvent?.type === "stateChange") {
          const stateChange = nextEvent.data as RecordedStateChange;
          if (stateChange.entered.length > 0) {
            step.expectedStateAfter = stateChange.entered[0];
          }
        }

        steps.push(step);
      }
    }

    return {
      id: nextPlaybookId(),
      name,
      steps,
      createdFrom: session.id,
      createdAt: Date.now(),
    };
  }

  /**
   * Convert a playbook to a FlowDefinition for use with FlowRegistry.
   */
  toFlowDefinition(playbook: Playbook): FlowDefinition {
    const steps: ActionStep[] = playbook.steps.map((step) =>
      this.stepToActionStep(step),
    );

    return {
      name: playbook.name,
      description: playbook.description,
      steps,
    };
  }

  /**
   * Convert a playbook to ActionStep[] for batch execution.
   */
  toActionSteps(playbook: Playbook): ActionStep[] {
    return playbook.steps.map((step) => this.stepToActionStep(step));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private buildCriteria(action: RecordedAction): ElementCriteria {
    const criteria: ElementCriteria = {};

    // Use element ID as the primary identifier
    if (action.elementId) {
      criteria.id = action.elementId;
    }

    // Use label for accessibility-based matching
    if (action.elementLabel) {
      criteria.ariaLabel = action.elementLabel;
    }

    // Use fingerprint role if available
    if (action.elementFingerprint?.role) {
      criteria.role = action.elementFingerprint.role;
    }

    return criteria;
  }

  private stepToActionStep(step: PlaybookStep): ActionStep {
    const actionStep: ActionStep = {
      target: { ...step.target },
      action: step.action as ActionType,
      params: step.params,
    };

    if (step.waitAfterMs) {
      actionStep.waitAfter = {
        type: "time",
        ms: step.waitAfterMs,
      };
    }

    return actionStep;
  }
}
