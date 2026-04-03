import { describe, it, expect } from 'vitest';
import { ConnectionRouter } from '../../execution/connection-router';
import type { Connection } from '../../execution/connection-router';
import { VariableContext } from '../../execution/variable-context';

const router = new ConnectionRouter();

function conn(
  id: string,
  from: string,
  to: string,
  condition?: Connection['condition'],
  priority?: number,
): Connection {
  return { id, fromNodeId: from, toNodeId: to, condition, priority };
}

describe('ConnectionRouter', () => {
  it('routes on success condition', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }),
      conn('c2', 'A', 'C', { type: 'failure' }),
    ];
    const result = router.route('A', connections, { success: true });
    expect(result?.nextNodeId).toBe('B');
    expect(result?.connectionId).toBe('c1');
  });

  it('routes on failure condition', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }),
      conn('c2', 'A', 'C', { type: 'failure' }),
    ];
    const result = router.route('A', connections, { success: false });
    expect(result?.nextNodeId).toBe('C');
  });

  it('routes on value match', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'value', field: 'status', operator: '==', expected: 'ok' }),
      conn('c2', 'A', 'C', { type: 'default' }),
    ];
    const result = router.route('A', connections, { success: true, values: { status: 'ok' } });
    expect(result?.nextNodeId).toBe('B');
  });

  it('routes on expression', () => {
    const vars = new VariableContext({ count: 5 });
    const connections = [
      conn('c1', 'A', 'B', { type: 'expression', expression: 'count > 3' }),
    ];
    const result = router.route('A', connections, { success: true }, vars);
    expect(result?.nextNodeId).toBe('B');
  });

  it('default connection when no condition matches', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }),
      conn('c2', 'A', 'C', { type: 'default' }),
    ];
    const result = router.route('A', connections, { success: false });
    expect(result?.nextNodeId).toBe('C');
    expect(result?.reason).toBe('default connection');
  });

  it('priority ordering', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }, 0),
      conn('c2', 'A', 'C', { type: 'success' }, 10),
    ];
    const result = router.route('A', connections, { success: true });
    expect(result?.nextNodeId).toBe('C'); // Higher priority checked first
  });

  it('returns null when no connection matches', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }),
    ];
    const result = router.route('A', connections, { success: false });
    expect(result).toBeNull();
  });

  it('returns null when no connections from node', () => {
    const result = router.route('A', [], { success: true });
    expect(result).toBeNull();
  });

  it('takes unconditional connection as fallback', () => {
    const connections = [
      conn('c1', 'A', 'B', { type: 'success' }),
      conn('c2', 'A', 'C'), // no condition
    ];
    const result = router.route('A', connections, { success: false });
    expect(result?.nextNodeId).toBe('C');
    expect(result?.reason).toBe('unconditional connection');
  });
});
