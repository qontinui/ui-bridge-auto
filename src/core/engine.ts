/**
 * Automation engine — the top-level orchestrator that ties together the
 * state machine, state detector, pathfinder, transition executor, recording,
 * reliability tracking, and self-healing.
 *
 * Consumers interact with this class rather than the individual subsystems.
 */

import type { ElementQuery, QueryResult } from "./element-query";
import { findFirst, executeQuery } from "./element-query";
import { TimeoutError } from "../wait/types";
import {
  StateMachine,
  type StateDefinition,
  type TransitionDefinition,
} from "../state/state-machine";
import { StateDetector, type RegistryLike } from "../state/state-detector";
import type { ActionExecutorLike } from "../state/transition-executor";
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
  type GraphFormat,
} from "../state/state-graph";
import type { ActionStep, ActionResult } from "../batch/action-sequence";
import { executeSequence } from "../batch/action-sequence";
import { FlowRegistry } from "../batch/flow";
import {
  SessionRecorder,
  type RecordingSession,
} from "../recording/session-recorder";
import {
  ReplayEngine,
  type ReplayOptions,
  type ReplayResult,
} from "../recording/replay-engine";
import { ElementRelocator } from "../healing/element-relocator";
import type {
  WorkflowGraph,
  ExecutionResult,
} from "../execution/graph-executor";
import { GraphExecutor } from "../execution/graph-executor";
import { ElementHighlightManager } from "../visual/element-highlight";
import type { IOCRProvider } from "../visual/types";
import type { ActionType } from "../types/transition";

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
  /** Enable visual highlights during automation (default false). */
  enableHighlights?: boolean;
  /** Custom highlight manager. Auto-created when enableHighlights is true and this is omitted. */
  highlightManager?: ElementHighlightManager;
  /** Enable OCR auto-detection via Tesseract.js (default false). */
  enableOCR?: boolean;
  /** Custom OCR provider. When enableOCR is true and this is omitted, TesseractOCRProvider is auto-detected. */
  ocrProvider?: IOCRProvider;
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
  private readonly enableHighlights: boolean;
  /** Highlight manager for visual feedback during automation. */
  readonly highlightManager: ElementHighlightManager | null;
  /** OCR provider for text extraction from media elements. */
  private ocrProvider: IOCRProvider | null;
  private ocrAutoDetectPromise: Promise<void> | null = null;

  constructor(config: EngineConfig) {
    this.registry = config.registry;
    this.executor = config.executor;
    this.navigationStrategy = config.navigationStrategy ?? "dijkstra";
    this.enableReliabilityTracking = config.enableReliabilityTracking ?? true;
    this.enableHealing = config.enableHealing ?? true;
    this.enableHighlights = config.enableHighlights ?? false;

    this.stateMachine = new StateMachine();
    this.stateDetector = new StateDetector(this.stateMachine, this.registry);
    this.reliabilityTracker = new ReliabilityTracker();
    this.flowRegistry = new FlowRegistry();
    this.recorder = new SessionRecorder();
    this.replayEngine = new ReplayEngine(this.executor, this.registry);
    this.relocator = new ElementRelocator(this.registry);
    this.highlightManager = this.enableHighlights
      ? config.highlightManager ?? new ElementHighlightManager()
      : config.highlightManager ?? null;
    this.ocrProvider = config.ocrProvider ?? null;
    if (config.enableOCR && !this.ocrProvider) {
      this.ocrAutoDetectPromise = this.autoDetectOCR();
    }
  }

  // -----------------------------------------------------------------------
  // OCR auto-detection
  // -----------------------------------------------------------------------

  /**
   * Attempt to auto-detect and initialize a TesseractOCRProvider.
   * Fails silently if tesseract.js is not installed.
   */
  private async autoDetectOCR(): Promise<void> {
    try {
      const { TesseractOCRProvider } = await import("../visual/tesseract-provider");
      this.ocrProvider = new TesseractOCRProvider();
    } catch {
      // tesseract.js not installed — OCR remains unavailable
    }
  }

  /**
   * Get the OCR provider, awaiting auto-detection if it's still in progress.
   *
   * @returns The OCR provider, or null if none is available.
   */
  async getOCRProvider(): Promise<IOCRProvider | null> {
    if (this.ocrAutoDetectPromise) {
      await this.ocrAutoDetectPromise;
      this.ocrAutoDetectPromise = null;
    }
    return this.ocrProvider;
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
  // Initial state detection
  // -----------------------------------------------------------------------

  /**
   * Detect which states are currently active by batch-finding all required
   * elements against the live DOM. A state is active if ANY of its required
   * elements is found (elements in a state always co-occur, so finding one
   * implies all are present).
   *
   * This is a one-time operation meant to be called before automation starts.
   * After this, the event-driven StateDetector maintains the active set.
   */
  detectActiveStates(): void {
    const defs = this.stateMachine.getAllStateDefinitions();

    // Collect all unique element queries across all states
    const allQueries = defs.flatMap((d) => d.requiredElements);
    const uniqueKeys = new Set(allQueries.map((q) => JSON.stringify(q)));
    const uniqueQueries = [...uniqueKeys].map((k) => JSON.parse(k) as ElementQuery);

    // Batch-find all elements at once
    const found: Map<string, { id: string } | null> = this.executor.findElements
      ? this.executor.findElements(uniqueQueries)
      : new Map(uniqueQueries.map((q) => [JSON.stringify(q), this.executor.findElement(q)]));

    // A state is active if ANY of its required elements was found
    const active = new Set(
      defs
        .filter((def) =>
          def.requiredElements.length > 0 &&
          def.requiredElements.some((q) => found.get(JSON.stringify(q)) !== null),
        )
        .map((def) => def.id),
    );

    this.stateMachine.setActiveStates(active);
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
    const transitions = this.stateMachine.getTransitionDefinitions();
    const recovery = options?.recovery !== false; // default true

    const navOptions: NavigationOptions = {
      strategy: this.navigationStrategy,
      ...options,
      reliability: this.enableReliabilityTracking
        ? this.reliabilityTracker
        : options?.reliability,
    };

    const initialStates = this.stateMachine.getActiveStates();
    const result = navigate(initialStates, target, transitions, navOptions);
    let remainingPath = [...result.path];
    const executedTransitions: typeof result.path = [];
    // Track failed transition IDs to avoid retrying the same path.
    const failedTransitionIds = new Set<string>();

    while (remainingPath.length > 0) {
      const tr = remainingPath[0];
      const startTime = Date.now();
      try {
        for (const action of tr.actions) {
          const found = this.executor.findElement(action.target);
          if (!found) {
            // Try healing if enabled
            if (this.enableHealing) {
              const alt = this.relocator.findAlternative(action.target);
              if (alt) {
                // Highlight the relocated element before action
                if (this.highlightManager && this.enableHighlights) {
                  this.highlightManager.highlightAction(
                    alt.element.id,
                    action.action as ActionType,
                    this.registry,
                  );
                }
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
          // Highlight element before action
          if (this.highlightManager && this.enableHighlights) {
            this.highlightManager.highlightAction(
              found.id,
              action.action as ActionType,
              this.registry,
            );
          }
          await this.executor.executeAction(found.id, action.action, action.params);

          if (action.waitAfter) {
            await this.handleWaitAfter(action.waitAfter);
          }
        }
      } catch (err) {
        if (this.enableReliabilityTracking) {
          this.reliabilityTracker.record(tr.id, false, Date.now() - startTime);
        }

        failedTransitionIds.add(tr.id);

        // Attempt recovery: re-detect state and re-plan, avoiding failed transitions.
        if (recovery) {
          this.stateDetector.evaluate();
          const currentStates = this.stateMachine.getActiveStates();

          // Already at target? Partial progress may have gotten us there.
          if (currentStates.has(target)) {
            break;
          }

          // Re-plan from current state, excluding transitions that already failed.
          const availableTransitions = transitions.filter(
            (t) => !failedTransitionIds.has(t.id),
          );
          const newResult = navigate(currentStates, target, availableTransitions, navOptions);
          if (newResult.path.length > 0) {
            remainingPath = [...newResult.path];
            continue;
          }
        }

        // No recovery possible — propagate error
        throw err;
      }

      if (this.enableReliabilityTracking) {
        this.reliabilityTracker.record(tr.id, true, Date.now() - startTime);
      }

      executedTransitions.push(tr);
      remainingPath.shift();
    }

    // Return result with the full set of executed transitions
    return {
      ...result,
      path: executedTransitions,
    };
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
      // Forward-referenced by `cleanup` — must stay `let` so TDZ doesn't fire
      // if a synchronously-delivered subscriber event triggers cleanup before
      // setTimeout has been called below. prefer-const is configured with
      // ignoreReadBeforeAssign for exactly this pattern.
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
      // Forward-referenced by `cleanup`; must stay `let`. See waitForElement.
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
    // Highlight each step's target before execution
    if (this.highlightManager && this.enableHighlights) {
      for (const step of steps) {
        const elements = this.registry.getAllElements();
        const found = findFirst(elements, step.target);
        if (found) {
          this.highlightManager.highlightAction(
            found.id,
            step.action as ActionType,
            this.registry,
          );
        }
      }
    }

    const results = await executeSequence(
      steps,
      this.executor,
      this.registry,
    );

    // Record to session if recording. Capture the returned event id for each
    // action so any future bridging code that observes derived events
    // (state changes, element appear/disappear, predicate evals) inside the
    // action's scope can attribute them via `recorder.withCause(actionId, ...)`.
    // For now there is no synchronous bridging at this site — the action loop
    // simply records each result and moves on — so capturing the id is a
    // no-op preparatory step.
    if (this.recorder.isRecording) {
      for (const result of results) {
        const actionId = this.recorder.recordAction({
          actionType: result.action,
          elementId: result.elementId ?? "unknown",
          success: result.success,
          durationMs: result.durationMs,
        });
        // Reserve the id for future causality bridging. Void to satisfy
        // no-unused-vars without changing runtime behavior.
        void actionId;
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
    this.highlightManager?.dismissAll();
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
