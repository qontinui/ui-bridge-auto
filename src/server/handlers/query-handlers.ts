/**
 * Element query endpoint handlers.
 */

import type { AutomationEngine } from "../../core/engine";
import type { ElementQuery, QueryResult } from "../../core/element-query";
import { executeQuery } from "../../core/element-query";
import { diagnoseNoResults } from "../../core/query-debugger";
import type { RegistryLike } from "../../state/state-detector";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createQueryHandlers(engine: AutomationEngine, registry: RegistryLike) {
  return {
    findElement: async (body: {
      query: ElementQuery;
    }): Promise<HandlerResponse<QueryResult | null>> => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        const result = engine.findElement(body.query);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    findAllElements: async (body: {
      query: ElementQuery;
      maxResults?: number;
    }): Promise<HandlerResponse<QueryResult[]>> => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        let results = engine.findAllElements(body.query);
        if (body.maxResults !== undefined && body.maxResults > 0) {
          results = results.slice(0, body.maxResults);
        }
        return ok(results);
      } catch (err) {
        return fail(err);
      }
    },

    explainQuery: async (body: {
      query: ElementQuery;
    }): Promise<
      HandlerResponse<{
        matchCount: number;
        diagnosis: ReturnType<typeof diagnoseNoResults> | null;
      }>
    > => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        const elements = registry.getAllElements();
        const results = executeQuery(elements, body.query);
        const diagnosis =
          results.length === 0
            ? diagnoseNoResults(elements, body.query)
            : null;
        return ok({ matchCount: results.length, diagnosis });
      } catch (err) {
        return fail(err);
      }
    },
  };
}
