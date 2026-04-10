/**
 * Flow endpoint handlers.
 */

import type { FlowDefinition } from "../../batch/flow";
import type { ActionResult } from "../../batch/action-sequence";
import type { RegistryLike } from "../../state/state-detector";
import type { ActionExecutorLike } from "../../state/transition-executor";
import type { FlowRegistry } from "../../batch/flow";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createFlowHandlers(
  flowRegistry: FlowRegistry,
  executor: ActionExecutorLike,
  registry: RegistryLike,
) {
  return {
    defineFlow: async (
      body: FlowDefinition,
    ): Promise<HandlerResponse<{ name: string }>> => {
      try {
        if (!body.name) {
          return fail("Missing required field: name");
        }
        if (!body.steps || !Array.isArray(body.steps)) {
          return fail("Missing required field: steps");
        }
        flowRegistry.define(body);
        return ok({ name: body.name });
      } catch (err) {
        return fail(err);
      }
    },

    executeFlow: async (body: {
      name: string;
    }): Promise<HandlerResponse<ActionResult[]>> => {
      try {
        if (!body.name) {
          return fail("Missing required field: name");
        }
        const results = await flowRegistry.execute(
          body.name,
          executor,
          registry,
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

    removeFlow: async (body: {
      name: string;
    }): Promise<HandlerResponse<{ removed: boolean }>> => {
      try {
        if (!body.name) {
          return fail("Missing required field: name");
        }
        const removed = flowRegistry.remove(body.name);
        return ok({ removed });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
