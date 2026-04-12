/**
 * Types for the element resolution fallback system.
 *
 * Defines ref IDs for stable snapshot-to-action element targeting,
 * escalation tiers for fallback resolution, telemetry events, and
 * configuration for the escalating resolver.
 */

import type { ElementQuery } from "../core/element-query";
import type { ElementFingerprint } from "../discovery/element-fingerprint";

// ---------------------------------------------------------------------------
// Reference IDs
// ---------------------------------------------------------------------------

/** Opaque handle issued at snapshot time. Format: `ref-{snapshotTs}-{sequence}`. */
export type RefId = string;

/** Outcome when a ref is successfully resolved to a live DOM node. */
export interface ResolvedRef {
  /** The ref ID that was resolved. */
  refId: RefId;
  /** Live registry element ID. */
  elementId: string;
  /** Stable ID of the resolved element. */
  stableId: string;
  /** The live DOM element. */
  element: HTMLElement;
  /** Which resolution pass succeeded. */
  resolvedVia: "exact" | "stableId" | "fingerprint";
}

/** Reason a ref could not be resolved. */
export type RefInvalidationReason = "not-found" | "ambiguous" | "stale-snapshot";

/**
 * Thrown when a ref cannot be matched to a live DOM node.
 *
 * Callers should react based on `reason`:
 * - `not-found`: element is gone — re-snapshot and retry.
 * - `ambiguous`: multiple candidates — query needs narrowing.
 * - `stale-snapshot`: snapshot is too old — re-capture immediately.
 */
export class RefInvalidatedError extends Error {
  override readonly name = "RefInvalidatedError";

  constructor(
    public readonly refId: RefId,
    public readonly reason: RefInvalidationReason,
  ) {
    super(`Ref ${refId} invalidated: ${reason}`);
  }
}

/** Internal record stored by RefRegistry for each assigned ref. */
export interface RefRecord {
  refId: RefId;
  fingerprint: ElementFingerprint;
  stableId: string;
  registryIdAtCapture: string;
  capturedAt: number;
}

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

/** The five resolution tiers in the escalation chain. */
export type EscalationTier =
  | "dom-query"
  | "ctr"
  | "search-engine"
  | "accessibility-tree"
  | "visual-coordinate";

/** Emitted after an escalation attempt (success or exhaustion). */
export interface EscalationEvent {
  /** When the escalation completed (epoch ms). */
  timestamp: number;
  /** The original query that failed the deterministic path. */
  query: ElementQuery;
  /** Which tier succeeded, or `"exhausted"` if all tiers failed. */
  tier: EscalationTier | "exhausted";
  /** Live registry ID of the resolved element (when tier !== "exhausted"). */
  resolvedElementId?: string;
  /** Confidence at the tier that resolved (0-1). */
  confidence?: number;
  /** Duration of the full escalation chain (ms). */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

/** Pluggable telemetry sink for escalation events. */
export interface ResolutionTelemetryEmitter {
  /** Emit an escalation event. Implementations must not throw. */
  emit(event: EscalationEvent): void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for EscalatingResolver. */
export interface EscalationConfig {
  /** Minimum confidence for the accessibility-tree tier to accept a match. Default: 0.75. */
  accessibilityThreshold?: number;
  /** Minimum confidence for the visual-coordinate tier to accept a match. Default: 0.6. */
  visualThreshold?: number;
  /** Minimum confidence for the SearchEngine tier to accept a match. Default: 0.7. */
  searchThreshold?: number;
  /** Telemetry sink. Defaults to no-op. */
  telemetry?: ResolutionTelemetryEmitter;
}
