/**
 * Execution progress tracker.
 *
 * Records node starts, completions, failures, and phase transitions.
 * Provides event subscription for real-time monitoring.
 */

import type { NodeResult } from './success-criteria';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Current phase of the overall execution. */
export type ExecutionPhase =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** An event emitted by the tracker. */
export interface TrackerEvent {
  type:
    | 'node:start'
    | 'node:complete'
    | 'node:fail'
    | 'execution:start'
    | 'execution:complete'
    | 'execution:pause'
    | 'execution:resume'
    | 'execution:cancel';
  nodeId?: string;
  timestamp: number;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// ExecutionTracker
// ---------------------------------------------------------------------------

export class ExecutionTracker {
  private _phase: ExecutionPhase = 'pending';
  private _startedAt: number | null = null;
  private _endedAt: number | null = null;
  private results = new Map<string, NodeResult>();
  private nodeStartTimes = new Map<string, number>();
  private events: TrackerEvent[] = [];
  private listeners: Set<(event: TrackerEvent) => void> = new Set();

  // -------------------------------------------------------------------------
  // Node lifecycle
  // -------------------------------------------------------------------------

  /** Record node execution start. */
  startNode(nodeId: string): void {
    const now = Date.now();
    this.nodeStartTimes.set(nodeId, now);
    this.emit({ type: 'node:start', nodeId, timestamp: now });
  }

  /** Record node completion with its result. */
  completeNode(nodeId: string, result: NodeResult): void {
    const now = Date.now();
    this.results.set(nodeId, result);
    this.nodeStartTimes.delete(nodeId);
    this.emit({ type: 'node:complete', nodeId, timestamp: now, data: result });
  }

  /** Record node failure. */
  failNode(nodeId: string, error: string): void {
    const now = Date.now();
    const startTime = this.nodeStartTimes.get(nodeId) ?? now;
    const result: NodeResult = {
      nodeId,
      success: false,
      durationMs: now - startTime,
      error,
    };
    this.results.set(nodeId, result);
    this.nodeStartTimes.delete(nodeId);
    this.emit({ type: 'node:fail', nodeId, timestamp: now, data: { error } });
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /** Get all node results. */
  getResults(): NodeResult[] {
    return Array.from(this.results.values());
  }

  /** Get result for a specific node. */
  getNodeResult(nodeId: string): NodeResult | undefined {
    return this.results.get(nodeId);
  }

  // -------------------------------------------------------------------------
  // Phase management
  // -------------------------------------------------------------------------

  /** Get execution phase. */
  get phase(): ExecutionPhase {
    return this._phase;
  }

  /** Set execution phase and emit an appropriate event. */
  setPhase(phase: ExecutionPhase): void {
    const now = Date.now();
    this._phase = phase;

    if (phase === 'running' && this._startedAt === null) {
      this._startedAt = now;
      this.emit({ type: 'execution:start', timestamp: now });
    } else if (phase === 'completed' || phase === 'failed') {
      this._endedAt = now;
      this.emit({ type: 'execution:complete', timestamp: now });
    } else if (phase === 'paused') {
      this.emit({ type: 'execution:pause', timestamp: now });
    } else if (phase === 'cancelled') {
      this._endedAt = now;
      this.emit({ type: 'execution:cancel', timestamp: now });
    }
  }

  // -------------------------------------------------------------------------
  // Timing
  // -------------------------------------------------------------------------

  /** Get total execution time so far (ms). */
  get elapsedMs(): number {
    if (this._startedAt === null) return 0;
    const end = this._endedAt ?? Date.now();
    return end - this._startedAt;
  }

  /**
   * Get progress as a ratio (completed nodes / total nodes).
   * @param totalNodes - Total number of nodes in the workflow.
   */
  progress(totalNodes: number): number {
    if (totalNodes <= 0) return 0;
    return this.results.size / totalNodes;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  /**
   * Subscribe to tracker events.
   * @returns Unsubscribe function.
   */
  onEvent(listener: (event: TrackerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Get all events (for debugging). */
  getEvents(): TrackerEvent[] {
    return [...this.events];
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private emit(event: TrackerEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
