/**
 * Recording and replay endpoint handlers.
 */

import type { AutomationEngine } from "../../core/engine";
import type { RegistryLike } from "../../state/state-detector";
import type { ActionExecutorLike } from "../../state/transition-executor";
import {
  SessionRecorder,
  type RecordingSession,
} from "../../recording/session-recorder";
import {
  ReplayEngine,
  type ReplayOptions,
  type ReplayResult,
} from "../../recording/replay-engine";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createRecordingHandlers(
  engine: AutomationEngine,
  executor: ActionExecutorLike,
  registry: RegistryLike,
) {
  const recorder = engine.recorder;
  const replayEngine = new ReplayEngine(executor, registry);

  return {
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
  };
}
