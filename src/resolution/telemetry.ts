/**
 * Telemetry emitters for resolution escalation events.
 *
 * Two implementations:
 * - `NoopTelemetryEmitter` — default, discards all events.
 * - `CallbackTelemetryEmitter` — forwards events to a caller-provided
 *   callback, which bridges to the runner's Rust event bus via WS/HTTP.
 */

import type { EscalationEvent, ResolutionTelemetryEmitter } from "./types";

// ---------------------------------------------------------------------------
// NoopTelemetryEmitter
// ---------------------------------------------------------------------------

/**
 * Default telemetry emitter that discards all events.
 *
 * Used when no telemetry sink is configured.
 */
export class NoopTelemetryEmitter implements ResolutionTelemetryEmitter {
  emit(_event: EscalationEvent): void {
    // Intentionally empty — no telemetry configured.
  }
}

// ---------------------------------------------------------------------------
// CallbackTelemetryEmitter
// ---------------------------------------------------------------------------

/**
 * Forwards escalation events to a caller-provided callback.
 *
 * The callback is invoked synchronously. If the runner needs to
 * debounce or buffer events, that is the callback's responsibility.
 *
 * @example
 * ```ts
 * const emitter = new CallbackTelemetryEmitter((event) => {
 *   wsClient.send("resolution.escalation", event);
 * });
 * ```
 */
export class CallbackTelemetryEmitter implements ResolutionTelemetryEmitter {
  constructor(
    private readonly callback: (event: EscalationEvent) => void,
  ) {}

  emit(event: EscalationEvent): void {
    this.callback(event);
  }
}
