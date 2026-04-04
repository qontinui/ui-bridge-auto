/**
 * Automation engine — the top-level orchestrator that ties together the
 * state machine, state detector, pathfinder, transition executor, recording,
 * reliability tracking, and self-healing.
 *
 * Consumers interact with this class rather than the individual subsystems.
 */

import type { ElementQuery, QueryableElement, QueryResult } from "./element-query";
import { findFirst, executeQuery } from "./element-query";
import { explainQueryMatch, diagnoseNoResults } from "./query-debugger";
import { TimeoutError } from "../wait/types";
import {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
} from "../state/state-machine";
import { StateDetector, type RegistryLike } from "../state/state-detector";
import type { ActionExecutorLike } from "../state/transition-executor";
import {
  executeTransition as execTr,
} from "../state/transition-executor";
import {
  navigate,
  type SearchStrategy,
  type NavigationOptions,
  type NavigationResult,
} from "../state/navigation";
import { ReliabilityTracker } from "../state/reliability";
import {
  serialize,
  deserialize,
} from "../state/persistence";
import {
  exportGraph,
  importGraph,
  type GraphFormat,
} from "../state/state-graph";
import type { ActionStep, ActionResult } from "../batch/action-sequence";
import { executeSequence } from "../batch/action-sequence";
import { FlowRegistry, type FlowDefinition } from "../batch/flow";
import {
  SessionRecorder,
  type RecordingSession,
  type RecordedAction,
} from "../recording/session-recorder";
import {
  ReplayEngine,
  type ReplayOptions,
  type ReplayResult,
} from "../recording/replay-engine";
import { classifyError } from "../healing/error-classifier";
import { ElementRelocator } from "../healing/element-relocator";
import type {
  WorkflowGraph,
  ExecutionResult,
} from "../execution/graph-executor";
import { GraphExecutor } from "../execution/graph-executor";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for the AutomationEngine. */
export interface EngineConfig {
  /** Element registry providing element lookup and events. */
  registry: RegistryLike;
  /** Executor for performing actions on elements. */
  executor: ActionExecutorLike;
  /** Default search strategy for navigation (default 'dijkstra'). */
  navigationStrategy?: SearchStrategy;
  /** Enable reliability tracking for transitions (default true). */
  enableReliabilityTracking?: boolean;
  /** Enable self-healing via error classification and element relocation (default true). */
  enableHealing?: boolean;
}

// ---------------------------------------------------------------------------
// AutomationEngine
// ---------------------------------------------------------------------------

export class AutomationEngine {
  /** The core state machine holding state/transition definitions. */
  readonly stateMachine: StateMachine;
  /** Event-driven state detector subscribing to registry events. */
  readonly stateDetector: StateDetector;
  /** Transition reliability tracker. */
  readonly reliabilityTracker: ReliabilityTracker;
  /** Named reusable flow registry. */
  readonly flowRegistry: FlowRegistry;
  /** Session recorder for capturing interactions. */
  readonly recorder: SessionRecorder;

  private readonly registry: RegistryLike;
  private readonly executor: ActionExecutorLike;
  private readonly replayEngine: ReplayEngine;
  private readonly relocator: ElementRelocator;
  private readonly navigationStrategy: SearchStrategy;
  private readonly enableReliabilityTracking: boolean;
  private readonly enableHealing: boolean;

  constructor(config: EngineConfig) {
    this.registry = config.registry;
    this.executor = config.executor;
    this.navigationStrategy = config.navigationStrategy ?? "dijkstra";
    this.enableReliabilityTracking = config.enableReliabilityTracking ?? true;
    this.enableHealing = config.enableHealing ?? true;

    this.stateMachine = new StateMachine();
    this.stateDetector = new StateDetector(this.stateMachine, this.registry);
    this.reliabilityTracker = new ReliabilityTracker();
    this.flowRegistry = new FlowRegistry();
    this.recorder = new SessionRecorder();
    this.replayEngine = new ReplayEngine(this.executor, this.registry);
    this.relocator = new ElementRelocator(this.registry);
  }

  // -----------------------------------------------------------------------
  // Definition helpers
  // -----------------------------------------------------------------------

  /** Register state definitions. Re-evaluates the detector immediately. */
  defineStates(defs: StateDefinition[]): void {
    this.stateMachine.defineStates(defs);
    this.stateDetector.evaluate();
  }

  /** Register transition definitions. */
  defineTransitions(defs: TransitionDefinition[]): void {
    this.stateMachine.defineTransitions(defs);
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  /** Get the set of currently active states. */
  getActiveStates(): Set<string> {
    return this.stateMachine.getActiveStates();
  }

  /** Check if a specific state is active. */
  isActive(stateId: string): boolean {
    return this.stateMachine.isActive(stateId);
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  /**
   * Navigate to a target state using pathfinding with reliability-adjusted
   * costs. Executes each transition in the path sequentially and records
   * reliability outcomes.
   */
  async navigateToState(
    target: string,
    options?: NavigationOptions,
  ): Promise<NavigationResult> {
    const activeStates = this.stateMachine.getActiveStates();
    const transitions = this.stateMachine.getTransitionDefinitions();

    const navOptions: NavigationOptions = {
      strategy: this.navigationStrategy,
      ...options,
      reliability: this.enableReliabilityTracking
        ? this.reliabilityTracker
        : options?.reliability,
    };

    const result = navigate(activeStates, target, transitions, navOptions);

    // Execute each transition in the path
    for (const tr of result.path) {
      const startTime = Date.now();
      let success = false;

      try {
        for (const action of tr.actions) {
          const found = this.executor.findElement(action.target);
          if (!found) {
            // Try healing if enabled
            if (this.enableHealing) {
              const alt = this.relocator.findAlternative(action.target);
              if (alt) {
                await this.executor.executeAction(
                  alt.element.id,
                  action.action,
                  action.params,
                );
                continue;
              }
            }
            throw new Error(
              `Element not found for transition "${tr.name}" action`,
            );
          }
          await this.executor.executeAction(found.id, action.action, action.params);

          if (action.waitAfter) {
            await this.handleWaitAfter(action.waitAfter);
          }
        }
        success = true;
      } catch (err) {
        if (this.enableHealing) {
          const classified = classifyError(
            err instanceof Error ? err : new Error(String(err)),
          );
          if (!classified.retryable) {
            if (this.enableReliabilityTracking) {
              this.reliabilityTracker.record(
                tr.id,
                false,
                Date.now() - startTime,
              );
            }
            throw err;
          }
        }
        if (this.enableReliabilityTracking) {
          this.reliabilityTracker.record(
            tr.id,
            false,
            Date.now() - startTime,
          );
        }
        throw err;
      }

      if (this.enableReliabilityTracking) {
        this.reliabilityTracker.record(
          tr.id,
          success,
          Date.now() - startTime,
        );
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Element operations
  // -----------------------------------------------------------------------

  /** Find an element matching the query in the current registry snapshot. */
  findElement(query: ElementQuery): QueryResult | null {
    const elements = this.registry.getAllElements();
    const results = executeQuery(elements, query);
    return results.length > 0 ? results[0] : null;
  }

  /** Find all elements matching the query. */
  findAllElements(query: ElementQuery): QueryResult[] {
    const elements = this.registry.getAllElements();
    return executeQuery(elements, query);
  }

  // -----------------------------------------------------------------------
  // Waiting
  // -----------------------------------------------------------------------

  /**
   * Wait for an element matching the query to appear.
   * Resolves immediately if already present.
   */
  waitForElement(
    query: ElementQuery,
    timeout?: number,
  ): Promise<QueryResult> {
    const timeoutMs = timeout ?? 10_000;

    // Check immediately
    const existing = this.findElement(query);
    if (existing) return Promise.resolve(existing);

    return new Promise<QueryResult>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribes: Array<() => void> = [];

      const cleanup = (): void => {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        for (const unsub of unsubscribes) unsub();
      };

      const check = (): void => {
        if (settled) return;
        const found = this.findElement(query);
        if (found) {
          cleanup();
          resolve(found);
        }
      };

      unsubscribes.push(
        this.registry.on("element:registered", check),
        this.registry.on("element:stateChanged", check),
      );

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(
          new TimeoutError("Timed out waiting for element", timeoutMs),
        );
      }, timeoutMs);
    });
  }

  /**
   * Wait until the given state becomes active.
   * Resolves immediately if already active.
   */
  waitForState(stateId: string, timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? 10_000;

    if (this.stateMachine.isActive(stateId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubState();
      };

      const unsubState = this.stateMachine.onStateEnter(stateId, () => {
        if (settled) return;
        cleanup();
        resolve();
      });

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(
          new TimeoutError(
            `Timed out waiting for state "${stateId}"`,
            timeoutMs,
          ),
        );
      }, timeoutMs);
    });
  }

  /** Wait for the executor to report idle. */
  async waitForIdle(timeout?: number): Promise<void> {
    await this.executor.waitForIdle(timeout ?? 10_000);
  }

  // -----------------------------------------------------------------------
  // Sequence execution
  // -----------------------------------------------------------------------

  /**
   * Execute an ordered sequence of action steps.
   * Records actions to the active recording session if one is active.
   */
  async executeSequence(steps: ActionStep[]): Promise<ActionResult[]> {
    const results = await executeSequence(
      steps,
      this.executor,
      this.registry,
    );

    // Record to session if recording
    if (this.recorder.isRecording) {
      for (const result of results) {
        this.recorder.recordAction({
          actionType: result.action,
          elementId: result.elementId ?? "unknown",
          success: result.success,
          durationMs: result.durationMs,
        });
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Graph execution
  // -----------------------------------------------------------------------

  /**
   * Execute a workflow graph.
   */
  async executeGraph(
    graph: WorkflowGraph,
    options?: { registry?: RegistryLike },
  ): Promise<ExecutionResult> {
    const graphExecutor = new GraphExecutor(
      this.executor,
      options?.registry ?? this.registry,
    );
    return graphExecutor.execute(graph);
  }

  // -----------------------------------------------------------------------
  // Recording
  // -----------------------------------------------------------------------

  /** Start a recording session. Returns the session ID. */
  startRecording(metadata?: Record<string, unknown>): string {
    return this.recorder.start(metadata);
  }

  /** Stop the current recording session and return it. */
  stopRecording(): RecordingSession {
    return this.recorder.stop();
  }

  /** Replay a recorded session. */
  async replaySession(
    session: RecordingSession,
    options?: Partial<ReplayOptions>,
  ): Promise<ReplayResult> {
    return this.replayEngine.replay(session, options);
  }

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  /** Serialize the state machine, transitions, and reliability data to JSON. */
  serialize(): string {
    return serialize(
      this.stateMachine.getAllStateDefinitions(),
      this.stateMachine.getTransitionDefinitions(),
      this.enableReliabilityTracking ? this.reliabilityTracker : undefined,
    );
  }

  /** Deserialize and load state machine definitions from JSON. */
  deserialize(json: string): void {
    const data = deserialize(json);
    this.stateMachine.defineStates(data.states);
    this.stateMachine.defineTransitions(data.transitions);
    this.stateDetector.evaluate();
  }

  // -----------------------------------------------------------------------
  // Graph export
  // -----------------------------------------------------------------------

  /** Export the state graph in the specified format. */
  exportGraph(format: GraphFormat): string {
    return exportGraph(
      this.stateMachine.getAllStateDefinitions(),
      this.stateMachine.getTransitionDefinitions(),
      format,
    );
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Dispose all subsystems, stopping the detector and recorder. */
  dispose(): void {
    this.stateDetector.dispose();
    if (this.recorder.isRecording) {
      try {
        this.recorder.stop();
      } catch {
        // Ignore — we are tearing down
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async handleWaitAfter(wait: {
    type: string;
    query?: ElementQuery;
    ms?: number;
    timeout?: number;
  }): Promise<void> {
    const timeout = wait.timeout ?? 10_000;

    switch (wait.type) {
      case "idle":
        await this.executor.waitForIdle(timeout);
        break;
      case "time":
        await new Promise<void>((resolve) =>
          setTimeout(resolve, wait.ms ?? 500),
        );
        break;
      case "element":
        if (wait.query) {
          await this.waitForElement(wait.query, timeout);
        }
        break;
      case "vanish":
        if (wait.query) {
          const vanishDeadline = Date.now() + timeout;
          while (Date.now() < vanishDeadline) {
            const el = this.executor.findElement(wait.query);
            if (!el) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(
            `Timed out waiting for element to vanish after ${timeout}ms`,
          );
        }
        break;
      case "change":
        if (wait.query) {
          const changeDeadline = Date.now() + timeout;
          const initialPresent = this.executor.findElement(wait.query) !== null;
          while (Date.now() < changeDeadline) {
            const nowPresent = this.executor.findElement(wait.query) !== null;
            if (nowPresent !== initialPresent) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`Timed out waiting for change after ${timeout}ms`);
        }
        break;
      case "stable":
        if (wait.query) {
          const stableDeadline = Date.now() + timeout;
          const quietMs = (wait as { quietPeriodMs?: number }).quietPeriodMs ?? 500;
          let lastPresent = this.executor.findElement(wait.query) !== null;
          let lastChange = Date.now();
          while (Date.now() < stableDeadline) {
            const nowPresent = this.executor.findElement(wait.query) !== null;
            if (nowPresent !== lastPresent) {
              lastPresent = nowPresent;
              lastChange = Date.now();
            }
            if (Date.now() - lastChange >= quietMs) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`Timed out waiting for stable after ${timeout}ms`);
        }
        break;
    }
  }
}
