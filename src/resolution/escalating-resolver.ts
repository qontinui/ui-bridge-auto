/**
 * Opt-in escalating element resolver for web-based automation.
 *
 * Wraps `ActionExecutor` with a five-tier fallback chain that activates
 * only when the deterministic DOM query fails:
 *
 * 1. **DOM query** — delegates to `ActionExecutor.execute()` (deterministic).
 * 2. **CTR** — `CentralTargetRegistry.resolveInDOM()` for self-healing selector
 *    resolution (optional; skipped if no CTR provided or no logical name derivable).
 * 3. **SearchEngine** — `SearchEngine.findBest()` with multi-strategy search
 *    using text, role, ARIA, and fuzzy matching (optional; skipped if not provided).
 * 4. **Accessibility-tree** — uses `ElementRelocator.findAlternative()` with
 *    ARIA labels, fuzzy text, and role matching.
 * 5. **Visual coordinate** — spatial centroid scan against `query.within`
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
import type { CentralTargetRegistry, SearchEngine, SearchCriteria, SearchResult } from "@qontinui/ui-bridge";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_ACCESSIBILITY_THRESHOLD = 0.75;
const DEFAULT_VISUAL_THRESHOLD = 0.6;
const DEFAULT_SEARCH_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// EscalatingResolver
// ---------------------------------------------------------------------------

/** Full configuration passed to the EscalatingResolver constructor. */
export interface EscalatingResolverConfig extends EscalationConfig {
  /** Registry for live element access. */
  registry: { getAllElements(): QueryableElement[] };
  /** The underlying deterministic executor. */
  executor: ActionExecutor;
  /** Optional: CTR for self-healing selector resolution. */
  ctr?: CentralTargetRegistry;
  /** Optional: SearchEngine for multi-strategy search. */
  searchEngine?: SearchEngine;
}

/**
 * Wraps `ActionExecutor` with a five-tier escalation chain.
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
  private readonly searchThreshold: number;
  private readonly telemetry: ResolutionTelemetryEmitter;
  private readonly ctr: CentralTargetRegistry | undefined;
  private readonly searchEngine: SearchEngine | undefined;

  constructor(config: EscalatingResolverConfig) {
    this.registry = config.registry;
    this.executor = config.executor;
    this.relocator = new ElementRelocator(config.registry);
    this.accessibilityThreshold =
      config.accessibilityThreshold ?? DEFAULT_ACCESSIBILITY_THRESHOLD;
    this.visualThreshold =
      config.visualThreshold ?? DEFAULT_VISUAL_THRESHOLD;
    this.searchThreshold =
      config.searchThreshold ?? DEFAULT_SEARCH_THRESHOLD;
    this.telemetry = config.telemetry ?? new NoopTelemetryEmitter();
    this.ctr = config.ctr;
    this.searchEngine = config.searchEngine;
  }

  /**
   * Execute an action with escalation fallbacks.
   *
   * Tries the deterministic DOM query first. If that fails, escalates
   * through CTR, SearchEngine, accessibility-tree, and visual-coordinate
   * tiers before returning the original failure.
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

    // Tier 1.5: CTR self-healing selector resolution.
    const ctrResult = await this.tryCtrTier(query, action, params, options);
    if (ctrResult) {
      this.emitEvent(query, "ctr", ctrResult, started);
      return ctrResult.record;
    }

    // Tier 2: SearchEngine multi-strategy search.
    const searchResult = await this.trySearchEngineTier(query, action, params, options);
    if (searchResult) {
      this.emitEvent(query, "search-engine", searchResult, started);
      return searchResult.record;
    }

    // Tier 3: ElementRelocator accessibility-tree fallback.
    const tier3Result = await this.tryAccessibilityTier(query, action, params, options);
    if (tier3Result) {
      this.emitEvent(query, "accessibility-tree", tier3Result, started);
      return tier3Result.record;
    }

    // Tier 4: Visual coordinate scan (requires spatial anchor).
    const tier4Result = await this.tryVisualCoordinateTier(query, action, params, options);
    if (tier4Result) {
      this.emitEvent(query, "visual-coordinate", tier4Result, started);
      return tier4Result.record;
    }

    // All tiers exhausted.
    this.emitEvent(query, "exhausted", null, started);
    return tier1Result;
  }

  // -------------------------------------------------------------------------
  // Tier 1.5: CTR
  // -------------------------------------------------------------------------

  private async tryCtrTier(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<TierResult | null> {
    if (!this.ctr) return null;

    const logicalName = this.queryToLogicalName(query);
    if (logicalName === null) return null;

    const result = this.ctr.resolveInDOM(logicalName);
    if (!result.resolved || !result.element) return null;

    const registryEl = this.registry.getAllElements().find(
      (el) => el.element === result.element,
    );
    if (!registryEl) return null;

    const record = await this.executor.executeById(registryEl.id, action, params, options);
    if (record.status === "failed") return null;

    return { record, elementId: registryEl.id, confidence: 0.95 };
  }

  // -------------------------------------------------------------------------
  // Tier 2: SearchEngine
  // -------------------------------------------------------------------------

  private async trySearchEngineTier(
    query: ElementQuery,
    action: ActionType,
    params?: Record<string, unknown>,
    options?: ExecuteOptions,
  ): Promise<TierResult | null> {
    if (!this.searchEngine) return null;

    const criteria = this.queryToSearchCriteria(query);
    const result: SearchResult | null = this.searchEngine.findBest(criteria);
    if (!result || result.confidence < this.searchThreshold) return null;

    const registryEl = this.registry.getAllElements().find(
      (el) => el.id === result.element.id,
    );
    if (!registryEl) return null;

    const record = await this.executor.executeById(registryEl.id, action, params, options);
    if (record.status === "failed") return null;

    return { record, elementId: registryEl.id, confidence: result.confidence };
  }

  // -------------------------------------------------------------------------
  // Tier 3: Accessibility-tree
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
  // Tier 4: Visual coordinate
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

      // Scale to 0.4-1.0 range (pure spatial match floors at 0.4).
      // This must happen before fingerprint boosts so the final value stays in 0-1.
      confidence = 0.4 + confidence * 0.6;

      // Boost confidence if structural fingerprint matches any query hints.
      // Applied after scaling so the overall result remains in the 0-1 range.
      if (query.role || query.tagName) {
        const fp = computeFingerprint(el.element);
        const roleMatch = query.role ? fp.role === query.role : false;
        const tagMatch = query.tagName
          ? fp.tagName === query.tagName.toLowerCase()
          : false;

        if (roleMatch) confidence = Math.min(1, confidence + 0.15);
        if (tagMatch) confidence = Math.min(1, confidence + 0.1);
      }

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
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Derive a logical name from a query for CTR lookup.
   * Returns null if no usable identifier is present.
   *
   * Priority: id > ariaLabel > text.
   * ariaLabel is preferred over text because it is a stable semantic identifier
   * that survives localisation and copy changes; display text may be dynamic.
   */
  private queryToLogicalName(query: ElementQuery): string | null {
    if (typeof query.id === "string") return query.id;
    if (query.ariaLabel !== undefined) return query.ariaLabel;
    if (query.text !== undefined) return query.text;
    return null;
  }

  /**
   * Map an ElementQuery to SearchCriteria for the SearchEngine tier.
   * Only sets fields that have values — undefined fields are omitted.
   */
  private queryToSearchCriteria(query: ElementQuery): SearchCriteria {
    const criteria: SearchCriteria = {};

    if (typeof query.text === "string") criteria.text = query.text;
    if (query.textContains !== undefined) criteria.textContains = query.textContains;
    if (query.ariaLabel !== undefined) criteria.accessibleName = query.ariaLabel;
    if (query.role !== undefined) criteria.role = query.role;
    if (query.tagName !== undefined) criteria.selector = query.tagName;
    if (query.fuzzyText !== undefined) criteria.fuzzy = true;
    if (query.fuzzyThreshold !== undefined) criteria.fuzzyThreshold = query.fuzzyThreshold;

    return criteria;
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
    // Capture once so timestamp and durationMs are consistent.
    const now = Date.now();
    const event: EscalationEvent = {
      timestamp: now,
      query,
      tier,
      resolvedElementId: result?.elementId,
      confidence: result?.confidence,
      durationMs: now - startedAt,
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
