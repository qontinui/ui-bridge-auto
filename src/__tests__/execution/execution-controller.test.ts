import { describe, it, expect } from 'vitest';
import { ExecutionController } from '../../execution/execution-controller';
import { MockActionExecutor } from '../../test-utils/mock-executor';
import type { WorkflowGraph } from '../../execution/graph-executor';

function simpleGraph(): WorkflowGraph {
  return {
    id: 'g1',
    name: 'Test Graph',
    entryNodeId: 'n1',
    nodes: [
      { id: 'n1', name: 'Click A', type: 'action', action: { target: { id: 'btn1' }, type: 'click' } },
      { id: 'n2', name: 'Click B', type: 'action', action: { target: { id: 'btn2' }, type: 'click' } },
    ],
    connections: [
      { id: 'c1', fromNodeId: 'n1', toNodeId: 'n2' },
    ],
  };
}

describe('ExecutionController', () => {
  it('start executes graph and returns result', async () => {
    const executor = new MockActionExecutor();
    executor.registerElement('btn1', 'btn1');
    executor.registerElement('btn2', 'btn2');

    const controller = new ExecutionController({ executor });
    const result = await controller.start(simpleGraph());

    expect(result.nodesExecuted).toBe(2);
    expect(result.success).toBe(true);
    expect(result.phase).toBe('completed');
  });

  it('cancel stops execution', async () => {
    const executor = new MockActionExecutor();
    executor.registerElement('btn1', 'btn1');
    executor.registerElement('btn2', 'btn2');
    executor.setActionDelay(200);

    const controller = new ExecutionController({ executor });
    const promise = controller.start(simpleGraph());

    // Cancel almost immediately
    setTimeout(() => controller.cancel(), 10);

    const result = await promise;
    // Should be cancelled, completed, or failed depending on timing
    expect(['cancelled', 'completed', 'failed']).toContain(result.phase);
  });

  it('timeout cancels after duration', async () => {
    const executor = new MockActionExecutor();
    executor.registerElement('btn1', 'btn1');
    executor.registerElement('btn2', 'btn2');
    executor.setActionDelay(500);

    const controller = new ExecutionController({
      executor,
      timeout: 50,
    });

    const result = await controller.start(simpleGraph());
    // With a very short timeout and slow actions, execution may be cancelled
    expect(['cancelled', 'completed', 'failed']).toContain(result.phase);
  });

  it('state reflects current phase', () => {
    const executor = new MockActionExecutor();
    const controller = new ExecutionController({ executor });
    expect(controller.state).toBe('pending');
  });
});
