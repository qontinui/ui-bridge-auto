/**
 * Text cross-check (Section 8 — visual + semantic fusion).
 *
 * Compares an element's DOM `textContent` against text extracted via OCR
 * from a screenshot of the element. When the two diverge, classifies the
 * suspected cause from a small enum so callers can route the divergence
 * to the right fix path:
 *
 *   - `font-not-loaded`  → text is in DOM but pixels show a fallback or
 *                          missing glyph. A web-font has not loaded.
 *   - `css-clip`         → an ancestor's `overflow: hidden` /
 *                          `clip-path` is hiding pixels.
 *   - `transform-hidden` → an ancestor's CSS transform pushed the text
 *                          outside its declared box.
 *   - `low-contrast`     → text is present but fails contrast against
 *                          its background — OCR confidence is low even
 *                          though DOM textContent is correct.
 *   - `unknown`          → mismatch detected, no rule fired.
 *
 * Determinism: pure function over the element + injected OCR provider.
 * No `Date.now()`, no `Math.random()`. The default tolerance threshold
 * (string distance / max(len,1)) is fixed at 0.2 — callers can override.
 *
 * Style inputs (`font-display`, `clip-path`, `transform`, color/background
 * for contrast) are sourced via `window.getComputedStyle` directly. The
 * registry's typed `ComputedStyleSubset` (`types/element.ts:109`) does NOT
 * expose those keys (vet finding #1). Pattern matches `discovery/
 * overlay-detector.ts:45` and `actions/dom-actions.ts:45`.
 */

import { captureMediaSnapshot, captureElementScreenshot } from "@qontinui/ui-bridge";
import type { MediaSnapshotData } from "@qontinui/ui-bridge";
import type { QueryableElement } from "../core/element-query";
import { similarity } from "../core/fuzzy-match";
import type { IOCRProvider, TextRegion } from "./types";
import { MEDIA_ELEMENT_TAGS } from "./types";
import { computeVisibility } from "./visibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextCrossCheckCause =
  | "font-not-loaded"
  | "css-clip"
  | "transform-hidden"
  | "low-contrast"
  | "occluded"
  | "unknown";

/**
 * Extra detail attached to an `occluded` verdict: WHICH element is on top.
 * The cause alone says the text is hidden; only the occluder's id says what
 * to move.
 */
export interface CrossCheckOcclusionDetail {
  /** Registry id (or DOM descriptor) of the element painting above the target. */
  occludedBy: string;
  /** Fraction of the target's area that element covers, 0..1. */
  ratio: number;
}

export interface CrossCheckTextOptions {
  /**
   * OCR provider. When omitted (and `ocrText` is also omitted),
   * `crossCheckText` returns `{ skipped: true, reason: "no ocr provider" }` —
   * visibility + token check still work without OCR; only this module needs it.
   */
  ocr?: IOCRProvider;
  /**
   * Pre-computed OCR text. When supplied, `crossCheckText` skips the
   * snapshot-capture + OCR step entirely and uses this text as the
   * "what the pixels say" side of the comparison. Useful for:
   *   - jsdom tests that can't capture real screenshots.
   *   - Callers who have already run OCR upstream (cached result, batch).
   *   - Replay-mode comparisons where the OCR text was recorded earlier.
   * `ocrText` takes precedence over `ocr` when both are provided.
   */
  ocrText?: string;
  /** Optional text regions to pair with `ocrText` (drives low-contrast classification). */
  ocrRegions?: TextRegion[];
  /**
   * Mismatch tolerance (0..1). Computed as
   * `1 - similarity(domText, ocrText)`. Defaults to `0.2` — ~80% similarity
   * passes. Lower values are stricter; OCR confusion (l vs. 1) becomes a
   * mismatch faster.
   */
  tolerance?: number;
  /**
   * OCR confidence threshold below which the result is treated as "low
   * contrast" rather than a content mismatch. Defaults to `0.5` —
   * Tesseract's mid-range. Only used by the classifier; the OCR engine's
   * own confidence is read from the provider's `getTextRegions` output if
   * available, otherwise the classifier degrades to text-distance only.
   */
  lowContrastThreshold?: number;
  /** Max snapshot dimension (px). Defaults to 512. */
  maxSize?: number;
  /** Element id used for snapshot capture. Defaults to `target.id`. */
  elementId?: string;
  /**
   * The other registered elements on the page, used to decide whether
   * something is painting ABOVE the target.
   *
   * Optional, and its absence is handled honestly rather than silently:
   * with no registry there is nothing to compare stacking against, so the
   * `occluded` rule cannot run and the classifier falls through to the
   * rules that can. Supply it whenever the caller has a registry — the
   * runner's regression executor does.
   */
  registry?: QueryableElement[];
  /**
   * Treat occlusion by a tracked modal/dropdown as expected (default
   * `false` — a dialog covering the page is the dialog working, not a
   * defect). Passed through to `computeVisibility`'s overlay predicate.
   */
  isKnownOverlay?: (el: HTMLElement) => boolean;
}


export interface TextCrossCheckOk {
  skipped: false;
  pass: boolean;
  domText: string;
  ocrText: string;
  /** Levenshtein-derived similarity (0..1). */
  similarity: number;
  /** Suspected cause when `pass === false`. */
  cause?: TextCrossCheckCause;
  /**
   * Present only when `cause === "occluded"` — the element on top and how
   * much of the target it covers. Without this a caller knows the text is
   * hidden but not by what, which is the difference between a report and a
   * fix.
   */
  occlusion?: CrossCheckOcclusionDetail;
}

export interface TextCrossCheckSkipped {
  skipped: true;
  reason: string;
}

export type TextCrossCheckResult = TextCrossCheckOk | TextCrossCheckSkipped;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cross-check an element's DOM text against OCR text from its screenshot.
 *
 * @param target - The element to check.
 * @param opts - OCR provider + thresholds. `ocr` is required; without it
 *   the function returns `{ skipped: true, reason: "no ocr provider" }`.
 */
export async function crossCheckText(
  target: QueryableElement,
  opts: CrossCheckTextOptions,
): Promise<TextCrossCheckResult> {
  if (opts.ocrText === undefined && !opts.ocr) {
    return { skipped: true, reason: "no ocr provider" };
  }

  const elementId = opts.elementId ?? target.id;
  const tolerance = opts.tolerance ?? 0.2;
  const maxSize = opts.maxSize ?? 512;

  const domText =
    target.getState().textContent?.trim() ??
    target.element.textContent?.trim() ??
    "";

  // Resolve OCR text + regions. `ocrText` injection wins over the provider
  // path so tests + replay can short-circuit. The provider path captures a
  // screenshot and runs OCR — for ANY element, not just media tags. (The
  // existing `extractElementText` short-circuits non-media elements to DOM
  // textContent, which would defeat the point of pixel↔DOM cross-check.)
  let ocrText: string;
  let regions: TextRegion[] | undefined;
  if (opts.ocrText !== undefined) {
    ocrText = opts.ocrText.trim();
    regions = opts.ocrRegions;
  } else if (opts.ocr) {
    const snapshot = await captureForOCR(target.element, elementId, maxSize);
    if (!snapshot) {
      return { skipped: true, reason: "snapshot capture failed" };
    }
    ocrText = (
      await opts.ocr.extractText(
        snapshot.data,
        snapshot.width,
        snapshot.height,
      )
    ).trim();
    if (opts.ocr.getTextRegions) {
      regions = await opts.ocr.getTextRegions(
        snapshot.data,
        snapshot.width,
        snapshot.height,
      );
    }
  } else {
    // Should not be reachable — guarded above.
    return { skipped: true, reason: "no ocr provider" };
  }

  const sim = similarity(domText.toLowerCase(), ocrText.toLowerCase());
  const distance = 1 - sim;
  const pass = distance <= tolerance;

  if (pass) {
    return {
      skipped: false,
      pass: true,
      domText,
      ocrText,
      similarity: sim,
    };
  }

  // Mismatch — classify.
  const { cause, occlusion } = classifyMismatch(target.element, regions, {
    domText,
    ocrText,
    lowContrastThreshold: opts.lowContrastThreshold ?? 0.5,
    target,
    registry: opts.registry,
    viewport: {
      x: 0,
      y: 0,
      width: typeof window !== "undefined" ? window.innerWidth : 0,
      height: typeof window !== "undefined" ? window.innerHeight : 0,
    },
    isKnownOverlay: opts.isKnownOverlay,
  });

  return {
    skipped: false,
    pass: false,
    domText,
    ocrText,
    similarity: sim,
    cause,
    ...(occlusion ? { occlusion } : {}),
  };
}

/**
 * Capture a snapshot of `el` regardless of tag — uses `captureMediaSnapshot`
 * for media elements (canvas/img/video/svg) and `captureElementScreenshot`
 * (SVG foreignObject path) for everything else. Returns null on failure.
 */
async function captureForOCR(
  el: HTMLElement,
  elementId: string,
  maxSize: number,
): Promise<MediaSnapshotData | null> {
  if (MEDIA_ELEMENT_TAGS.has(el.tagName.toLowerCase())) {
    return captureMediaSnapshot(el, elementId, maxSize);
  }
  return captureElementScreenshot(el, elementId, { maxSize });
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

interface ClassifierContext {
  domText: string;
  ocrText: string;
  lowContrastThreshold: number;
  /** The registry entry for the element under test, for the occlusion rule. */
  target?: QueryableElement;
  /** Everything else on the page, for the occlusion rule. */
  registry?: QueryableElement[];
  viewport: { x: number; y: number; width: number; height: number };
  isKnownOverlay?: (el: HTMLElement) => boolean;
}

/**
 * How much of the target another element must cover before occlusion is
 * blamed for an OCR mismatch. Above a hairline, well below "most of it":
 * clipping the tail of a name is enough to make the text unreadable, which
 * is precisely the reported failure.
 */
const OCCLUSION_CAUSE_MIN_RATIO = 0.1;

/**
 * Rule-based mismatch classifier (Open decision #5 — chose rule-based v1).
 *
 * Rules in order of evaluation:
 *   1. `css-clip` — an ancestor has `clip-path` other than `none`, OR an
 *      ancestor has `overflow: hidden | clip` with the element's bounding
 *      rect extending past the ancestor's box.
 *   2. `transform-hidden` — element's own or any ancestor's `transform`
 *      property is non-`none`, AND the element's bounding rect's center
 *      lies outside the document.
 *   3. `occluded` — another element paints above this one and covers it.
 *      Checked BEFORE `low-contrast` and `font-not-loaded` because a covered
 *      element produces exactly their signature (DOM text present, OCR
 *      empty) while having nothing to do with fonts or colour. Without this
 *      rule the classifier reported a widget sitting on top of a label as
 *      `font-not-loaded` — a confident misdiagnosis that sent readers after
 *      a webfont bug that did not exist.
 *   4. `low-contrast` — OCR confidence available and below threshold; OR
 *      computed `color` is sufficiently close to `background-color`
 *      (luminance delta < 1.5; skipped when bg is fully transparent).
 *   5. `font-not-loaded` — DOM text is non-empty AND OCR text is empty (or
 *      contains only ".notdef"/"�" replacement chars). The strongest
 *      "pixels don't show what the DOM says" signal that isn't a layout
 *      problem. Optionally reinforced by `font-display: swap | block |
 *      optional` on the element/ancestor when the property is exposed.
 *   6. otherwise `unknown`.
 *
 * Order is important: css-clip, transform-hidden and occlusion can each
 * themselves cause empty OCR output (no pixels = no glyphs to read), so they
 * are checked first. Without that ordering, a clipped OR covered element
 * would mis-classify as font-not-loaded.
 *
 * Determinism: every input is read from `window.getComputedStyle` (sync,
 * deterministic). The classifier never throws — bad input falls through to
 * `unknown`.
 */
function classifyMismatch(
  element: HTMLElement,
  regions: { confidence: number }[] | undefined,
  ctx: ClassifierContext,
): { cause: TextCrossCheckCause; occlusion?: CrossCheckOcclusionDetail } {
  const ocrEmpty = ctx.ocrText.length === 0 || isReplacementOnly(ctx.ocrText);

  // 1. css-clip
  if (hasClipPathAncestor(element)) {
    return { cause: "css-clip" };
  }
  if (isClippedByOverflow(element)) {
    return { cause: "css-clip" };
  }

  // 2. transform-hidden
  if (hasNonIdentityTransform(element) && isCenterOffDocument(element)) {
    return { cause: "transform-hidden" };
  }

  // 3. occluded — something is painting on top of this element.
  //
  // Must precede low-contrast and font-not-loaded: a covered element shows
  // the DOM text present / OCR empty signature those rules match on, while
  // having nothing to do with fonts or colour. Reported with the occluder's
  // identity, because "hidden" without "by what" is not actionable.
  //
  // Needs a registry to compare stacking against. Without one the rule is
  // simply not evaluated — it never guesses, and it never suppresses the
  // later rules.
  if (ctx.registry && ctx.registry.length > 0 && ctx.target) {
    try {
      const report = computeVisibility(ctx.target, ctx.registry, ctx.viewport, {
        isKnownOverlay: ctx.isKnownOverlay,
      });
      // Biggest occluder wins the blame; expected overlays (a tracked
      // modal) are not a defect and are left to fall through.
      let worst: { id: string; ratio: number } | null = null;
      for (const occ of report.occludedBy) {
        if (occ.isExpectedOverlay) continue;
        if (!worst || occ.ratio > worst.ratio) worst = { id: occ.id, ratio: occ.ratio };
      }
      if (worst && worst.ratio >= OCCLUSION_CAUSE_MIN_RATIO) {
        return {
          cause: "occluded",
          occlusion: { occludedBy: worst.id, ratio: worst.ratio },
        };
      }
    } catch {
      // A visibility probe that throws must not swallow the mismatch —
      // fall through to the remaining rules rather than returning unknown.
    }
  }

  // 4. low-contrast
  if (regions && regions.length > 0) {
    const minConf = regions.reduce(
      (acc, r) => (r.confidence < acc ? r.confidence : acc),
      Infinity,
    );
    if (minConf < ctx.lowContrastThreshold) return { cause: "low-contrast" };
  }
  if (isLowContrast(element)) return { cause: "low-contrast" };

  // 5. font-not-loaded — DOM has text but OCR yields nothing.
  // `hasFontDisplaySwap` is a *bonus* signal but not required; the empty-
  // OCR-with-non-empty-DOM pattern is itself diagnostic in production.
  // Browsers expose font-display only on the @font-face rule, so reading
  // it from the element's computed style works only in some engines.
  if (ctx.domText.length > 0 && ocrEmpty) {
    return { cause: "font-not-loaded" };
  }

  return { cause: "unknown" };
}

// ---------------------------------------------------------------------------
// Style probes (window.getComputedStyle direct — see file header note)
// ---------------------------------------------------------------------------

function hasClipPathAncestor(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.clipPath && style.clipPath !== "none") return true;
    current = current.parentElement;
  }
  return false;
}

function isClippedByOverflow(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  let current: HTMLElement | null = el.parentElement;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (style.overflow === "hidden" || style.overflow === "clip") {
      const ancestorRect = current.getBoundingClientRect();
      if (
        rect.left < ancestorRect.left ||
        rect.top < ancestorRect.top ||
        rect.right > ancestorRect.right ||
        rect.bottom > ancestorRect.bottom
      ) {
        return true;
      }
    }
    current = current.parentElement;
  }
  return false;
}

function hasNonIdentityTransform(el: HTMLElement): boolean {
  let current: HTMLElement | null = el;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.transform && style.transform !== "none") return true;
    current = current.parentElement;
  }
  return false;
}

function isCenterOffDocument(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // jsdom returns zero-rects for un-rendered elements; treat that as not
  // off-document (no signal) rather than producing a false positive.
  if (rect.width === 0 && rect.height === 0) return false;
  const docW = document.documentElement.clientWidth || window.innerWidth || 0;
  const docH =
    document.documentElement.clientHeight || window.innerHeight || 0;
  return cx < 0 || cy < 0 || cx > docW || cy > docH;
}

function isLowContrast(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const fg = parseColor(style.color);
  const bg = parseColor(style.backgroundColor);
  // Skip when either color is unparseable OR the background is fully
  // transparent (alpha = 0) — a transparent bg means the element doesn't
  // own its visual contrast; we'd need to walk ancestors to find the real
  // backdrop, and v1 doesn't go there. Documented in ADR-008.
  if (!fg || !bg) return false;
  if (bg.a === 0) return false;
  const lumF = relativeLuminance(fg);
  const lumB = relativeLuminance(bg);
  // WCAG contrast ratio: (Lmax + 0.05) / (Lmin + 0.05). Anything under
  // 1.5 is treated as low-contrast for cross-check purposes (well below
  // the 4.5:1 readability bar — flagged here as "definitely visible
  // problem", not "borderline").
  const ratio =
    (Math.max(lumF, lumB) + 0.05) / (Math.min(lumF, lumB) + 0.05);
  return ratio < 1.5;
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(css: string): RGB | null {
  // rgb / rgba notation as returned by getComputedStyle. Capture the
  // optional alpha so callers can treat fully-transparent colors as
  // "not really painted" rather than "black".
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(
    css,
  );
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return {
    r: parseInt(m[1], 10),
    g: parseInt(m[2], 10),
    b: parseInt(m[3], 10),
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

function relativeLuminance({ r, g, b }: RGB): number {
  const channel = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function isReplacementOnly(s: string): boolean {
  // U+FFFD is the Unicode replacement char; ".notdef" appears in some
  // OCR outputs when a font glyph is missing.
  return /^[�\s]*$/.test(s) || s === ".notdef";
}
