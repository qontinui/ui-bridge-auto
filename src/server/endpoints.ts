/**
 * HTTP endpoint handlers for the UI Bridge auto package.
 *
 * Each handler wraps an AutomationEngine call in try/catch and returns a
 * uniform response shape: { success: true, data } or { success: false, error }.
 *
 * These handlers are designed to be mounted on a UI Bridge server — they
 * accept parsed request bodies and return plain objects (no HTTP concerns).
 */

import type { AutomationEngine } from "../core/engine";
import type { ElementQuery } from "../core/element-query";
import type { StateDefinition, TransitionDefinition } from "../state/state-machine";
import type { ActionStep, SequenceOptions } from "../batch/action-sequence";
import { executeSequence } from "../batch/action-sequence";
import { FlowRegistry, type FlowDefinition } from "../batch/flow";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type HandlerResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

export function createAutoHandlers(engine: AutomationEngine) {
  const flowRegistry = new FlowRegistry();

  function ok<T>(data: T): SuccessResponse<T> {
    return { success: true, data };
  }

  function fail(err: unknown): ErrorResponse {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }

  return {
    // ----- Wait endpoints -----

    waitForElement: async (body: {
      query: ElementQuery;
      timeout?: number;
    }): Promise<HandlerResponse<{ id: string }>> => {
      try {
        const result = await engine.waitForElement(body.query, {
          timeout: body.timeout,
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    waitForState: async (body: {
      stateId: string;
      timeout?: number;
    }): Promise<HandlerResponse<null>> => {
      try {
        await engine.waitForState(body.stateId, { timeout: body.timeout });
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    waitForIdle: async (body: {
      timeout?: number;
      signals?: string[];
    }): Promise<HandlerResponse<null>> => {
      try {
        // Delegate to the engine's action executor idle wait
        await (engine as any).actionExecutor.waitForIdle(body.timeout ?? 10_000);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    // ----- Element query -----

    findElement: async (body: {
      query: ElementQuery;
    }): Promise<HandlerResponse<{ id: string } | null>> => {
      try {
        const result = engine.findElement(body.query);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    findAllElements: async (body: {
      query: ElementQuery;
    }): Promise<
      HandlerResponse<Array<{ id: string; label: string | undefined; type: string }>>
    > => {
      try {
        const { executeQuery } = await import("../core/element-query");
        const elements = (engine as any).registry.getAllElements();
        const results = executeQuery(elements, body.query);
        return ok(
          results.map((r: any) => ({
            id: r.id,
            label: r.label,
            type: r.type,
          })),
        );
      } catch (err) {
        return fail(err);
      }
    },

    // ----- State management -----

    defineStates: async (body: {
      states: StateDefinition[];
    }): Promise<HandlerResponse<{ count: number }>> => {
      try {
        engine.defineStates(body.states);
        return ok({ count: body.states.length });
      } catch (err) {
        return fail(err);
      }
    },

    defineTransitions: async (body: {
      transitions: TransitionDefinition[];
    }): Promise<HandlerResponse<{ count: number }>> => {
      try {
        engine.defineTransitions(body.transitions);
        return ok({ count: body.transitions.length });
      } catch (err) {
        return fail(err);
      }
    },

    getStates: async (): Promise<
      HandlerResponse<StateDefinition[]>
    > => {
      try {
        const states = engine.machine.getAllStateDefinitions();
        return ok(states);
      } catch (err) {
        return fail(err);
      }
    },

    getActiveStates: async (): Promise<HandlerResponse<string[]>> => {
      try {
        const active = engine.getActiveStates();
        return ok(Array.from(active));
      } catch (err) {
        return fail(err);
      }
    },

    navigateToState: async (body: {
      targetState: string;
    }): Promise<HandlerResponse<null>> => {
      try {
        await engine.navigateToState(body.targetState);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    // ----- Batch actions -----

    executeSequence: async (body: {
      steps: ActionStep[];
      options?: SequenceOptions;
    }): Promise<HandlerResponse<import("../batch/action-sequence").ActionResult[]>> => {
      try {
        const registry = (engine as any).registry;
        const executor = (engine as any).actionExecutor;
        const results = await executeSequence(
          body.steps,
          executor,
          registry,
          body.options,
        );
        return ok(results);
      } catch (err) {
        return fail(err);
      }
    },

    // ----- Flows -----

    defineFlow: async (
      body: FlowDefinition,
    ): Promise<HandlerResponse<{ name: string }>> => {
      try {
        flowRegistry.define(body);
        return ok({ name: body.name });
      } catch (err) {
        return fail(err);
      }
    },

    executeFlow: async (body: {
      name: string;
    }): Promise<HandlerResponse<import("../batch/action-sequence").ActionResult[]>> => {
      try {
        const registry = (engine as any).registry;
        const executor = (engine as any).actionExecutor;
        const flow = flowRegistry.get(body.name);
        if (!flow) {
          return fail(new Error(`Flow "${body.name}" is not defined`));
        }
        const results = await executeSequence(
          flow.steps,
          executor,
          registry,
          flow.options,
        );
        return ok(results);
      } catch (err) {
        return fail(err);
      }
    },

    listFlows: async (): Promise<HandlerResponse<FlowDefinition[]>> => {
      try {
        return ok(flowRegistry.list());
      } catch (err) {
        return fail(err);
      }
    },
  };
}
