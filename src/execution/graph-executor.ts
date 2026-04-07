/**
 * Execute workflow graphs — the core engine.
 *
 * Walks a directed graph of workflow nodes, executing each node's action,
 * routing to the next via ConnectionRouter, and collecting results.
 */

import type { ElementQuery, QueryableElement } from '../core/element-query';
import { findFirst } from '../core/element-query';
import { extractValue } from '../actions/data-operations';
import { withRetry } from '../actions/retry';
import type { ActionType, WaitSpec } from '../types/transition';
import type { ActionExecutorLike } from '../state/transition-executor';
import type { Connection } from './connection-router';
import { ConnectionRouter } from './connection-router';
import { VariableContext } from './variable-context';
import type { SuccessCriteria, NodeResult } from './success-criteria';
import { evaluateCriteria, allMustPass } from './success-criteria';
import { ExecutionTracker } from './execution-tracker';
import type { ExecutionPhase } from './execution-tracker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowGraph {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: Connection[];
  entryNodeId: string;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: 'action' | 'condition' | 'extract' | 'assert' | 'subgraph' | 'wait';

  /** For 'action' nodes. */
  action?: {
    target: ElementQuery;
    type: ActionType;
    params?: Record<string, unknown>;
  };

  /** For 'condition' nodes. */
  condition?: { expression: string };

  /** For 'extract' nodes. */
  extract?: { target: ElementQuery; property: string; variable: string };

  /** For 'assert' nodes. */
  assert?: { target: ElementQuery; property: string; expected: unknown };

  /** For 'wait' nodes. */
  wait?: WaitSpec;

  /** For 'subgraph' nodes. */
  subgraph?: WorkflowGraph;

  /** Retry configuration. */
  retry?: { maxAttempts: number; delayMs: number };
}

export interface ExecutionResult {
  success: boolean;
  phase: ExecutionPhase;
  results: NodeResult[];
  variables: Record<string, unknown>;
  durationMs: number;
  nodesExecuted: number;
  summary: string;
}

// ---------------------------------------------------------------------------
// GraphExecutor
// ---------------------------------------------------------------------------

/** Maximum number of times any single node can be visited (cycle protection). */
const MAX_NODE_VISITS = 100;

export class GraphExecutor {
  private router = new ConnectionRouter();

  constructor(
    private executor: ActionExecutorLike,
    private registry: { getAllElements(): QueryableElement[] },
  ) {}

  /**
   * Execute a workflow graph starting from the entry node.
   *
   * Walks the graph node-by-node, executing each according to its type,
   * routing via connections, and collecting results. Supports timeout,
   * cancel signals, and success criteria evaluation.
   */
  async execute(
    graph: WorkflowGraph,
    options?: {
      variables?: Record<string, unknown>;
      criteria?: SuccessCriteria;
      timeout?: number;
      onNodeStart?: (nodeId: string) => void;
      onNodeComplete?: (nodeId: string, result: NodeResult) => void;
    },
  ): Promise<ExecutionResult> {
    const variables = new VariableContext(options?.variables);
    const tracker = new ExecutionTracker();
    const criteria = options?.criteria ?? allMustPass();
    const visitCounts = new Map<string, number>();
    let cancelled = false;

    // Timeout setup
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timeoutHandle = setTimeout(() => {
        cancelled = true;
        tracker.setPhase('cancelled');
      }, options.timeout);
    }

    tracker.setPhase('running');

    try {
      let currentNodeId: string | null = graph.entryNodeId;

      while (currentNodeId && !cancelled) {
        const node = graph.nodes.find((n) => n.id === currentNodeId);
        if (!node) {
          tracker.failNode(currentNodeId!, `Node "${currentNodeId}" not found in graph`);
          break;
        }

        // Cycle detection
        const visits = (visitCounts.get(node.id) ?? 0) + 1;
        visitCounts.set(node.id, visits);
        if (visits > MAX_NODE_VISITS) {
          tracker.failNode(node.id, `Node "${node.id}" exceeded max visit count (${MAX_NODE_VISITS})`);
          break;
        }

        options?.onNodeStart?.(node.id);
        tracker.startNode(node.id);

        let nodeResult: NodeResult;

        try {
          nodeResult = await this.executeNode(node, variables, graph);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          nodeResult = {
            nodeId: node.id,
            success: false,
            durationMs: 0,
            error: errorMsg,
          };
        }

        if (nodeResult.success) {
          tracker.completeNode(node.id, nodeResult);
        } else {
          tracker.failNode(node.id, nodeResult.error ?? 'Unknown error');
        }

        options?.onNodeComplete?.(node.id, nodeResult);

        // Route to next node
        const route = this.router.route(
          node.id,
          graph.connections,
          { success: nodeResult.success, values: nodeResult.values },
          variables,
        );

        currentNodeId = route?.nextNodeId ?? null;
      }

      // Evaluate criteria
      const results = tracker.getResults();
      const evaluation = evaluateCriteria(criteria, results);

      tracker.setPhase(evaluation.passed ? 'completed' : 'failed');

      return {
        success: evaluation.passed,
        phase: tracker.phase,
        results,
        variables: variables.toRecord(),
        durationMs: tracker.elapsedMs,
        nodesExecuted: results.length,
        summary: evaluation.summary,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  // -------------------------------------------------------------------------
  // Node execution
  // -------------------------------------------------------------------------

  private async executeNode(
    node: WorkflowNode,
    variables: VariableContext,
    _graph: WorkflowGraph,
  ): Promise<NodeResult> {
    const start = Date.now();

    const doExecute = async (): Promise<NodeResult> => {
      switch (node.type) {
        case 'action':
          return this.executeActionNode(node, variables, start);

        case 'condition':
          return this.executeConditionNode(node, variables, start);

        case 'extract':
          return this.executeExtractNode(node, variables, start);

        case 'assert':
          return this.executeAssertNode(node, start);

        case 'wait':
          return this.executeWaitNode(node, start);

        case 'subgraph':
          return this.executeSubgraphNode(node, variables, start);

        default:
          return {
            nodeId: node.id,
            success: false,
            durationMs: Date.now() - start,
            error: `Unknown node type: ${node.type}`,
          };
      }
    };

    if (node.retry && node.retry.maxAttempts > 1) {
      return withRetry(doExecute, {
        maxAttempts: node.retry.maxAttempts,
        initialDelayMs: node.retry.delayMs,
        maxDelayMs: node.retry.delayMs * 4,
        multiplier: 1,
      });
    }

    return doExecute();
  }

  private async executeActionNode(
    node: WorkflowNode,
    variables: VariableContext,
    start: number,
  ): Promise<NodeResult> {
    if (!node.action) {
      return { nodeId: node.id, success: false, durationMs: 0, error: 'Action node missing action config' };
    }

    // Interpolate params
    const params: Record<string, unknown> = {};
    if (node.action.params) {
      for (const [k, v] of Object.entries(node.action.params)) {
        params[k] = typeof v === 'string' ? variables.interpolate(v) : v;
      }
    }

    const found = this.executor.findElement(node.action.target);
    if (!found) {
      return {
        nodeId: node.id,
        success: false,
        durationMs: Date.now() - start,
        error: `No element found for query: ${JSON.stringify(node.action.target)}`,
      };
    }

    await this.executor.executeAction(found.id, node.action.type, params);
    await this.executor.waitForIdle();

    return {
      nodeId: node.id,
      success: true,
      durationMs: Date.now() - start,
    };
  }

  private executeConditionNode(
    node: WorkflowNode,
    variables: VariableContext,
    start: number,
  ): Promise<NodeResult> {
    if (!node.condition) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: 0,
        error: 'Condition node missing condition config',
      });
    }

    const result = variables.evaluate(node.condition.expression);
    return Promise.resolve({
      nodeId: node.id,
      success: result,
      durationMs: Date.now() - start,
      values: { conditionResult: result },
    });
  }

  private executeExtractNode(
    node: WorkflowNode,
    variables: VariableContext,
    start: number,
  ): Promise<NodeResult> {
    if (!node.extract) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: 0,
        error: 'Extract node missing extract config',
      });
    }

    const elements = this.registry.getAllElements();
    const match = findFirst(elements, node.extract.target);
    if (!match) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: Date.now() - start,
        error: `No element found for extract query: ${JSON.stringify(node.extract.target)}`,
      });
    }

    const el = elements.find((e) => e.id === match.id);
    if (!el) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: Date.now() - start,
        error: `Element "${match.id}" disappeared`,
      });
    }

    const value = extractValue(el, node.extract.property);
    variables.set(node.extract.variable, value);

    return Promise.resolve({
      nodeId: node.id,
      success: true,
      durationMs: Date.now() - start,
      values: { [node.extract.variable]: value },
    });
  }

  private executeAssertNode(
    node: WorkflowNode,
    start: number,
  ): Promise<NodeResult> {
    if (!node.assert) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: 0,
        error: 'Assert node missing assert config',
      });
    }

    const elements = this.registry.getAllElements();
    const match = findFirst(elements, node.assert.target);
    if (!match) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: Date.now() - start,
        error: `No element found for assert query: ${JSON.stringify(node.assert.target)}`,
      });
    }

    const el = elements.find((e) => e.id === match.id);
    if (!el) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: Date.now() - start,
        error: `Element "${match.id}" disappeared`,
      });
    }

    const actual = extractValue(el, node.assert.property);
     
    const passed = actual == node.assert.expected;

    return Promise.resolve({
      nodeId: node.id,
      success: passed,
      durationMs: Date.now() - start,
      error: passed ? undefined : `Assertion failed: expected ${String(node.assert.expected)}, got ${String(actual)}`,
      values: { actual, expected: node.assert.expected },
    });
  }

  private executeWaitNode(
    node: WorkflowNode,
    start: number,
  ): Promise<NodeResult> {
    if (!node.wait) {
      return Promise.resolve({
        nodeId: node.id,
        success: false,
        durationMs: 0,
        error: 'Wait node missing wait config',
      });
    }

    if (node.wait.type === 'time' && node.wait.ms) {
      return new Promise<NodeResult>((resolve) => {
        setTimeout(() => {
          resolve({
            nodeId: node.id,
            success: true,
            durationMs: Date.now() - start,
          });
        }, node.wait!.ms!);
      });
    }

    // For idle waits, delegate to executor
    if (node.wait.type === 'idle') {
      return this.executor.waitForIdle(node.wait.timeout).then(() => ({
        nodeId: node.id,
        success: true,
        durationMs: Date.now() - start,
      }));
    }

    // Default: succeed immediately for unsupported wait types
    return Promise.resolve({
      nodeId: node.id,
      success: true,
      durationMs: Date.now() - start,
    });
  }

  private async executeSubgraphNode(
    node: WorkflowNode,
    variables: VariableContext,
    start: number,
  ): Promise<NodeResult> {
    if (!node.subgraph) {
      return {
        nodeId: node.id,
        success: false,
        durationMs: 0,
        error: 'Subgraph node missing subgraph config',
      };
    }

    variables.pushScope();
    try {
      const subResult = await this.execute(node.subgraph, {
        variables: variables.toRecord(),
      });

      return {
        nodeId: node.id,
        success: subResult.success,
        durationMs: Date.now() - start,
        values: subResult.variables,
      };
    } finally {
      variables.popScope();
    }
  }
}
