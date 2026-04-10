/**
 * Action execution endpoint handlers.
 */

import type { ActionStep, SequenceOptions, ActionResult } from "../../batch/action-sequence";
import { executeSequence } from "../../batch/action-sequence";
import type { RegistryLike } from "../../state/state-detector";
import type { ActionExecutorLike } from "../../state/transition-executor";
import type { SessionRecorder } from "../../recording/session-recorder";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createActionHandlers(
  executor: ActionExecutorLike,
  registry: RegistryLike,
  recorder: SessionRecorder,
) {
  return {
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
  };
}
