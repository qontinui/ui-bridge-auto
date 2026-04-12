/**
 * Element resolution fallback system.
 *
 * Provides ref IDs for stable snapshot-to-action element targeting,
 * an opt-in escalation chain (DOM → accessibility → visual), and
 * telemetry for escalation events.
 */

// Types
export type {
  RefId,
  ResolvedRef,
  RefInvalidationReason,
  RefRecord,
  EscalationTier,
  EscalationEvent,
  ResolutionTelemetryEmitter,
  EscalationConfig,
} from "./types";
export { RefInvalidatedError } from "./types";

// Ref registry
export { RefRegistry, type RefRegistryOptions } from "./ref-registry";

// Telemetry
export { NoopTelemetryEmitter, CallbackTelemetryEmitter } from "./telemetry";

// Escalating resolver
export {
  EscalatingResolver,
  type EscalatingResolverConfig,
} from "./escalating-resolver";
