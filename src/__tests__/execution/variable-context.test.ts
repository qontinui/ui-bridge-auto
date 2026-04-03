import { describe, it, expect } from 'vitest';
import { VariableContext } from '../../execution/variable-context';

describe('VariableContext', () => {
  it('get/set variables', () => {
    const ctx = new VariableContext({ name: 'Alice' });
    expect(ctx.get('name')).toBe('Alice');
    ctx.set('age', 30);
    expect(ctx.get('age')).toBe(30);
    expect(ctx.get('missing')).toBeUndefined();
  });

  it('getPath with dotted paths', () => {
    const ctx = new VariableContext({
      user: { name: 'Bob', address: { city: 'NYC' } },
    });
    expect(ctx.getPath('user.name')).toBe('Bob');
    expect(ctx.getPath('user.address.city')).toBe('NYC');
    expect(ctx.getPath('user.missing')).toBeUndefined();
    expect(ctx.getPath('nonexistent.path')).toBeUndefined();
  });

  it('pushScope/popScope scoping', () => {
    const ctx = new VariableContext({ x: 1 });
    expect(ctx.depth).toBe(1);

    ctx.pushScope({ y: 2 });
    expect(ctx.depth).toBe(2);
    expect(ctx.get('x')).toBe(1); // visible from outer
    expect(ctx.get('y')).toBe(2);

    ctx.popScope();
    expect(ctx.depth).toBe(1);
    expect(ctx.get('y')).toBeUndefined(); // no longer visible
  });

  it('throws when popping root scope', () => {
    const ctx = new VariableContext();
    expect(() => ctx.popScope()).toThrow('Cannot pop the root variable scope');
  });

  it('interpolate replaces {{vars}}', () => {
    const ctx = new VariableContext({ name: 'World', count: 42 });
    expect(ctx.interpolate('Hello, {{name}}!')).toBe('Hello, World!');
    expect(ctx.interpolate('Count: {{count}}')).toBe('Count: 42');
    expect(ctx.interpolate('{{missing}}')).toBe('{{missing}}');
  });

  it('evaluate conditions', () => {
    const ctx = new VariableContext({ x: 10, name: 'test', flag: true });
    expect(ctx.evaluate('x > 5')).toBe(true);
    expect(ctx.evaluate('x == 10')).toBe(true);
    expect(ctx.evaluate('x != 10')).toBe(false);
    expect(ctx.evaluate('name contains es')).toBe(true);
    expect(ctx.evaluate('flag')).toBe(true);
    expect(ctx.evaluate('missing')).toBe(false);
  });

  it('innermost scope wins on conflict', () => {
    const ctx = new VariableContext({ x: 'outer' });
    ctx.pushScope({ x: 'inner' });
    expect(ctx.get('x')).toBe('inner');

    ctx.popScope();
    expect(ctx.get('x')).toBe('outer');
  });

  it('toRecord merges all scopes (inner wins)', () => {
    const ctx = new VariableContext({ a: 1, b: 2 });
    ctx.pushScope({ b: 20, c: 30 });
    const rec = ctx.toRecord();
    expect(rec).toEqual({ a: 1, b: 20, c: 30 });
  });
});
