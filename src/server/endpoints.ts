/**
 * HTTP endpoint handlers for the UI Bridge auto package.
 *
 * Each handler wraps module calls in try/catch and returns a uniform response
 * shape: { success: true, data } or { success: false, error }.
 *
 * These handlers are designed to be mounted on a UI Bridge server — they
 * accept parsed request bodies and return plain objects (no HTTP concerns).
 */

import { AutomationEngine, type EngineConfig } from "../core/engine";
import type { ElementQuery, QueryResult } from "../core/element-query";
import { executeQuery } from "../core/element-query";
import { explainQueryMatch, diagnoseNoResults } from "../core/query-debugger";
import type {
  StateDefinition,
  TransitionDefinition,
} from "../state/state-machine";
import type { ActionStep, SequenceOptions, ActionResult } from "../batch/action-sequence";
import { executeSequence } from "../batch/action-sequence";
import { FlowRegistry, type FlowDefinition } from "../batch/flow";
import type { RegistryLike } from "../state/state-detector";
import type { ActionExecutorLike } from "../state/transition-executor";
import type { NavigationOptions, NavigationResult } from "../state/navigation";
import { ReliabilityTracker } from "../state/reliability";
import {
  exportGraph,
  importGraph,
  type GraphFormat,
} from "../state/state-graph";
import { serialize, deserialize } from "../state/persistence";
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
import { classifyError } from "../healing/error-classifier";
import { generateStableId } from "../discovery/stable-id";

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
// Config
// ---------------------------------------------------------------------------

/** Configuration for the handler factory. */
export interface AutoHandlersConfig {
  /** The automation engine instance. */
  engine: AutomationEngine;
  /** Element registry for direct access. */
  registry: RegistryLike;
  /** Action executor for direct access. */
  executor: ActionExecutorLike;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Create all auto endpoint handlers.
 *
 * Each handler validates required fields, calls the appropriate module, and
 * returns a uniform `{ success, data/error }` response.
 */
export function createAutoHandlers(config: AutoHandlersConfig) {
  const { engine, registry, executor } = config;

  // Create supporting instances for endpoints that need them directly
  const flowRegistry = engine.flowRegistry;
  const recorder = engine.recorder;
  const replayEngine = new ReplayEngine(executor, registry);
  const relocator = new ElementRelocator(registry);
  const reliabilityTracker = engine.reliabilityTracker;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function ok<T>(data: T): SuccessResponse<T> {
    return { success: true, data };
  }

  function fail(err: unknown): ErrorResponse {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  return {
    // === Element queries ===

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

    // === Wait ===

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
      signals?: string[];
    }): Promise<HandlerResponse<null>> => {
      try {
        await engine.waitForIdle(body.timeout);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    // === Actions ===

    executeSequence: async (body: {
      steps: ActionStep[];
      options?: SequenceOptions;
    }): Promise<HandlerResponse<ActionResult[]>> => {
      try {
        if (!body.steps || !Array.isArray(body.steps)) {
          return fail("Missing required field: steps");
        }
        const results = await executeSequence(
          body.steps,
          executor,
          registry,
          body.options,
        );

        // Record to engine's recorder if active
        if (recorder.isRecording) {
          for (const result of results) {
            recorder.recordAction({
              actionType: result.action,
              elementId: result.elementId ?? "unknown",
              success: result.success,
              durationMs: result.durationMs,
            });
          }
        }

        return ok(results);
      } catch (err) {
        return fail(err);
      }
    },

    // === State machine ===

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

    // === Flows ===

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

    // === Recording ===

    startRecording: async (body?: {
      metadata?: Record<string, unknown>;
    }): Promise<HandlerResponse<{ sessionId: string }>> => {
      try {
        const sessionId = engine.startRecording(body?.metadata);
        return ok({ sessionId });
      } catch (err) {
        return fail(err);
      }
    },

    stopRecording: async (): Promise<HandlerResponse<RecordingSession>> => {
      try {
        const session = engine.stopRecording();
        return ok(session);
      } catch (err) {
        return fail(err);
      }
    },

    replaySession: async (body: {
      session: string;
      options?: Partial<ReplayOptions>;
    }): Promise<HandlerResponse<ReplayResult>> => {
      try {
        if (!body.session) {
          return fail("Missing required field: session");
        }
        const session = SessionRecorder.fromJSON(body.session);
        const result = await replayEngine.replay(session, body.options);
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    getRecordingStatus: async (): Promise<
      HandlerResponse<{
        isRecording: boolean;
        sessionId: string | null;
        eventCount: number;
      }>
    > => {
      try {
        const session = recorder.currentSession;
        return ok({
          isRecording: recorder.isRecording,
          sessionId: session?.id ?? null,
          eventCount: session?.events.length ?? 0,
        });
      } catch (err) {
        return fail(err);
      }
    },

    // === State graph ===

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

    // === Persistence ===

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

    // === Healing ===

    relocateElement: async (body: {
      previousId: string;
    }): Promise<
      HandlerResponse<{
        found: boolean;
        elementId: string | null;
        matchType: string | null;
        confidence: number;
      }>
    > => {
      try {
        if (!body.previousId) {
          return fail("Missing required field: previousId");
        }
        // Try direct lookup first
        const elements = registry.getAllElements();
        const direct = elements.find((el) => el.id === body.previousId);
        if (direct) {
          return ok({
            found: true,
            elementId: direct.id,
            matchType: "direct",
            confidence: 1.0,
          });
        }

        // Try alternative matching
        const alt = relocator.findAlternative({ id: body.previousId });
        if (alt) {
          return ok({
            found: true,
            elementId: alt.element.id,
            matchType: alt.matchType,
            confidence: alt.confidence,
          });
        }

        return ok({
          found: false,
          elementId: null,
          matchType: null,
          confidence: 0,
        });
      } catch (err) {
        return fail(err);
      }
    },

    // === Discovery ===

    generateStableIds: async (): Promise<
      HandlerResponse<Array<{ elementId: string; stableId: string }>>
    > => {
      try {
        const elements = registry.getAllElements();
        const result = elements.map((el) => ({
          elementId: el.id,
          stableId: generateStableId(el.element),
        }));
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
