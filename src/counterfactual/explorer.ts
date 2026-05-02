/**
 * Counterfactual / model-checking entry point.
 *
 * Given a recorded session and a perturbation, projects what the trace
 * WOULD look like if that mutation had occurred — without re-executing.
 * Returns divergences, fragility scores, and a reachability summary.
 */

import type {
  RecordedEvent,
  RecordedEventId,
  RecordedPredicateEval,
  RecordedStateChange,
  RecordingSession,
} from "../recording/session-recorder";
import type {
  CounterfactualDivergence,
  CounterfactualReport,
  FragilityScore,
  Perturbation,
} from "./types";
import { forwardClosure } from "./walker";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when a perturbation references a missing or wrong-typed event. */
export class CounterfactualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CounterfactualError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findEventOrThrow(
  session: RecordingSession,
  targetEventId: RecordedEventId,
  expectedType: RecordedEvent["type"],
  perturbationKind: Perturbation["kind"],
): { event: RecordedEvent; index: number } {
  for (let i = 0; i < session.events.length; i++) {
    const e = session.events[i];
    if (e.id === targetEventId) {
      if (e.type !== expectedType) {
        throw new CounterfactualError(
          `Perturbation '${perturbationKind}' targets event ${targetEventId} ` +
            `of type '${e.type}', expected '${expectedType}'.`,
        );
      }
      return { event: e, index: i };
    }
  }
  throw new CounterfactualError(
    `Perturbation '${perturbationKind}' targets event ${targetEventId}, ` +
      `which does not exist in the session.`,
  );
}

function indexOf(session: RecordingSession, id: RecordedEventId): number {
  for (let i = 0; i < session.events.length; i++) {
    if (session.events[i].id === id) return i;
  }
  return -1;
}

function projectExpected(event: RecordedEvent): {
  id: RecordedEventId;
  type: RecordedEvent["type"];
  causedBy: RecordedEventId | null | undefined;
} {
  return { id: event.id, type: event.type, causedBy: event.causedBy };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Project the effect of a perturbation on a recorded trace.
 *
 * Divergence kind mapping:
 *   - flip-predicate-eval → "predicateOutcomeMismatch" for each downstream
 *     event (its existence is conditional on the predicate's outcome).
 *   - fail-action → "missing" for each downstream event (a failed action
 *     would have errored, so its causal descendants would never be recorded).
 */
export function exploreCounterfactual(
  session: RecordingSession,
  perturbation: Perturbation,
): CounterfactualReport {
  const traceSize = session.events.length;

  let unreachable: RecordedEvent[];
  let divergenceKind: CounterfactualDivergence["kind"];
  let messagePrefix: string;

  switch (perturbation.kind) {
    case "flip-predicate-eval": {
      findEventOrThrow(
        session,
        perturbation.targetEventId,
        "predicateEval",
        perturbation.kind,
      );
      unreachable = forwardClosure(session, perturbation.targetEventId);
      divergenceKind = "predicateOutcomeMismatch";
      messagePrefix = `Flipping predicate ${perturbation.targetEventId} would invalidate descendant`;
      break;
    }
    case "fail-action": {
      findEventOrThrow(
        session,
        perturbation.targetEventId,
        "action",
        perturbation.kind,
      );
      unreachable = forwardClosure(session, perturbation.targetEventId);
      divergenceKind = "missing";
      messagePrefix = `Failing action ${perturbation.targetEventId} would prevent descendant`;
      break;
    }
  }

  // Build divergences (one per unreachable event).
  const divergences: CounterfactualDivergence[] = unreachable.map((e) => ({
    eventIndex: indexOf(session, e.id),
    kind: divergenceKind,
    expected: projectExpected(e),
    actual: null,
    message: `${messagePrefix} event ${e.id} (type=${e.type}).`,
    synthetic: true,
  }));
  divergences.sort((a, b) => {
    if (a.eventIndex !== b.eventIndex) return a.eventIndex - b.eventIndex;
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    return 0;
  });

  // Fragility scores: one per predicateEval in the entire trace.
  const fragilityScores: FragilityScore[] = [];
  for (const e of session.events) {
    if (e.type !== "predicateEval") continue;
    const data = e.data as RecordedPredicateEval;
    const fwdSize = forwardClosure(session, e.id).length;
    fragilityScores.push({
      eventId: e.id,
      predicateId: data.predicateId,
      forwardClosureSize: fwdSize,
      traceSize,
      score: traceSize === 0 ? 0 : fwdSize / traceSize,
    });
  }
  fragilityScores.sort((a, b) => {
    if (a.eventId < b.eventId) return -1;
    if (a.eventId > b.eventId) return 1;
    return 0;
  });

  // Unreachable event ids — sorted lex.
  const unreachableSet = new Set<RecordedEventId>(unreachable.map((e) => e.id));
  const unreachableEventIds: RecordedEventId[] = [...unreachableSet].sort();

  // Dead transitions: state ids entered by any unreachable stateChange event.
  const deadStateSet = new Set<string>();
  for (const e of unreachable) {
    if (e.type !== "stateChange") continue;
    const data = e.data as RecordedStateChange;
    for (const stateId of data.entered) {
      deadStateSet.add(stateId);
    }
  }
  const deadTransitionStateIds: string[] = [...deadStateSet].sort();

  // Irrelevant predicates: any predicateEval whose forward closure is fully
  // contained in the unreachable set (i.e. nothing it predicts matters once
  // the perturbation lands).
  const irrelevantSet = new Set<string>();
  for (const e of session.events) {
    if (e.type !== "predicateEval") continue;
    const closure = forwardClosure(session, e.id);
    if (closure.length === 0) continue;
    let allDead = true;
    for (const desc of closure) {
      if (!unreachableSet.has(desc.id)) {
        allDead = false;
        break;
      }
    }
    if (allDead) {
      const data = e.data as RecordedPredicateEval;
      irrelevantSet.add(data.predicateId);
    }
  }
  const irrelevantPredicateIds: string[] = [...irrelevantSet].sort();

  return {
    perturbation,
    divergences,
    fragilityScores,
    unreachableEventIds,
    deadTransitionStateIds,
    irrelevantPredicateIds,
  };
}
