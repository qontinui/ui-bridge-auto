/**
 * Integration test for Phase 2 of Section 5: causality wiring at recorder
 * call sites.
 *
 * Validates that when an action is recorded and a derived event (state
 * change, element appear/disappear, predicate evaluation) is recorded
 * inside that action's causal scope via `withCauseAsync(actionId, ...)`,
 * the derived event carries `causedBy = actionId` automatically — without
 * the bridging code needing to thread the id through manually.
 *
 * The action call sites in `engine.ts` and `action-handlers.ts` capture
 * the returned event id for exactly this reason; this test exercises the
 * end-to-end contract using a small inline bridge that mirrors what a
 * real bridging layer would do.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AutomationEngine } from "../../core/engine";
import {
  MockRegistry,
  MockActionExecutor,
  createButton,
  resetIdCounter,
} from "../../test-utils";
import type {
  RecordedAction,
  RecordedStateChange,
  RecordedPredicateEval,
  RecordedElementEvent,
} from "../../recording/session-recorder";

let registry: MockRegistry;
let executor: MockActionExecutor;
let engine: AutomationEngine;

beforeEach(() => {
  resetIdCounter();
  registry = new MockRegistry();
  executor = new MockActionExecutor();
  engine = new AutomationEngine({
    registry,
    executor,
    enableReliabilityTracking: false,
    enableHealing: false,
  });
});

afterEach(() => {
  engine.dispose();
});

describe("causality wiring (Section 5 Phase 2)", () => {
  it("derived state change inherits causedBy from ambient action scope", async () => {
    // Wire a minimal state-machine -> recorder bridge. This is the kind of
    // bridging code the engine layer will eventually own; doing it inline
    // here validates the contract: events emitted while an ambient cause is
    // set get that cause attributed automatically.
    const recorder = engine.recorder;
    const unsub = engine.stateMachine.onStateEnter("*", (event) => {
      if (!recorder.isRecording) return;
      recorder.recordStateChange({
        entered: [event.stateId],
        exited: [],
        activeStates: Array.from(engine.stateMachine.getActiveStates()),
      });
    });

    try {
      recorder.start();

      // Record the action and capture its id.
      const actionId = recorder.recordAction({
        actionType: "click",
        elementId: "btn-1",
        success: true,
        durationMs: 5,
      });

      // Inside the action's causal scope, drive a state change. The bridge
      // above will record it; the recorder picks up the ambient cause.
      await recorder.withCauseAsync(actionId, async () => {
        const btn = createButton("Logged In");
        registry.addElement(btn);
        engine.defineStates([
          {
            id: "logged-in",
            name: "Logged In",
            requiredElements: [{ role: "button" }],
          },
        ]);
        // defineStates triggers an immediate detector evaluation, which
        // calls setActiveStates -> emitEnter -> our bridge -> recorder.
      });

      const session = recorder.stop();

      // Find the action and the state-change events.
      const actionEvent = session.events.find((e) => e.id === actionId);
      const stateChangeEvent = session.events.find(
        (e) => e.type === "stateChange",
      );

      expect(actionEvent).toBeDefined();
      expect(actionEvent?.type).toBe("action");
      // Action is a root cause when recorded outside any ambient scope.
      expect(actionEvent?.causedBy ?? null).toBeNull();

      expect(stateChangeEvent).toBeDefined();
      // The state change inherited the action's id as its cause.
      expect(stateChangeEvent?.causedBy).toBe(actionId);

      const data = stateChangeEvent?.data as RecordedStateChange;
      expect(data.entered).toContain("logged-in");
    } finally {
      unsub();
    }
  });

  it("ambient cause propagates to element appear/disappear and predicate eval events", async () => {
    const recorder = engine.recorder;
    recorder.start();

    const actionId = recorder.recordAction({
      actionType: "click",
      elementId: "btn-1",
      success: true,
      durationMs: 1,
    } satisfies RecordedAction);

    let appearedId: string | null = null;
    let disappearedId: string | null = null;
    let predicateId: string | null = null;

    await recorder.withCauseAsync(actionId, async () => {
      appearedId = recorder.recordElementAppeared({
        elementId: "el-1",
        elementLabel: "Modal",
      } satisfies RecordedElementEvent);
      disappearedId = recorder.recordElementDisappeared({
        elementId: "el-2",
      } satisfies RecordedElementEvent);
      predicateId = recorder.recordPredicateEval({
        predicateId: "modal-visible",
        target: "el-1",
        matched: true,
      } satisfies RecordedPredicateEval);
    });

    const session = recorder.stop();
    const find = (id: string | null) =>
      session.events.find((e) => e.id === id);

    expect(find(appearedId)?.causedBy).toBe(actionId);
    expect(find(disappearedId)?.causedBy).toBe(actionId);
    expect(find(predicateId)?.causedBy).toBe(actionId);
  });

  it("ambient cause is restored after withCauseAsync rejects", async () => {
    const recorder = engine.recorder;
    recorder.start();

    const outerId = recorder.recordAction({
      actionType: "click",
      elementId: "btn-outer",
      success: true,
      durationMs: 1,
    });

    await recorder
      .withCauseAsync(outerId, async () => {
        throw new Error("boom");
      })
      .catch(() => undefined);

    // Ambient cause should be back to null after the rejection.
    expect(recorder.ambientCause).toBeNull();

    // A subsequent record outside any scope is a root cause.
    const followupId = recorder.recordAction({
      actionType: "click",
      elementId: "btn-followup",
      success: true,
      durationMs: 1,
    });

    const session = recorder.stop();
    const followup = session.events.find((e) => e.id === followupId);
    expect(followup?.causedBy ?? null).toBeNull();
  });

  it("explicit causedBy override beats ambient cause", () => {
    const recorder = engine.recorder;
    recorder.start();

    const rootId = recorder.recordAction({
      actionType: "click",
      elementId: "btn-root",
      success: true,
      durationMs: 1,
    });
    const otherId = recorder.recordAction({
      actionType: "click",
      elementId: "btn-other",
      success: true,
      durationMs: 1,
    });

    let derivedId: string | null = null;
    recorder.withCause(rootId, () => {
      derivedId = recorder.recordStateChange(
        { entered: ["x"], exited: [], activeStates: ["x"] },
        otherId,
      );
    });

    const session = recorder.stop();
    const derived = session.events.find((e) => e.id === derivedId);
    expect(derived?.causedBy).toBe(otherId);
  });
});
