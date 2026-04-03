/**
 * AI analyzer — uses an LLM to resolve uncertain items that the
 * mechanical static analysis could not handle.
 *
 * Three capabilities:
 * 1. Enumerate possible values for dynamic navigation targets
 * 2. Infer rendered elements from component names and props
 * 3. Generate readable state variant names from complex conditions
 *
 * The analyzer is optional. When disabled, uncertain items pass through
 * unchanged with no AI calls made.
 *
 * Uses the Anthropic SDK (@anthropic-ai/sdk) for LLM calls.
 * The SDK is loaded dynamically to avoid requiring it as a hard dependency.
 */

import type { ElementQuery } from "../../core/element-query";
import type { UncertainItem } from "../pipeline";
import type {
  AIConfig,
  AIEnhancementResult,
  DynamicNavigationResult,
  InferredElementsResult,
  ImprovedLabelResult,
} from "./ai-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Interface for the AI client — abstracted for testing. */
export interface AIClient {
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

/** Options for AI enhancement. */
export interface AIEnhancementOptions {
  /** Known route IDs for navigation target enumeration. */
  knownRouteIds?: string[];
  /** Source code contexts keyed by "sourceFile:line". */
  contexts?: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

/**
 * Run AI enhancement on uncertain items.
 *
 * Groups items by type, constructs appropriate prompts, sends them
 * to the LLM, and parses the structured responses.
 *
 * @param items - Uncertain items from the mechanical analysis.
 * @param config - AI configuration (model, API key).
 * @param options - Additional context for the AI.
 * @returns Enhanced results with resolved items and remaining unresolved ones.
 */
export async function enhanceWithAI(
  items: UncertainItem[],
  config: AIConfig,
  options: AIEnhancementOptions = {},
): Promise<AIEnhancementResult> {
  if (!config.enabled || items.length === 0) {
    return {
      dynamicNavigations: [],
      inferredElements: [],
      improvedLabels: [],
      unresolved: items,
    };
  }

  const client = await createClient(config);
  return enhanceWithClient(items, client, options);
}

// ---------------------------------------------------------------------------
// Dynamic navigation resolution
// ---------------------------------------------------------------------------

async function processDynamicNavigations(
  client: AIClient,
  items: UncertainItem[],
  config: AIConfig,
  options: AIEnhancementOptions,
): Promise<DynamicNavigationResult[]> {
  if (items.length === 0) return [];

  const results: DynamicNavigationResult[] = [];

  for (const item of items) {
    const context = options.contexts?.get(`${item.sourceFile}:${item.line}`) ?? "";
    const routeIds = options.knownRouteIds ?? [];

    const prompt = buildDynamicNavPrompt(item, context, routeIds);
    try {
      const response = await client.complete(SYSTEM_PROMPT, prompt);
      const parsed = parseDynamicNavResponse(response, item);
      if (parsed) results.push(parsed);
    } catch {
      // AI call failed — item stays unresolved
    }
  }

  return results;
}

function buildDynamicNavPrompt(
  item: UncertainItem,
  context: string,
  routeIds: string[],
): string {
  return `Analyze this dynamic navigation call and enumerate all possible target route IDs.

Source file: ${item.sourceFile}
Line: ${item.line}
Description: ${item.description}

Source context:
\`\`\`tsx
${context}
\`\`\`

Known route IDs: ${routeIds.join(", ")}

Respond in JSON format:
{
  "possibleTargets": ["route-id-1", "route-id-2"],
  "confidence": 0.8,
  "reasoning": "Brief explanation"
}`;
}

function parseDynamicNavResponse(
  response: string,
  item: UncertainItem,
): DynamicNavigationResult | undefined {
  try {
    const json = extractJSON(response);
    if (!json) return undefined;

    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.possibleTargets)) return undefined;

    return {
      originalItem: item,
      possibleTargets: parsed.possibleTargets.filter(
        (t: unknown) => typeof t === "string",
      ),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Unknown component resolution
// ---------------------------------------------------------------------------

async function processUnknownComponents(
  client: AIClient,
  items: UncertainItem[],
  config: AIConfig,
  options: AIEnhancementOptions,
): Promise<InferredElementsResult[]> {
  if (items.length === 0) return [];

  const results: InferredElementsResult[] = [];

  for (const item of items) {
    const context = options.contexts?.get(`${item.sourceFile}:${item.line}`) ?? "";
    const prompt = buildUnknownComponentPrompt(item, context);

    try {
      const response = await client.complete(SYSTEM_PROMPT, prompt);
      const parsed = parseUnknownComponentResponse(response, item);
      if (parsed) results.push(parsed);
    } catch {
      // AI call failed — item stays unresolved
    }
  }

  return results;
}

function buildUnknownComponentPrompt(
  item: UncertainItem,
  context: string,
): string {
  return `Infer what DOM elements this React component likely renders based on its name and usage context. Focus on semantic elements that would have ARIA roles, aria-labels, or data attributes.

Source file: ${item.sourceFile}
Line: ${item.line}
Description: ${item.description}

Source context:
\`\`\`tsx
${context}
\`\`\`

Respond in JSON format:
{
  "inferredElements": [
    { "role": "heading", "text": "Example Title" },
    { "role": "button", "ariaLabel": "Submit" }
  ],
  "confidence": 0.6,
  "reasoning": "Brief explanation of what the component likely renders"
}

Only include elements you're reasonably confident about. Each element should have at least one of: role, ariaLabel, text, id, or attributes.`;
}

function parseUnknownComponentResponse(
  response: string,
  item: UncertainItem,
): InferredElementsResult | undefined {
  try {
    const json = extractJSON(response);
    if (!json) return undefined;

    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.inferredElements)) return undefined;

    const elements: ElementQuery[] = parsed.inferredElements
      .filter((e: Record<string, unknown>) => {
        return e.role || e.ariaLabel || e.text || e.id || e.attributes;
      })
      .map((e: Record<string, unknown>) => {
        const query: ElementQuery = {};
        if (typeof e.role === "string") query.role = e.role;
        if (typeof e.ariaLabel === "string") query.ariaLabel = e.ariaLabel;
        if (typeof e.text === "string") query.text = e.text;
        if (typeof e.id === "string") query.id = e.id;
        if (e.attributes && typeof e.attributes === "object") {
          query.attributes = e.attributes as Record<string, string>;
        }
        return query;
      });

    if (elements.length === 0) return undefined;

    return {
      originalItem: item,
      inferredElements: elements,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Complex condition label improvement
// ---------------------------------------------------------------------------

async function processComplexConditions(
  client: AIClient,
  items: UncertainItem[],
  config: AIConfig,
): Promise<ImprovedLabelResult[]> {
  if (items.length === 0) return [];

  // Batch all condition labels into one prompt for efficiency
  const labels = items.map((i) => i.description);
  const prompt = buildConditionLabelPrompt(labels);

  try {
    const response = await client.complete(SYSTEM_PROMPT, prompt);
    return parseConditionLabelResponse(response, labels);
  } catch {
    return [];
  }
}

function buildConditionLabelPrompt(labels: string[]): string {
  const labelList = labels.map((l, i) => `${i + 1}. \`${l}\``).join("\n");

  return `Convert these code condition expressions into short, human-readable state variant names. Each name should be 2-4 words, Title Case, describing what UI state the condition represents.

Conditions:
${labelList}

Respond in JSON format:
{
  "labels": [
    { "original": "the original expression", "improved": "Human Readable Name" }
  ]
}`;
}

function parseConditionLabelResponse(
  response: string,
  originalLabels: string[],
): ImprovedLabelResult[] {
  try {
    const json = extractJSON(response);
    if (!json) return [];

    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.labels)) return [];

    return parsed.labels
      .filter(
        (l: Record<string, unknown>) =>
          typeof l.original === "string" && typeof l.improved === "string",
      )
      .map((l: Record<string, string>) => ({
        originalLabel: l.original,
        improvedLabel: l.improved,
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// AI Client
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a React/TypeScript static analysis assistant. You analyze source code to help build UI state machines for automated testing. Your responses must be valid JSON matching the requested format. Be concise and precise.`;

/**
 * Create an AI client from config.
 * Dynamically imports the Anthropic SDK to avoid requiring it as a hard dependency.
 */
async function createClient(config: AIConfig): Promise<AIClient> {
  const apiKey =
    config.apiKey ??
    (typeof globalThis !== "undefined" &&
    "process" in globalThis &&
    (globalThis as any).process?.env?.ANTHROPIC_API_KEY) ??
    undefined;
  if (!apiKey) {
    throw new Error(
      "AI enhancement requires an API key. Set config.ai.apiKey or ANTHROPIC_API_KEY env var.",
    );
  }

  const maxTokens = config.maxTokens ?? 1024;

  // Dynamic import to avoid hard dependency on @anthropic-ai/sdk
  let Anthropic: any;
  try {
    // Dynamic import — @anthropic-ai/sdk is an optional peer dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = await (Function('return import("@anthropic-ai/sdk")')() as Promise<any>);
    Anthropic = module.default ?? module.Anthropic;
  } catch {
    throw new Error(
      "AI enhancement requires @anthropic-ai/sdk. Install it: npm install @anthropic-ai/sdk",
    );
  }

  const anthropic = new Anthropic({ apiKey });

  return {
    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      // Extract text from the response
      const textBlock = response.content.find(
        (b: { type: string }) => b.type === "text",
      );
      return textBlock?.text ?? "";
    },
  };
}

/**
 * Create an AI client from an explicit implementation (for testing).
 */
export function createMockClient(
  handler: (system: string, user: string) => Promise<string>,
): AIClient {
  return { complete: handler };
}

/**
 * Run AI enhancement with a custom client (for testing).
 */
export async function enhanceWithClient(
  items: UncertainItem[],
  client: AIClient,
  options: AIEnhancementOptions = {},
): Promise<AIEnhancementResult> {
  if (items.length === 0) {
    return {
      dynamicNavigations: [],
      inferredElements: [],
      improvedLabels: [],
      unresolved: items,
    };
  }

  const dynamicNav = items.filter((i) => i.type === "dynamic-navigation");
  const unknownComp = items.filter((i) => i.type === "unknown-component");
  const complexCond = items.filter((i) => i.type === "complex-condition");

  const mockConfig: AIConfig = { enabled: true, model: "mock" };

  const [navResults, elemResults, labelResults] = await Promise.all([
    processDynamicNavigations(client, dynamicNav, mockConfig, options),
    processUnknownComponents(client, unknownComp, mockConfig, options),
    processComplexConditions(client, complexCond, mockConfig),
  ]);

  const resolvedKeys = new Set<string>();
  for (const r of navResults) resolvedKeys.add(itemKey(r.originalItem));
  for (const r of elemResults) resolvedKeys.add(itemKey(r.originalItem));

  // Track complex-condition items that got labels
  for (const label of labelResults) {
    const matchingItem = complexCond.find(
      (i) => i.description === label.originalLabel,
    );
    if (matchingItem) resolvedKeys.add(itemKey(matchingItem));
  }

  return {
    dynamicNavigations: navResults,
    inferredElements: elemResults,
    improvedLabels: labelResults,
    unresolved: items.filter((i) => !resolvedKeys.has(itemKey(i))),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique key for an uncertain item. */
function itemKey(item: UncertainItem): string {
  return `${item.type}|${item.sourceFile}|${item.line}`;
}

/** Extract JSON from a response that may contain markdown code fences. */
function extractJSON(text: string): string | undefined {
  // Try to find JSON in code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try to find bare JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return undefined;
}
