/**
 * Opt-in escalating element resolver for web-based automation.
 *
 * Wraps `ActionExecutor` with a three-tier fallback chain that activates
 * only when the deterministic DOM query fails:
 *
 * 1. **DOM query** — delegates to `ActionExecutor.execute()` (deterministic).
 * 2. **Accessibility-tree** — uses `ElementRelocator.findAlternative()` with
 *    ARIA labels, fuzzy text, and role matching.
 * 3. **Visual coordinate** — spatial centroid scan against `query.within`
 *    bounds combined with structural fingerprint matching.
 *
 * The default `ActionExecutor` path is never modified — this class is the
 * opt-in surface for consumers who want resilient element resolution.
 */

import type { ElementQuery, QueryableElement } from "../core/element-query";
import type { ActionType } from "../types/transition";
import type { ActionRecord } from "../types/action";
import type { ActionExecutor, ExecuteOptions } from "../actions/action-executor";
import { ElementRelocator } from "../healing/element-relocator";
import { computeFingerprint } from "../discovery/element-fingerprint";
import type {
  EscalationConfig,
  EscalationEvent,
  EscalationTier,
  ResolutionTelemetryEmitter,
} from "./types";
import { NoopTelemetryEmitter } from "./telemetry";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ACCESSIBILITY_THRESHOLD = 0.75;
const DEFAULT_VISUAL_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// EscalatingResolver
// ---------------------------------------------------------------------------

/** Full configuration passed to the EscalatingResolver constructor. */
export interface EscalatingResolverConfig extends EscalationConfig {
  /** Registry for live element access. */
  registry: { getAllElements(): QueryableElement[] };
  /** The underlying deterministic executor. */
  executor: ActionExecutor;
}

/**
 * Wraps `ActionExecutor` with a three-tier escalation chain.
 *
 * On deterministic success (Tier 1), no escalation event is emitted.
 * When escalation triggers, exactly one `EscalationEvent` is emitted
 * recording which tier resolved (or `"exhausted"` if all failed).
 */
export class EscalatingResolver {
  private readonly registry: { getAllElements(): QueryableElement[] };
  private readonly executor: ActionExecutor;
  private readonly relocator: ElementRelocator;
  private readonly accessibilityThreshold: number;
  private readonly visualThreshold: number;
  private readonly telemetry: ResolutionTelemetryEmitter;

  constructor(config: EscalatingResolverConfig) {
    this.registry = config.registry;
    this.executor = config.executor;
    this.relocator = new ElementRelocator(config.registry);
    this.accessibilityThreshold =
      config.accessibilityThreshold ?? DEFAULT_ACCESSIBILITY_THRESHOLD;
    this.visualThreshold =
      config.visualThreshold ?? DEFAULT_VISUAL_THRESHOLD;
    this.telemetry = config.telemetry ?? new NoopTelemetryEmitter();
  }

  /**
   * Execute an action with escalation fallbacks.
   *
   * Tries the deterministic DOM query first. If that fails, escalates
   * through accessibility-tree and visual-coordinate tiers before
   * returning the original failure.
   */
  async execute(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<ActionRecord> {
    const started = Date.now();

    // Tier 1: deterministic DOM query.
    const tier1Result = await this.executor.execute(query, action, params, options);
    if (tier1Result.status !== "failed") {
      // Deterministic path succeeded — no escalation, no telemetry.
      return tier1Result;
    }

    // Tier 2: accessibility-tree query via ElementRelocator.
    const tier2Result = await this.tryAccessibilityTier(
      query,
      action,
      params,
      options,
    );
    if (tier2Result) {
      this.emitEvent(query, "accessibility-tree", tier2Result, started);
      return tier2Result.record;
    }

    // Tier 3: visual coordinate match (only if spatial anchor exists).
    const tier3Result = await this.tryVisualCoordinateTier(
      query,
      action,
      params,
      options,
    );
    if (tier3Result) {
      this.emitEvent(query, "visual-coordinate", tier3Result, started);
      return tier3Result.record;
    }

    // All tiers exhausted — emit event, return original failure.
    this.emitEvent(query, "exhausted", null, started);
    return tier1Result;
  }

  // -------------------------------------------------------------------------
  // Tier 2: Accessibility-tree
  // -------------------------------------------------------------------------

  private async tryAccessibilityTier(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<TierResult | null> {
    const alternative = this.relocator.findAlternative(query);
    if (!alternative) return null;
    if (alternative.confidence < this.accessibilityThreshold) return null;

    const record = await this.executor.executeById(
      alternative.element.id,
      action,
      params,
      options,
    );

    if (record.status === "failed") return null;

    return {
      record,
      elementId: alternative.element.id,
      confidence: alternative.confidence,
    };
  }

  // -------------------------------------------------------------------------
  // Tier 3: Visual coordinate
  // -------------------------------------------------------------------------

  private async tryVisualCoordinateTier(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<TierResult | null> {
    // Guard: skip if no spatial anchor.
    if (!query.within) return null;

    const elements = this.registry.getAllElements();
    if (elements.length === 0) return null;

    const bounds = query.within;
    const boundsCenter = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };

    // Find elements whose centroid falls inside the query bounds.
    let bestCandidate: QueryableElement | null = null;
    let bestConfidence = 0;

    for (const el of elements) {
      const state = el.getState();
      const rect = state.rect;
      if (!rect) continue;

      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;

      // Check if centroid is inside the query bounds.
      const insideBounds =
        centerX >= bounds.x &&
        centerX <= bounds.x + bounds.width &&
        centerY >= bounds.y &&
        centerY <= bounds.y + bounds.height;

      if (!insideBounds) continue;

      // Base confidence: spatial proximity to bounds center (closer = higher).
      const dx = centerX - boundsCenter.x;
      const dy = centerY - boundsCenter.y;
      const maxDist = Math.sqrt(
        (bounds.width / 2) ** 2 + (bounds.height / 2) ** 2,
      );
      const dist = Math.sqrt(dx * dx + dy * dy);
      let confidence = maxDist > 0 ? 1 - dist / maxDist : 1;

      // Boost confidence if structural fingerprint matches any query hints.
      if (query.role || query.tagName) {
        const fp = computeFingerprint(el.element);
        const roleMatch = query.role ? fp.role === query.role : false;
        const tagMatch = query.tagName
          ? fp.tagName === query.tagName.toLowerCase()
          : false;

        if (roleMatch) confidence = Math.min(1, confidence + 0.15);
        if (tagMatch) confidence = Math.min(1, confidence + 0.1);
      }

      // Scale to 0.4-1.0 range (pure spatial match floors at 0.4).
      confidence = 0.4 + confidence * 0.6;

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestCandidate = el;
      }
    }

    if (!bestCandidate || bestConfidence < this.visualThreshold) return null;

    const record = await this.executor.executeById(
      bestCandidate.id,
      action,
      params,
      options,
    );

    if (record.status === "failed") return null;

    return {
      record,
      elementId: bestCandidate.id,
      confidence: bestConfidence,
    };
  }

  // -------------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------------

  private emitEvent(
    query: ElementQuery,
    tier: EscalationTier | "exhausted",
    result: TierResult | null,
    startedAt: number,
  ): void {
    const event: EscalationEvent = {
      timestamp: Date.now(),
      query,
      tier,
      resolvedElementId: result?.elementId,
      confidence: result?.confidence,
      durationMs: Date.now() - startedAt,
    };
    this.telemetry.emit(event);
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TierResult {
  record: ActionRecord;
  elementId: string;
  confidence: number;
}
