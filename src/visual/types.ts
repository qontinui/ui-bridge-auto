/**
 * Shared types for the visual module — highlights, OCR text assertions,
 * coordinate translation, and screenshot comparison.
 */

import type { ViewportRegion } from "../types/region";
import type { MediaSnapshotData } from "@qontinui/ui-bridge";

// Re-export for convenience within the visual module
export type { ViewportRegion } from "../types/region";

// Re-export media-snapshot types from UI Bridge SDK
export type {
  MediaSnapshotData,
  MediaComparisonResult,
  ElementCaptureOptions,
  VisualRegressionOptions,
  VisualRegressionResult,
} from "@qontinui/ui-bridge";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** HTML tags treated as media elements requiring special capture (OCR, screenshots). */
export const MEDIA_ELEMENT_TAGS = new Set(["canvas", "img", "video", "svg"]);

// ---------------------------------------------------------------------------
// Feature 1: Element Highlight
// ---------------------------------------------------------------------------

/** Options for highlighting an element or region. */
export interface HighlightOptions {
  /** CSS color for the highlight border. Default: '#00c800' (green). */
  color?: string;
  /** Duration in milliseconds before the highlight auto-dismisses. Default: 800. */
  duration?: number;
  /** Border thickness in pixels. Default: 3. */
  thickness?: number;
  /** Enable flash (blink) animation. Default: false. */
  flash?: boolean;
  /** Flash interval in milliseconds per cycle. Default: 200. */
  flashInterval?: number;
  /** Optional text label displayed above the highlight box. */
  label?: string;
  /** Overlay opacity (0-1). Default: 0.7. */
  opacity?: number;
}

/** A currently-active highlight overlay. */
export interface ActiveHighlight {
  /** Unique highlight identifier. */
  id: string;
  /** The element ID being highlighted (if from registry). */
  elementId?: string;
  /** The highlighted viewport region. */
  region: ViewportRegion;
  /** Resolved options used for this highlight. */
  options: Required<HighlightOptions>;
  /** The overlay DOM element. */
  domElement: HTMLDivElement;
  /** The label DOM element (if label was specified). */
  labelElement?: HTMLDivElement;
  /** Timer ID for auto-dismiss. */
  timerId: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Feature 2: OCR-Based Text Assertions
// ---------------------------------------------------------------------------

/** A region of detected text with location and confidence. */
export interface TextRegion {
  /** The detected text content. */
  text: string;
  /** X offset from image left (px). */
  x: number;
  /** Y offset from image top (px). */
  y: number;
  /** Region width (px). */
  width: number;
  /** Region height (px). */
  height: number;
  /** Detection confidence (0-1). */
  confidence: number;
}

/** A matched text occurrence with similarity score. */
export interface TextMatch {
  /** The matched text content. */
  text: string;
  /** The region where the text was found. */
  region: TextRegion;
  /** Similarity to the search text (0-1). */
  similarity: number;
}

/**
 * Pluggable OCR backend interface.
 *
 * Browser implementations can use Tesseract.js, server-side delegation,
 * or LLM-based text extraction. No OCR library is shipped with this package.
 */
export interface IOCRProvider {
  /** Extract all text from a base64-encoded image. */
  extractText(imageData: string, width: number, height: number): Promise<string>;
  /** Extract text regions with bounding boxes and confidence. Optional. */
  getTextRegions?(imageData: string, width: number, height: number): Promise<TextRegion[]>;
}

/** Options for text assertion operations. */
export interface TextAssertionOptions {
  /** Whether comparison is case-sensitive. Default: false. */
  caseSensitive?: boolean;
  /** Fuzzy match threshold (0-1). Default: 0.8. */
  fuzzyThreshold?: number;
  /** Timeout in ms for retrying the assertion. Default: 0 (no retry). */
  timeout?: number;
  /** Pluggable OCR backend for media elements. */
  ocrProvider?: IOCRProvider;
  /** Max dimension for snapshot capture (px). Default: 512. */
  maxSize?: number;
}

/** Result of a text assertion. */
export interface TextAssertionResult {
  /** Whether the assertion passed. */
  pass: boolean;
  /** The text actually found in the element. */
  actualText: string;
  /** The expected text. */
  expectedText: string;
  /** How the text was extracted. */
  matchType: "dom" | "ocr";
  /** Match confidence (1.0 for exact DOM match, 0-1 for OCR/fuzzy). */
  confidence: number;
  /** Detected text regions (OCR path only). */
  regions?: TextRegion[];
  /** Error message if assertion could not be performed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Feature 3: Coordinate Translation
// ---------------------------------------------------------------------------

/** A point in a 2D coordinate space. */
export interface CoordinatePoint {
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
}

/** Named coordinate spaces supported by the translator. */
export type CoordinateSpace = "viewport" | "page" | "screen" | "element";

/** Record of a coordinate translation operation. */
export interface CoordinateTranslation {
  /** Source coordinate space. */
  from: CoordinateSpace;
  /** Target coordinate space. */
  to: CoordinateSpace;
  /** Input point. */
  point: CoordinatePoint;
  /** Translated result. */
  result: CoordinatePoint;
}

/** Current scroll position of the document. */
export interface ScrollInfo {
  /** Horizontal scroll offset (px). */
  scrollX: number;
  /** Vertical scroll offset (px). */
  scrollY: number;
}

/** Offset introduced by an iframe boundary. */
export interface FrameOffset {
  /** Horizontal offset of the iframe (px). */
  x: number;
  /** Vertical offset of the iframe (px). */
  y: number;
  /** The iframe element producing this offset. */
  frameElement: HTMLIFrameElement;
}

// ---------------------------------------------------------------------------
// Feature 4: Screenshot Comparison
// ---------------------------------------------------------------------------

/**
 * Pluggable baseline storage for screenshot comparison.
 *
 * Ships with InMemoryBaselineStore for testing/ephemeral use.
 * Consumers can provide IndexedDB, localStorage, or server-backed stores.
 */
export interface BaselineStore {
  /** Save a snapshot under the given key. */
  save(key: string, snapshot: MediaSnapshotData): Promise<void>;
  /** Load a snapshot by key, or null if not found. */
  load(key: string): Promise<MediaSnapshotData | null>;
  /** Check whether a key exists. */
  exists(key: string): Promise<boolean>;
  /** Delete a snapshot by key. Returns true if deleted, false if not found. */
  delete(key: string): Promise<boolean>;
  /** List all stored keys. */
  listKeys(): Promise<string[]>;
}

/** Options for screenshot assertion operations. */
export interface ScreenshotAssertionOptions {
  /** Per-pixel color difference tolerance (0-255). Default: 10. */
  pixelThreshold?: number;
  /** Maximum allowed diff percentage or pixel count. Default: 0.1. */
  failureThreshold?: number;
  /** Whether failureThreshold is a 'percent' of total pixels or an absolute 'pixel' count. Default: 'percent'. */
  failureThresholdType?: "percent" | "pixel";
  /** Gaussian-like blur radius for anti-aliasing tolerance. Default: 0 (disabled). */
  blur?: number;
  /** Maximum dimension for snapshot capture (px). Default: 1024. */
  maxSize?: number;
  /** Key for baseline store lookup. Auto-generated from element ID if omitted. */
  baselineKey?: string;
  /** Save current capture as new baseline (overwriting any existing one). Default: false. */
  updateBaseline?: boolean;
  /** Regions to mask/ignore during comparison. */
  maskRegions?: ViewportRegion[];
}

/** Result of a screenshot assertion. */
export interface ScreenshotAssertionResult {
  /** Whether the assertion passed (within thresholds). */
  pass: boolean;
  /** Percentage of pixels that differ (0-100). */
  diffPercentage: number;
  /** Absolute count of differing pixels. */
  diffPixelCount: number;
  /** Total pixels compared. */
  totalPixels: number;
  /** Bounding box of the diff region. */
  diffRegion?: ViewportRegion;
  /** Base64-encoded diff image (red = different, dimmed = same). */
  diffImage?: string;
  /** The baseline key used for this assertion. */
  baselineKey?: string;
  /** Error message if assertion could not be performed. */
  error?: string;
}
