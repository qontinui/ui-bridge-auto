/**
 * Visual module — highlights, OCR text assertions, coordinate translation,
 * and screenshot comparison for DOM-based automation.
 */

// Element highlight
export {
  ElementHighlightManager,
  ACTION_HIGHLIGHT_COLORS,
  _resetStyleInjection,
} from "./element-highlight";

// Text assertion (OCR)
export {
  extractElementText,
  assertTextInElement,
  type TextExtractionResult,
} from "./text-assertion";

// Coordinate translation
export {
  CoordinateTranslator,
  type WindowLike,
} from "./coordinate-translator";

// Screenshot comparison
export {
  InMemoryBaselineStore,
  ScreenshotAssertionManager,
  applyMask,
} from "./screenshot-assertion";

// Tesseract.js OCR provider
export {
  TesseractOCRProvider,
  type TesseractProviderOptions,
} from "./tesseract-provider";

// IndexedDB baseline store
export {
  IndexedDBBaselineStore,
  type IndexedDBStoreOptions,
} from "./indexed-db-store";

// Tauri/PostgreSQL baseline store
export { TauriBaselineStore } from "./tauri-baseline-store";

// Visibility scoring (Section 8)
export {
  computeVisibility,
  overlayDetectorPredicate,
  _resetVisibilityCache,
  type Rect,
  type VisibilityReport,
  type VisibilityOccluder,
  type ComputeVisibilityOptions,
  type OverlayPredicate,
} from "./visibility";

// Text cross-check (Section 8)
export {
  crossCheckText,
  type TextCrossCheckResult,
  type TextCrossCheckOk,
  type TextCrossCheckSkipped,
  type TextCrossCheckCause,
  type CrossCheckTextOptions,
} from "./text-cross-check";

// Design-token presence check (Section 8)
export {
  checkDesignTokens,
  buildDesignTokenRegistry,
  type DesignTokenRegistry,
  type TokenViolation,
  type CheckDesignTokensOptions,
} from "./token-check";

// Visual drift (Section 8)
export {
  runVisualDrift,
  asDriftReport,
  type VisualDriftReport,
  type VisualDriftDetail,
  type RunVisualDriftOptions,
} from "./visual-drift";

// Shared constants
export { MEDIA_ELEMENT_TAGS } from "./types";

// Shared types
export type {
  HighlightOptions,
  ActiveHighlight,
  IOCRProvider,
  TextRegion,
  TextMatch,
  TextAssertionOptions,
  TextAssertionResult,
  CoordinatePoint,
  CoordinateSpace,
  CoordinateTranslation,
  ScrollInfo,
  FrameOffset,
  BaselineStore,
  ScreenshotAssertionOptions,
  ScreenshotAssertionResult,
} from "./types";

// Re-exported from upstream for convenience
export type {
  ViewportRegion,
  MediaSnapshotData,
  MediaComparisonResult,
  ElementCaptureOptions,
  VisualRegressionOptions,
  VisualRegressionResult,
} from "./types";
