/**
 * State graph and persistence endpoint handlers.
 */

import type { AutomationEngine } from "../../core/engine";
import {
  importGraph,
  type GraphFormat,
} from "../../state/state-graph";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createGraphHandlers(engine: AutomationEngine) {
  return {
    exportGraph: async (body: {
      format: GraphFormat;
    }): Promise<HandlerResponse<string>> => {
      try {
        if (!body.format) {
          return fail("Missing required field: format");
        }
        const result = engine.exportGraph(body.format);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    importGraph: async (body: {
      json: string;
    }): Promise<HandlerResponse<{ stateCount: number; transitionCount: number }>> => {
      try {
        if (!body.json) {
          return fail("Missing required field: json");
        }
        const data = importGraph(body.json);
        engine.defineStates(data.states);
        engine.defineTransitions(data.transitions);
        return ok({
          stateCount: data.states.length,
          transitionCount: data.transitions.length,
        });
      } catch (err) {
        return fail(err);
      }
    },

    saveStateMachine: async (): Promise<HandlerResponse<string>> => {
      try {
        const json = engine.serialize();
        return ok(json);
      } catch (err) {
        return fail(err);
      }
    },

    loadStateMachine: async (body: {
      json: string;
    }): Promise<HandlerResponse<null>> => {
      try {
        if (!body.json) {
          return fail("Missing required field: json");
        }
        engine.deserialize(body.json);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
