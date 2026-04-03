/**
 * Named, reusable action sequences (flows).
 *
 * A flow is a named collection of ActionSteps with optional SequenceOptions.
 * Flows can be defined once and executed repeatedly, making them ideal for
 * capturing common UI interaction patterns (login, navigation, form fill).
 */

import type { ActionStep, SequenceOptions, ActionResult } from "./action-sequence";
import { executeSequence } from "./action-sequence";
import type { ActionExecutorLike } from "../state/transition-executor";
import type { RegistryLike } from "../state/state-detector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FlowDefinition {
  name: string;
  description?: string;
  steps: ActionStep[];
  options?: SequenceOptions;
}

// ---------------------------------------------------------------------------
// FlowRegistry
// ---------------------------------------------------------------------------

export class FlowRegistry {
  private readonly flows = new Map<string, FlowDefinition>();

  /**
   * Register a flow definition. Overwrites any existing flow with the same name.
   */
  define(flow: FlowDefinition): void {
    this.flows.set(flow.name, flow);
  }

  /**
   * Retrieve a flow definition by name.
   */
  get(name: string): FlowDefinition | undefined {
    return this.flows.get(name);
  }

  /**
   * List all registered flow definitions.
   */
  list(): FlowDefinition[] {
    return Array.from(this.flows.values());
  }

  /**
   * Remove a flow definition. Returns true if a flow was removed.
   */
  remove(name: string): boolean {
    return this.flows.delete(name);
  }

  /**
   * Execute a named flow.
   *
   * @throws Error if the flow name is not registered.
   */
  async execute(
    name: string,
    executor: ActionExecutorLike,
    registry: RegistryLike,
  ): Promise<ActionResult[]> {
    const flow = this.flows.get(name);
    if (!flow) {
      throw new Error(`Flow "${name}" is not defined`);
    }

    return executeSequence(flow.steps, executor, registry, flow.options);
  }
}
