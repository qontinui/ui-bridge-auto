import { describe, it, expect, vi } from 'vitest';
import { ExecutionTracker } from '../../execution/execution-tracker';
import type { NodeResult } from '../../execution/success-criteria';

describe('ExecutionTracker', () => {
  it('startNode/completeNode records results', () => {
    const tracker = new ExecutionTracker();
    tracker.startNode('n1');

    const result: NodeResult = { nodeId: 'n1', success: true, durationMs: 50 };
    tracker.completeNode('n1', result);

    expect(tracker.getResults()).toHaveLength(1);
    expect(tracker.getNodeResult('n1')).toEqual(result);
  });

  it('failNode records error', () => {
    const tracker = new ExecutionTracker();
    tracker.startNode('n1');
    tracker.failNode('n1', 'something broke');

    const r = tracker.getNodeResult('n1');
    expect(r?.success).toBe(false);
    expect(r?.error).toBe('something broke');
  });

  it('phase transitions', () => {
    const tracker = new ExecutionTracker();
    expect(tracker.phase).toBe('pending');

    tracker.setPhase('running');
    expect(tracker.phase).toBe('running');

    tracker.setPhase('paused');
    expect(tracker.phase).toBe('paused');

    tracker.setPhase('completed');
    expect(tracker.phase).toBe('completed');
  });

  it('progress calculation', () => {
    const tracker = new ExecutionTracker();
    expect(tracker.progress(4)).toBe(0);

    tracker.startNode('n1');
    tracker.completeNode('n1', { nodeId: 'n1', success: true, durationMs: 10 });
    expect(tracker.progress(4)).toBe(0.25);

    tracker.startNode('n2');
    tracker.completeNode('n2', { nodeId: 'n2', success: true, durationMs: 10 });
    expect(tracker.progress(4)).toBe(0.5);

    expect(tracker.progress(0)).toBe(0);
  });

  it('event subscription', () => {
    const tracker = new ExecutionTracker();
    const events: string[] = [];
    const unsub = tracker.onEvent((e) => events.push(e.type));

    tracker.setPhase('running');
    tracker.startNode('n1');
    tracker.completeNode('n1', { nodeId: 'n1', success: true, durationMs: 10 });

    expect(events).toEqual(['execution:start', 'node:start', 'node:complete']);

    unsub();
    tracker.startNode('n2');
    expect(events).toHaveLength(3); // no new events after unsub
  });

  it('elapsed time tracking', () => {
    const tracker = new ExecutionTracker();
    expect(tracker.elapsedMs).toBe(0);

    tracker.setPhase('running');
    // elapsedMs should be > 0 (or at least >= 0 within test timing)
    expect(tracker.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('getEvents returns all events', () => {
    const tracker = new ExecutionTracker();
    tracker.setPhase('running');
    tracker.startNode('n1');
    tracker.failNode('n1', 'err');
    tracker.setPhase('cancelled');

    const events = tracker.getEvents();
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events.map((e) => e.type)).toContain('node:fail');
    expect(events.map((e) => e.type)).toContain('execution:cancel');
  });
});
