/**
 * AI enhancement types — request/response schemas for LLM-assisted
 * static analysis of patterns the mechanical analyzer can't resolve.
 *
 * Three enhancement categories:
 * 1. Dynamic navigation: setActiveTab(variable) — enumerate possible values
 * 2. Unknown components: infer rendered elements from name/props
 * 3. Complex conditions: generate readable state variant names
 */

import type { ElementQuery } from "../../core/element-query";
import type { UncertainItem } from "../pipeline";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** AI enhancement configuration. */
export interface AIConfig {
  /** Enable AI enhancement (default false). */
  enabled: boolean;
  /** Model ID (e.g., "claude-sonnet-4-5-20250514"). */
  model: string;
  /** API key. Falls back to ANTHROPIC_API_KEY env var if not set. */
  apiKey?: string;
  /** Maximum tokens for each AI response (default 1024). */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** A request for AI analysis of uncertain items. */
export interface AIEnhancementRequest {
  /** The uncertain items to analyze. */
  items: UncertainItem[];
  /** Source code context for each item (keyed by sourceFile:line). */
  contexts: Map<string, string>;
}

/**
 * Context for a dynamic navigation analysis.
 * Sent when setActiveTab(variable) uses a non-literal argument.
 */
export interface DynamicNavigationContext {
  /** The variable name used as the argument. */
  variableName: string;
  /** Source code surrounding the call. */
  sourceSnippet: string;
  /** All known route IDs (for the AI to pick from). */
  knownRouteIds: string[];
}

/**
 * Context for an unknown component analysis.
 * Sent when a component can't be resolved to a source file.
 */
export interface UnknownComponentContext {
  /** The component name. */
  componentName: string;
  /** Props passed to the component in JSX. */
  props: string[];
  /** The route ID where this component appears. */
  routeId: string;
  /** Source snippet showing the component usage. */
  sourceSnippet: string;
}

/**
 * Context for a complex condition analysis.
 * Sent when a condition label is too complex for mechanical formatting.
 */
export interface ComplexConditionContext {
  /** The raw condition expression text. */
  conditionExpression: string;
  /** The route/state where this condition appears. */
  parentStateName: string;
  /** Source snippet showing the conditional rendering. */
  sourceSnippet: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** Combined response from AI enhancement. */
export interface AIEnhancementResult {
  /** Resolved dynamic navigation targets. */
  dynamicNavigations: DynamicNavigationResult[];
  /** Inferred elements for unknown components. */
  inferredElements: InferredElementsResult[];
  /** Improved condition labels. */
  improvedLabels: ImprovedLabelResult[];
  /** Items the AI could not resolve. */
  unresolved: UncertainItem[];
}

/** AI-resolved dynamic navigation target. */
export interface DynamicNavigationResult {
  /** The original uncertain item. */
  originalItem: UncertainItem;
  /** Possible target route IDs enumerated by the AI. */
  possibleTargets: string[];
  /** AI's confidence (0.0-1.0). */
  confidence: number;
  /** Brief explanation of the reasoning. */
  reasoning: string;
}

/** AI-inferred elements for an unknown component. */
export interface InferredElementsResult {
  /** The original uncertain item. */
  originalItem: UncertainItem;
  /** Inferred element queries that the component likely renders. */
  inferredElements: ElementQuery[];
  /** AI's confidence (0.0-1.0). */
  confidence: number;
  /** Brief explanation. */
  reasoning: string;
}

/** AI-improved condition label. */
export interface ImprovedLabelResult {
  /** The original condition expression. */
  originalLabel: string;
  /** AI-generated human-readable label. */
  improvedLabel: string;
}
