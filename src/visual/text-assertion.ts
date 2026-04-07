/**
 * OCR-Based Text Assertions
 *
 * Provides text extraction and assertion for both DOM elements and media
 * elements (canvas, img, video, svg). DOM elements use cheap `textContent`
 * access; media elements delegate to a pluggable {@link IOCRProvider} for
 * OCR-based text extraction.
 *
 * @example
 * ```ts
 * // Assert text in a DOM element (uses textContent)
 * const result = await assertTextInElement(
 *   { text: "Submit" },
 *   "Submit Order",
 *   registry,
 * );
 *
 * // Extract text from a canvas via OCR
 * const { text, source } = await extractElementText(
 *   canvasElement,
 *   "chart-1",
 *   { ocrProvider: myTesseractProvider },
 * );
 * ```
 */

import { captureMediaSnapshot } from "@qontinui/ui-bridge";
import type { ElementQuery, QueryableElement } from "../core/element-query";
import { findFirst } from "../core/element-query";
import { similarity } from "../core/fuzzy-match";
import type { RegistryLike } from "../state/state-detector";
import type {
  IOCRProvider,
  TextRegion,
  TextAssertionOptions,
  TextAssertionResult,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Media element tags — imported from shared types.
import { MEDIA_ELEMENT_TAGS } from "./types";

/** Default assertion options. */
const ASSERTION_DEFAULTS: Required<Omit<TextAssertionOptions, "ocrProvider">> & {
  ocrProvider: IOCRProvider | undefined;
} = {
  caseSensitive: false,
  fuzzyThreshold: 0.8,
  timeout: 0,
  ocrProvider: undefined,
  maxSize: 512,
};

// ---------------------------------------------------------------------------
// Text extraction result
// ---------------------------------------------------------------------------

/** Result of extracting text from an element. */
export interface TextExtractionResult {
  /** The extracted text content. */
  text: string;
  /** How the text was extracted. */
  source: "dom" | "ocr";
  /** Detected text regions (OCR path only). */
  regions?: TextRegion[];
}

// ---------------------------------------------------------------------------
// Helper: check if element is a media element
// ---------------------------------------------------------------------------

/**
 * Check whether an element is a media element that requires OCR for text
 * extraction.
 */
function isMediaElement(element: HTMLElement): boolean {
  return MEDIA_ELEMENT_TAGS.has(element.tagName.toLowerCase());
}

// ---------------------------------------------------------------------------
// extractElementText
// ---------------------------------------------------------------------------

/**
 * Extract text content from a DOM or media element.
 *
 * For standard DOM elements (div, p, button, input, etc.), returns the
 * element's `textContent` — cheap and synchronous under the hood.
 *
 * For media elements (canvas, img, video, svg), captures a visual snapshot
 * via `captureMediaSnapshot` and delegates to the provided `IOCRProvider`
 * for text extraction. If no provider is supplied, returns empty text.
 *
 * @param element - The DOM element to extract text from.
 * @param elementId - The element's identifier (for snapshot capture).
 * @param options - Optional OCR provider and capture settings.
 * @returns The extracted text and its source.
 */
export async function extractElementText(
  element: HTMLElement,
  elementId: string,
  options?: {
    ocrProvider?: IOCRProvider;
    maxSize?: number;
  },
): Promise<TextExtractionResult> {
  // DOM elements: use textContent directly
  if (!isMediaElement(element)) {
    return {
      text: element.textContent?.trim() ?? "",
      source: "dom",
    };
  }

  // Media elements: need OCR
  const provider = options?.ocrProvider;
  if (!provider) {
    return {
      text: "",
      source: "ocr",
    };
  }

  const maxSize = options?.maxSize ?? ASSERTION_DEFAULTS.maxSize;
  const snapshot = captureMediaSnapshot(element, elementId, maxSize);
  if (!snapshot) {
    return {
      text: "",
      source: "ocr",
    };
  }

  const text = await provider.extractText(
    snapshot.data,
    snapshot.width,
    snapshot.height,
  );

  // Optionally get text regions if the provider supports it
  let regions: TextRegion[] | undefined;
  if (provider.getTextRegions) {
    regions = await provider.getTextRegions(
      snapshot.data,
      snapshot.width,
      snapshot.height,
    );
  }

  return {
    text: text.trim(),
    source: "ocr",
    regions,
  };
}

// ---------------------------------------------------------------------------
// assertTextInElement
// ---------------------------------------------------------------------------

/**
 * Assert that an element contains the expected text.
 *
 * Finds the element by query, extracts its text content (via DOM or OCR),
 * and compares it against the expected text using exact or fuzzy matching.
 *
 * @param query - Element query to locate the target element.
 * @param expectedText - The text expected to be in the element.
 * @param registry - The element registry.
 * @param options - Assertion options (case sensitivity, fuzzy threshold, OCR provider).
 * @returns The assertion result with pass/fail, actual text, confidence, etc.
 */
export async function assertTextInElement(
  query: ElementQuery,
  expectedText: string,
  registry: RegistryLike,
  options?: TextAssertionOptions,
): Promise<TextAssertionResult> {
  const opts = { ...ASSERTION_DEFAULTS, ...options };
  const deadline = opts.timeout > 0 ? Date.now() + opts.timeout : 0;
  const pollInterval = 100;

  // Retry loop: attempt at least once, retry until timeout if configured.
   
  while (true) {
    const attempt = await attemptTextAssertion(query, expectedText, registry, opts);

    // Return immediately on pass, or if no timeout configured.
    if (attempt.pass || deadline === 0 || Date.now() >= deadline) {
      return attempt;
    }

    // Wait before retrying.
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }
}

/** Single attempt of text assertion (no retry). */
async function attemptTextAssertion(
  query: ElementQuery,
  expectedText: string,
  registry: RegistryLike,
  opts: Required<Omit<TextAssertionOptions, "ocrProvider">> & { ocrProvider: IOCRProvider | undefined },
): Promise<TextAssertionResult> {
  // Find element
  const elements: QueryableElement[] = registry.getAllElements();
  const result = findFirst(elements, query);
  if (!result) {
    return {
      pass: false,
      actualText: "",
      expectedText,
      matchType: "dom",
      confidence: 0,
      error: "Element not found",
    };
  }

  // Get the HTMLElement from the registry
  const registryElement = elements.find((el) => el.id === result.id);
  if (!registryElement) {
    return {
      pass: false,
      actualText: "",
      expectedText,
      matchType: "dom",
      confidence: 0,
      error: "Element not found in registry",
    };
  }

  // Extract text
  const extraction = await extractElementText(
    registryElement.element,
    registryElement.id,
    {
      ocrProvider: opts.ocrProvider,
      maxSize: opts.maxSize,
    },
  );

  // If media element with no provider and no text, report the error
  if (extraction.source === "ocr" && !extraction.text && !opts.ocrProvider) {
    return {
      pass: false,
      actualText: "",
      expectedText,
      matchType: "ocr",
      confidence: 0,
      regions: extraction.regions,
      error: "No OCR provider configured for media element",
    };
  }

  // Compare text
  const actualText = extraction.text;
  let pass: boolean;
  let confidence: number;

  if (opts.caseSensitive) {
    // Exact case-sensitive match
    pass = actualText === expectedText;
    confidence = pass ? 1.0 : similarity(actualText, expectedText);
  } else {
    // Case-insensitive comparison with fuzzy threshold
    const normalizedActual = actualText.toLowerCase();
    const normalizedExpected = expectedText.toLowerCase();

    if (normalizedActual === normalizedExpected) {
      pass = true;
      confidence = 1.0;
    } else {
      confidence = similarity(normalizedActual, normalizedExpected);
      pass = confidence >= opts.fuzzyThreshold;
    }
  }

  return {
    pass,
    actualText,
    expectedText,
    matchType: extraction.source,
    confidence,
    regions: extraction.regions,
  };
}
