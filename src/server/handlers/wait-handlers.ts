/**
 * Wait endpoint handlers.
 */

import type { AutomationEngine } from "../../core/engine";
import type { ElementQuery, QueryResult } from "../../core/element-query";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createWaitHandlers(engine: AutomationEngine) {
  return {
    waitForElement: async (body: {
      query: ElementQuery;
      timeout?: number;
    }): Promise<HandlerResponse<QueryResult>> => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        const result = await engine.waitForElement(body.query, body.timeout);
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
        if (!body.stateId) {
          return fail("Missing required field: stateId");
        }
        await engine.waitForState(body.stateId, body.timeout);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    waitForIdle: async (body: {
      timeout?: number;
      // NOTE: signal filtering is not yet implemented in the engine;
      // this field is accepted for API forward-compatibility but ignored.
      signals?: string[];
    }): Promise<HandlerResponse<null>> => {
      try {
        await engine.waitForIdle(body.timeout);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
