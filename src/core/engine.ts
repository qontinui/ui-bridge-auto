/**
 * Automation engine — the top-level orchestrator that ties together the
 * state machine, state detector, pathfinder, and transition executor.
 *
 * Consumers interact with this class rather than the individual subsystems.
 */

import type { ElementQuery, QueryableElement } from "./element-query";
import { findFirst } from "./element-query";
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
  navigateToState as navTo,
} from "../state/transition-executor";
import type { ActionStep } from "../batch/action-sequence";

// ---------------------------------------------------------------------------
// AutomationEngine
// ---------------------------------------------------------------------------

export class AutomationEngine {
  public readonly machine: StateMachine;
  public readonly detector: StateDetector;

  private readonly registry: RegistryLike;
  private readonly actionExecutor: ActionExecutorLike;

  constructor(registry: RegistryLike, actionExecutor: ActionExecutorLike) {
    this.registry = registry;
    this.actionExecutor = actionExecutor;
    this.machine = new StateMachine();
    this.detector = new StateDetector(this.machine, registry);
  }

  // -----------------------------------------------------------------------
  // Definition helpers
  // -----------------------------------------------------------------------

  defineStates(defs: StateDefinition[]): void {
    this.machine.defineStates(defs);
    // Re-evaluate immediately so new definitions are reflected
    this.detector.evaluate();
  }

  defineTransitions(defs: TransitionDefinition[]): void {
    this.machine.defineTransitions(defs);
  }

  // -----------------------------------------------------------------------
  // State queries
  // -----------------------------------------------------------------------

  getActiveStates(): Set<string> {
    return this.machine.getActiveStates();
  }

  isActive(stateId: string): boolean {
    return this.machine.isActive(stateId);
  }

  // -----------------------------------------------------------------------
  // Waiting
  // -----------------------------------------------------------------------

  /**
   * Wait until the given state becomes active.
   * Resolves immediately if already active.
   */
  waitForState(
    stateId: string,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<void> {
    const timeout = options?.timeout ?? 10_000;

    if (this.machine.isActive(stateId)) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = (): void => {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubState();
        if (abortHandler && options?.signal) {
          options.signal.removeEventListener("abort", abortHandler);
        }
      };

      const unsubState = this.machine.onStateEnter(stateId, () => {
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
            timeout,
          ),
        );
      }, timeout);

      const abortHandler = options?.signal
        ? () => {
            if (settled) return;
            cleanup();
            reject(new Error("Aborted"));
          }
        : undefined;

      if (abortHandler && options?.signal) {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Element operations
  // -----------------------------------------------------------------------

  /**
   * Find an element matching the query in the current registry snapshot.
   */
  findElement(query: ElementQuery): { id: string } | null {
    return this.actionExecutor.findElement(query);
  }

  /**
   * Wait for an element matching the query to appear.
   */
  waitForElement(
    query: ElementQuery,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<{ id: string }> {
    const timeout = options?.timeout ?? 10_000;

    // Check immediately
    const existing = this.actionExecutor.findElement(query);
    if (existing) return Promise.resolve(existing);

    return new Promise<{ id: string }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribes: Array<() => void> = [];

      const cleanup = (): void => {
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        for (const unsub of unsubscribes) unsub();
        if (abortHandler && options?.signal) {
          options.signal.removeEventListener("abort", abortHandler);
        }
      };

      const check = (): void => {
        if (settled) return;
        const found = this.actionExecutor.findElement(query);
        if (found) {
          cleanup();
          resolve(found);
        }
      };

      // Listen to registry events
      unsubscribes.push(
        this.registry.on("element:registered", check),
        this.registry.on("element:stateChanged", check),
      );

      timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(
          new TimeoutError(
            "Timed out waiting for element",
            timeout,
          ),
        );
      }, timeout);

      const abortHandler = options?.signal
        ? () => {
            if (settled) return;
            cleanup();
            reject(new Error("Aborted"));
          }
        : undefined;

      if (abortHandler && options?.signal) {
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  /**
   * Navigate to a target state using pathfinding and transition execution.
   */
  async navigateToState(targetState: string): Promise<void> {
    await navTo(
      targetState,
      this.machine,
      this.machine.getTransitionDefinitions(),
      this.actionExecutor,
    );
  }

  // -----------------------------------------------------------------------
  // Sequence execution
  // -----------------------------------------------------------------------

  /**
   * Execute an ordered sequence of action steps.
   */
  async executeSequence(steps: ActionStep[]): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await this.executeStep(step, i);
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  dispose(): void {
    this.detector.dispose();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private async executeStep(step: ActionStep, index: number): Promise<void> {
    const found = this.actionExecutor.findElement(step.target);
    if (!found) {
      throw new Error(
        `Step ${index}: target element not found for query`,
      );
    }

    await this.actionExecutor.executeAction(found.id, step.action, step.params);

    if (step.waitAfter) {
      await this.handleStepWait(step.waitAfter);
    }
  }

  private async handleStepWait(
    wait: NonNullable<ActionStep["waitAfter"]>,
  ): Promise<void> {
    const timeout = wait.timeout ?? 10_000;

    switch (wait.type) {
      case "idle":
        await this.actionExecutor.waitForIdle(timeout);
        break;

      case "time":
        await new Promise<void>((resolve) =>
          setTimeout(resolve, wait.ms ?? 500),
        );
        break;

      case "element": {
        if (!wait.query) break;
        await this.waitForElement(wait.query, { timeout });
        break;
      }

      case "state": {
        if (!wait.stateId) break;
        await this.waitForState(wait.stateId, { timeout });
        break;
      }
    }
  }
}
