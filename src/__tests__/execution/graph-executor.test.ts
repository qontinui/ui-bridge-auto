import { describe, it, expect, beforeEach } from 'vitest';
import { GraphExecutor } from '../../execution/graph-executor';
import type { WorkflowGraph, WorkflowNode } from '../../execution/graph-executor';
import type { Connection } from '../../execution/connection-router';
import { MockActionExecutor } from '../../test-utils/mock-executor';
import { MockRegistry } from '../../test-utils/mock-registry';
import { createButton, createInput, resetIdCounter } from '../../test-utils/mock-elements';

let executor: MockActionExecutor;
let registry: MockRegistry;
let graphExecutor: GraphExecutor;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = '';
  executor = new MockActionExecutor();
  registry = new MockRegistry();
  graphExecutor = new GraphExecutor(executor, registry);
});

function linearGraph(nodes: WorkflowNode[], connections: Connection[]): WorkflowGraph {
  return {
    id: 'test',
    name: 'Test',
    nodes,
    connections,
    entryNodeId: nodes[0].id,
  };
}

describe('GraphExecutor', () => {
  it('executes simple linear graph (A -> B -> C)', async () => {
    executor.registerElement('*', 'el1');

    const graph = linearGraph(
      [
        { id: 'a', name: 'A', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
        { id: 'b', name: 'B', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
        { id: 'c', name: 'C', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
      ],
      [
        { id: 'c1', fromNodeId: 'a', toNodeId: 'b' },
        { id: 'c2', fromNodeId: 'b', toNodeId: 'c' },
      ],
    );

    const result = await graphExecutor.execute(graph);

    expect(result.success).toBe(true);
    expect(result.nodesExecuted).toBe(3);
    expect(executor.executedActions).toHaveLength(3);
  });

  it('executes conditional routing (success -> A, failure -> B)', async () => {
    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'cond',
      nodes: [
        { id: 'cond', name: 'Check', type: 'condition', condition: { expression: 'flag' } },
        { id: 'yes', name: 'Yes', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
        { id: 'no', name: 'No', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'cond', toNodeId: 'yes', condition: { type: 'success' } },
        { id: 'c2', fromNodeId: 'cond', toNodeId: 'no', condition: { type: 'failure' } },
      ],
    };

    executor.registerElement('*', 'el1');

    // flag = true -> condition succeeds -> routes to 'yes'
    const result = await graphExecutor.execute(graph, { variables: { flag: true } });
    expect(result.nodesExecuted).toBe(2);
    expect(result.results.find((r) => r.nodeId === 'yes')).toBeDefined();
    expect(result.results.find((r) => r.nodeId === 'no')).toBeUndefined();
  });

  it('extract node stores variable', async () => {
    const btn = createButton('Submit');
    registry.addElement(btn);

    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'ext',
      nodes: [
        {
          id: 'ext',
          name: 'Extract',
          type: 'extract',
          extract: { target: { id: btn.id }, property: 'label', variable: 'btnLabel' },
        },
      ],
      connections: [],
    };

    const result = await graphExecutor.execute(graph);
    expect(result.success).toBe(true);
    expect(result.variables.btnLabel).toBe('Submit');
  });

  it('assert node passes when value matches', async () => {
    const input = createInput('Name');
    registry.addElement(input);

    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'assert',
      nodes: [
        {
          id: 'assert',
          name: 'Assert',
          type: 'assert',
          assert: { target: { id: input.id }, property: 'type', expected: 'input' },
        },
      ],
      connections: [],
    };

    const result = await graphExecutor.execute(graph);
    expect(result.success).toBe(true);
  });

  it('assert node fails when value does not match', async () => {
    const input = createInput('Name');
    registry.addElement(input);

    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'assert',
      nodes: [
        {
          id: 'assert',
          name: 'Assert',
          type: 'assert',
          assert: { target: { id: input.id }, property: 'type', expected: 'button' },
        },
      ],
      connections: [],
    };

    const result = await graphExecutor.execute(graph);
    expect(result.success).toBe(false);
  });

  it('wait node (time-based)', async () => {
    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'w',
      nodes: [
        { id: 'w', name: 'Wait', type: 'wait', wait: { type: 'time', ms: 10 } },
      ],
      connections: [],
    };

    const result = await graphExecutor.execute(graph);
    expect(result.success).toBe(true);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(5);
  });

  it('subgraph execution', async () => {
    executor.registerElement('*', 'el1');

    const sub: WorkflowGraph = {
      id: 'sub',
      name: 'Sub',
      entryNodeId: 's1',
      nodes: [
        { id: 's1', name: 'SubAction', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
      ],
      connections: [],
    };

    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'sg',
      nodes: [
        { id: 'sg', name: 'Subgraph', type: 'subgraph', subgraph: sub },
      ],
      connections: [],
    };

    const result = await graphExecutor.execute(graph);
    expect(result.success).toBe(true);
    expect(executor.executedActions).toHaveLength(1);
  });

  it('handles cycle detection (max visits)', async () => {
    executor.registerElement('*', 'el1');

    const graph: WorkflowGraph = {
      id: 'test',
      name: 'Test',
      entryNodeId: 'a',
      nodes: [
        { id: 'a', name: 'A', type: 'action', action: { target: { id: 'el1' }, type: 'click' } },
      ],
      connections: [
        { id: 'c1', fromNodeId: 'a', toNodeId: 'a' }, // self-loop
      ],
    };

    const result = await graphExecutor.execute(graph);
    // Should eventually stop due to cycle detection.
    // Since the tracker uses a Map keyed by nodeId, repeated visits to the
    // same node overwrite — so nodesExecuted is 1 (the single node 'a').
    // The key assertion is that the execution terminates and the final
    // result for node 'a' is a failure due to max visits.
    expect(result.nodesExecuted).toBe(1);
    expect(result.success).toBe(false);
  });
});
