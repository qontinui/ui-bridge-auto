/**
 * State machine endpoint handlers.
 */

import type { AutomationEngine } from "../../core/engine";
import type {
  StateDefinition,
  TransitionDefinition,
} from "../../state/state-machine";
import type { NavigationOptions, NavigationResult } from "../../state/navigation";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createStateMachineHandlers(engine: AutomationEngine) {
  return {
    defineStates: async (body: {
      states: StateDefinition[];
    }): Promise<HandlerResponse<{ count: number }>> => {
      try {
        if (!body.states || !Array.isArray(body.states)) {
          return fail("Missing required field: states");
        }
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
        if (!body.transitions || !Array.isArray(body.transitions)) {
          return fail("Missing required field: transitions");
        }
        engine.defineTransitions(body.transitions);
        return ok({ count: body.transitions.length });
      } catch (err) {
        return fail(err);
      }
    },

    getStates: async (): Promise<HandlerResponse<StateDefinition[]>> => {
      try {
        const states = engine.stateMachine.getAllStateDefinitions();
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
      strategy?: string;
    }): Promise<HandlerResponse<NavigationResult>> => {
      try {
        if (!body.targetState) {
          return fail("Missing required field: targetState");
        }
        const options: NavigationOptions = {};
        if (
          body.strategy === "bfs" ||
          body.strategy === "dijkstra" ||
          body.strategy === "astar"
        ) {
          options.strategy = body.strategy;
        }
        const result = await engine.navigateToState(
          body.targetState,
          options,
        );
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
