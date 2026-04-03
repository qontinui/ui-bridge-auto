import { describe, it, expect } from 'vitest';
import {
  evaluateCriteria,
  allMustPass,
  anyMustPass,
  percentageMustPass,
} from '../../execution/success-criteria';
import type { NodeResult } from '../../execution/success-criteria';

function result(nodeId: string, success: boolean): NodeResult {
  return { nodeId, success, durationMs: 100 };
}

describe('evaluateCriteria', () => {
  it('allMustPass: passes when all succeed', () => {
    const r = evaluateCriteria(allMustPass(), [result('a', true), result('b', true)]);
    expect(r.passed).toBe(true);
  });

  it('allMustPass: fails if any node failed', () => {
    const r = evaluateCriteria(allMustPass(), [result('a', true), result('b', false)]);
    expect(r.passed).toBe(false);
    expect(r.summary).toContain('1 of 2');
  });

  it('anyMustPass: passes if at least one succeeded', () => {
    const r = evaluateCriteria(anyMustPass(), [result('a', false), result('b', true)]);
    expect(r.passed).toBe(true);
  });

  it('anyMustPass: fails if none passed', () => {
    const r = evaluateCriteria(anyMustPass(), [result('a', false), result('b', false)]);
    expect(r.passed).toBe(false);
  });

  it('percentageMustPass: passes at threshold', () => {
    const criteria = percentageMustPass(0.5);
    const r = evaluateCriteria(criteria, [result('a', true), result('b', false)]);
    expect(r.passed).toBe(true);
  });

  it('percentageMustPass: fails below threshold', () => {
    const criteria = percentageMustPass(0.8);
    const r = evaluateCriteria(criteria, [
      result('a', true),
      result('b', false),
      result('c', false),
    ]);
    expect(r.passed).toBe(false);
  });

  it('custom predicate', () => {
    const criteria = {
      type: 'custom' as const,
      predicate: (results: NodeResult[]) =>
        results.every((r) => r.durationMs < 200),
    };
    const r = evaluateCriteria(criteria, [result('a', true), result('b', false)]);
    expect(r.passed).toBe(true);
  });

  it('empty results pass', () => {
    const r = evaluateCriteria(allMustPass(), []);
    expect(r.passed).toBe(true);
  });
});
