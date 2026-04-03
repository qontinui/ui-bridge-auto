/**
 * Execution controller — start, pause, resume, cancel workflow execution.
 *
 * Wraps GraphExecutor with lifecycle management and progress monitoring.
 */

import type { ActionExecutorLike } from '../state/transition-executor';
import type { SuccessCriteria, NodeResult } from './success-criteria';
import { allMustPass } from './success-criteria';
import { ExecutionTracker } from './execution-tracker';
import type { ExecutionPhase } from './execution-tracker';
import { GraphExecutor } from './graph-executor';
import type { WorkflowGraph, ExecutionResult } from './graph-executor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionControllerConfig {
  executor: ActionExecutorLike;
  /** Registry providing element access. */
  registry?: { getAllElements(): unknown[] };
  variables?: Record<string, unknown>;
  criteria?: SuccessCriteria;
  /** Max execution time (ms). */
  timeout?: number;
  /** Called after each node completes. */
  onProgress?: (tracker: ExecutionTracker) => void;
}

// ---------------------------------------------------------------------------
// ExecutionController
// ---------------------------------------------------------------------------

export class ExecutionController {
  private _tracker = new ExecutionTracker();
  private _state: ExecutionPhase = 'pending';
  private cancelRequested = false;
  private pauseRequested = false;
  private resumeResolve: (() => void) | null = null;
  private readonly config: ExecutionControllerConfig;

  constructor(config: ExecutionControllerConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start executing a workflow graph.
   * Returns the final execution result when complete.
   */
  async start(graph: WorkflowGraph): Promise<ExecutionResult> {
    this._state = 'running';
    this._tracker.setPhase('running');
    this.cancelRequested = false;
    this.pauseRequested = false;

    const registry = (this.config.registry ?? {
      getAllElements: () => [],
    }) as { getAllElements(): never[] };

    const graphExecutor = new GraphExecutor(this.config.executor, registry);

    // Build a wrapper executor that checks pause/cancel between nodes
    const self = this;
    const wrappingExecutor: ActionExecutorLike = {
      findElement: (query) => self.config.executor.findElement(query),
      async executeAction(elementId, action, params) {
        if (self.cancelRequested) throw new Error('Execution cancelled');

        // Check for pause
        if (self.pauseRequested) {
          self._state = 'paused';
          self._tracker.setPhase('paused');
          await new Promise<void>((resolve) => {
            self.resumeResolve = resolve;
          });
          self._state = 'running';
          self._tracker.setPhase('running');
        }

        return self.config.executor.executeAction(elementId, action, params);
      },
      async waitForIdle(timeout?) {
        if (self.cancelRequested) throw new Error('Execution cancelled');
        return self.config.executor.waitForIdle(timeout);
      },
    };

    const wrappedGraphExecutor = new GraphExecutor(wrappingExecutor, registry);

    try {
      const result = await wrappedGraphExecutor.execute(graph, {
        variables: this.config.variables,
        criteria: this.config.criteria ?? allMustPass(),
        timeout: this.config.timeout,
        onNodeComplete: (_nodeId, _result) => {
          this.config.onProgress?.(this._tracker);
        },
      });

      this._state = result.phase;
      return result;
    } catch (err) {
      if (this.cancelRequested) {
        this._state = 'cancelled';
        this._tracker.setPhase('cancelled');
        return {
          success: false,
          phase: 'cancelled',
          results: this._tracker.getResults(),
          variables: {},
          durationMs: this._tracker.elapsedMs,
          nodesExecuted: this._tracker.getResults().length,
          summary: 'Execution cancelled',
        };
      }
      throw err;
    }
  }

  /**
   * Pause execution (completes current node, then pauses).
   */
  pause(): void {
    if (this._state === 'running') {
      this.pauseRequested = true;
    }
  }

  /**
   * Resume from paused state.
   */
  resume(): void {
    if (this.pauseRequested && this.resumeResolve) {
      this.pauseRequested = false;
      const resolve = this.resumeResolve;
      this.resumeResolve = null;
      resolve();
    }
  }

  /**
   * Cancel execution immediately.
   */
  cancel(): void {
    this.cancelRequested = true;
    this._state = 'cancelled';
    // If paused, unblock the pause wait
    if (this.resumeResolve) {
      const resolve = this.resumeResolve;
      this.resumeResolve = null;
      resolve();
    }
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /** Get current execution state. */
  get state(): ExecutionPhase {
    return this._state;
  }

  /** Get the tracker for progress monitoring. */
  get tracker(): ExecutionTracker {
    return this._tracker;
  }
}
