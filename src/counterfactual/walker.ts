/**
 * Pure causal-chain walker. No I/O, no mutation of input.
 *
 * Builds lookup tables over a `RecordingSession` and exposes deterministic
 * forward / backward closures over the `causedBy` graph. All output arrays
 * are sorted by (timestamp, eventId) so consumers can rely on stable order
 * without re-sorting.
 */

import type {
  RecordedEvent,
  RecordedEventId,
  RecordingSession,
} from "../recording/session-recorder";

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/** Lookup tables over the causal graph of a recorded session. */
export interface CausalIndex {
  /** Event id → event. */
  byId: Map<RecordedEventId, RecordedEvent>;
  /**
   * Parent id → child events (sorted by (timestamp, eventId)).
   * Children of "no cause" (root events) are not indexed here.
   */
  childrenOf: Map<RecordedEventId, RecordedEventId[]>;
  /** Root events (causedBy null/undefined), sorted by (timestamp, eventId). */
  rootEvents: RecordedEvent[];
}

/** Total event ordering key used everywhere in this module. */
function compareEvents(a: RecordedEvent, b: RecordedEvent): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Compare event ids using their backing event for ordering. */
function compareIds(
  byId: Map<RecordedEventId, RecordedEvent>,
  a: RecordedEventId,
  b: RecordedEventId,
): number {
  const ea = byId.get(a);
  const eb = byId.get(b);
  if (ea && eb) return compareEvents(ea, eb);
  // Fallback to lex comparison when an id is missing (defensive).
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Build forward + reverse adjacency lookups from a session. */
export function buildCausalIndex(session: RecordingSession): CausalIndex {
  const byId = new Map<RecordedEventId, RecordedEvent>();
  const childrenOf = new Map<RecordedEventId, RecordedEventId[]>();
  const rootEvents: RecordedEvent[] = [];

  for (const event of session.events) {
    byId.set(event.id, event);
  }

  for (const event of session.events) {
    const cause = event.causedBy;
    if (cause === null || cause === undefined) {
      rootEvents.push(event);
      continue;
    }
    const list = childrenOf.get(cause);
    if (list) {
      list.push(event.id);
    } else {
      childrenOf.set(cause, [event.id]);
    }
  }

  // Deterministic ordering for any escaping array.
  for (const [parent, children] of childrenOf) {
    children.sort((a, b) => compareIds(byId, a, b));
    childrenOf.set(parent, children);
  }
  rootEvents.sort(compareEvents);

  return { byId, childrenOf, rootEvents };
}

// ---------------------------------------------------------------------------
// Closures
// ---------------------------------------------------------------------------

/**
 * Every event reachable forward from `startEventId` via `causedBy` edges.
 * BFS, frontier sorted at each level. Excludes `startEventId` itself.
 */
export function forwardClosure(
  session: RecordingSession,
  startEventId: RecordedEventId,
): RecordedEvent[] {
  const { byId, childrenOf } = buildCausalIndex(session);
  if (!byId.has(startEventId)) return [];

  const seen = new Set<RecordedEventId>([startEventId]);
  const collected: RecordedEvent[] = [];
  let frontier: RecordedEventId[] = [startEventId];

  while (frontier.length > 0) {
    const next: RecordedEventId[] = [];
    for (const id of frontier) {
      const children = childrenOf.get(id);
      if (!children) continue;
      for (const childId of children) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        const childEvent = byId.get(childId);
        if (childEvent) {
          collected.push(childEvent);
          next.push(childId);
        }
      }
    }
    next.sort((a, b) => compareIds(byId, a, b));
    frontier = next;
  }

  collected.sort(compareEvents);
  return collected;
}

/**
 * Every causal ancestor of `startEventId`. Walk stops at trace boundaries
 * (events whose `causedBy` is null/undefined or unresolved). Excludes
 * `startEventId` itself.
 */
export function backwardClosure(
  session: RecordingSession,
  startEventId: RecordedEventId,
): RecordedEvent[] {
  const { byId } = buildCausalIndex(session);
  if (!byId.has(startEventId)) return [];

  const seen = new Set<RecordedEventId>([startEventId]);
  const collected: RecordedEvent[] = [];
  let frontier: RecordedEventId[] = [startEventId];

  while (frontier.length > 0) {
    const next: RecordedEventId[] = [];
    for (const id of frontier) {
      const event = byId.get(id);
      if (!event) continue;
      const parentId = event.causedBy;
      if (parentId === null || parentId === undefined) continue;
      if (seen.has(parentId)) continue;
      const parentEvent = byId.get(parentId);
      if (!parentEvent) continue; // dangling causedBy: stop, do not throw
      seen.add(parentId);
      collected.push(parentEvent);
      next.push(parentId);
    }
    next.sort((a, b) => compareIds(byId, a, b));
    frontier = next;
  }

  collected.sort(compareEvents);
  return collected;
}
