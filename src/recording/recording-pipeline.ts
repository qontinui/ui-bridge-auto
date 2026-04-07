/**
 * Process a recording session into state machine definitions.
 *
 * Converts recorded snapshots and actions into StateDefinition and
 * TransitionDefinition objects suitable for feeding into a StateMachine.
 * Uses StateDiscovery internally for clustering and transition detection.
 */

import type { QueryableElement } from "../core/element-query";
import type {
  StateDefinition,
  TransitionDefinition,
} from "../state/state-machine";
import { StateDiscovery } from "../state/state-discovery";
import type { ActionType } from "../types/transition";
import type {
  RecordedAction,
  RecordedSnapshot,
  RecordingSession,
} from "./session-recorder";

// ---------------------------------------------------------------------------
// RecordingPipeline
// ---------------------------------------------------------------------------

/**
 * Converts a recording session into state and transition definitions.
 *
 * Walks through recorded events, feeding snapshots and actions into
 * a StateDiscovery instance, then runs discovery to produce definitions.
 */
export class RecordingPipeline {
  /**
   * Analyze a recording session and produce state/transition definitions.
   *
   * Snapshot events are converted to element groups for co-occurrence
   * analysis. Action events are recorded for transition detection.
   * The StateDiscovery engine then clusters elements into states and
   * correlates actions with state changes.
   */
  process(session: RecordingSession): {
    states: StateDefinition[];
    transitions: TransitionDefinition[];
  } {
    // Use relaxed config so recorded data can produce states with fewer
    // observations (recordings are typically short).
    const discovery = new StateDiscovery({
      minObservations: 1,
      mergeThreshold: 0.8,
      ignoreTransient: false,
    });

    for (const event of session.events) {
      if (event.type === "snapshot") {
        const snap = event.data as RecordedSnapshot;
        // Convert snapshot element IDs into minimal QueryableElement stubs
        // so StateDiscovery can record them.
        const elements = this.snapshotToElements(snap);
        discovery.recordSnapshot(elements);
      } else if (event.type === "action") {
        const action = event.data as RecordedAction;
        discovery.recordAction({
          type: action.actionType as ActionType,
          elementId: action.elementId,
        });
      }
    }

    // Run discovery
    discovery.discover();

    return {
      states: discovery.toStateDefinitions(),
      transitions: discovery.toTransitionDefinitions(),
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Convert a RecordedSnapshot into minimal QueryableElement stubs.
   *
   * StateDiscovery.recordSnapshot needs QueryableElement objects with at
   * least an `id` and an `element` (HTMLElement). We create minimal DOM
   * elements to satisfy this.
   */
  private snapshotToElements(snap: RecordedSnapshot): QueryableElement[] {
    return snap.elementIds.map((id) => {
      const el = document.createElement("div");
      el.setAttribute("data-snapshot-id", id);
      return {
        id,
        element: el,
        type: "generic",
        getState: () => ({
          visible: true,
          enabled: true,
          focused: false,
          checked: undefined,
          textContent: "",
          value: undefined,
          rect: { x: 0, y: 0, width: 0, height: 0 },
          computedStyles: {},
        }),
      };
    });
  }
}
