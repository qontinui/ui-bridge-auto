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
} from "./screenshot-assertion";

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
