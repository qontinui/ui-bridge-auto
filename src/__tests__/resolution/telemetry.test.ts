import { describe, it, expect } from "vitest";
import { NoopTelemetryEmitter, CallbackTelemetryEmitter } from "../../resolution/telemetry";
import type { EscalationEvent } from "../../resolution/types";

function createEvent(overrides?: Partial<EscalationEvent>): EscalationEvent {
  return {
    timestamp: Date.now(),
    query: { role: "button" },
    tier: "dom-query",
    durationMs: 10,
    ...overrides,
  };
}

describe("NoopTelemetryEmitter", () => {
  it("emit() does not throw", () => {
    const emitter = new NoopTelemetryEmitter();
    expect(() => emitter.emit(createEvent())).not.toThrow();
  });

  it("emit() accepts any valid EscalationEvent", () => {
    const emitter = new NoopTelemetryEmitter();
    expect(() =>
      emitter.emit(
        createEvent({
          tier: "exhausted",
          resolvedElementId: undefined,
          confidence: undefined,
        }),
      ),
    ).not.toThrow();
  });
});

describe("CallbackTelemetryEmitter", () => {
  it("invokes callback with the emitted event", () => {
    const events: EscalationEvent[] = [];
    const emitter = new CallbackTelemetryEmitter((e) => events.push(e));

    const event = createEvent({ tier: "accessibility-tree", confidence: 0.85 });
    emitter.emit(event);

    expect(events).toHaveLength(1);
    expect(events[0]).toBe(event);
  });

  it("passes the full event shape to the callback", () => {
    let received: EscalationEvent | null = null;
    const emitter = new CallbackTelemetryEmitter((e) => {
      received = e;
    });

    const event = createEvent({
      tier: "visual-coordinate",
      resolvedElementId: "el-42",
      confidence: 0.7,
      durationMs: 150,
    });
    emitter.emit(event);

    expect(received).not.toBeNull();
    expect(received!.tier).toBe("visual-coordinate");
    expect(received!.resolvedElementId).toBe("el-42");
    expect(received!.confidence).toBe(0.7);
    expect(received!.durationMs).toBe(150);
    expect(received!.query).toEqual({ role: "button" });
  });

  it("invokes callback once per emit", () => {
    let count = 0;
    const emitter = new CallbackTelemetryEmitter(() => {
      count++;
    });

    emitter.emit(createEvent());
    emitter.emit(createEvent());
    emitter.emit(createEvent());

    expect(count).toBe(3);
  });
});
