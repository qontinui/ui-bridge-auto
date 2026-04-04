/**
 * Screenshot Comparison Integration
 *
 * Integrates the UI Bridge SDK's visual snapshot capture and pixel-level
 * comparison into ui-bridge-auto's automation and assertion flow.
 *
 * Provides baseline management (capture, store, compare) and visual
 * regression assertions for automation workflows.
 *
 * @example
 * ```ts
 * const store = new InMemoryBaselineStore();
 * const manager = new ScreenshotAssertionManager(store);
 *
 * // Capture a baseline
 * await manager.captureBaseline("btn-1", buttonElement);
 *
 * // Later, assert it still matches
 * const result = await manager.assertMatchesBaseline("btn-1", buttonElement);
 * console.log(result.pass, result.diffPercentage);
 * ```
 */

import {
  captureMediaSnapshot,
  captureElementScreenshot,
  compareVisualRegression,
} from "@qontinui/ui-bridge";
import type { MediaSnapshotData, VisualRegressionResult } from "@qontinui/ui-bridge";
import type { ViewportRegion } from "../types/region";
import {
  MEDIA_ELEMENT_TAGS,
  type BaselineStore,
  type ScreenshotAssertionOptions,
  type ScreenshotAssertionResult,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default assertion options. */
const DEFAULTS: Required<
  Omit<ScreenshotAssertionOptions, "baselineKey" | "maskRegions">
> & {
  baselineKey: string | undefined;
  maskRegions: undefined;
} = {
  pixelThreshold: 10,
  failureThreshold: 0.1,
  failureThresholdType: "percent",
  blur: 0,
  maxSize: 1024,
  updateBaseline: false,
  baselineKey: undefined,
  maskRegions: undefined,
};

// ---------------------------------------------------------------------------
// InMemoryBaselineStore
// ---------------------------------------------------------------------------

/**
 * In-memory baseline store backed by a simple Map.
 *
 * Suitable for testing and ephemeral use. For persistent storage,
 * implement {@link BaselineStore} with IndexedDB, localStorage, or
 * a server-backed store.
 */
export class InMemoryBaselineStore implements BaselineStore {
  private readonly store = new Map<string, MediaSnapshotData>();

  /** Save a snapshot under the given key. */
  async save(key: string, snapshot: MediaSnapshotData): Promise<void> {
    this.store.set(key, snapshot);
  }

  /** Load a snapshot by key, or null if not found. */
  async load(key: string): Promise<MediaSnapshotData | null> {
    return this.store.get(key) ?? null;
  }

  /** Check whether a key exists. */
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /** Delete a snapshot by key. Returns true if deleted, false if not found. */
  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  /** List all stored keys. */
  async listKeys(): Promise<string[]> {
    return [...this.store.keys()];
  }

  /** Clear all stored baselines. */
  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Capture helper
// ---------------------------------------------------------------------------

/**
 * Capture a snapshot of an element, choosing the appropriate capture method
 * based on the element's tag name.
 *
 * Media elements (canvas, img, video, svg) use `captureMediaSnapshot`.
 * All other elements use `captureElementScreenshot` (SVG foreignObject approach).
 */
async function captureElement(
  element: HTMLElement,
  elementId: string,
  maxSize: number,
): Promise<MediaSnapshotData | null> {
  const tag = element.tagName.toLowerCase();
  if (MEDIA_ELEMENT_TAGS.has(tag)) {
    return captureMediaSnapshot(element, elementId, maxSize);
  }
  return captureElementScreenshot(element, elementId, { maxSize });
}

// ---------------------------------------------------------------------------
// Image masking
// ---------------------------------------------------------------------------

/**
 * Load a base64-encoded PNG image into an HTMLImageElement.
 */
function loadBase64Image(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${base64}`;
  });
}

/**
 * Apply mask regions to a snapshot by drawing neutral gray rectangles
 * over the specified areas. Returns a new snapshot with the masked image.
 *
 * Used to exclude dynamic content (timestamps, animations, ads) from
 * visual regression comparison.
 *
 * @param snapshot - The snapshot to mask.
 * @param regions - Viewport regions to blank out.
 * @returns A new snapshot with mask regions filled with gray.
 */
export async function applyMask(
  snapshot: MediaSnapshotData,
  regions: ViewportRegion[],
): Promise<MediaSnapshotData> {
  if (regions.length === 0) return snapshot;

  try {
    const img = await loadBase64Image(snapshot.data);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return snapshot;

    ctx.drawImage(img, 0, 0);

    // Blank out mask regions with neutral gray
    ctx.fillStyle = "#808080";
    for (const r of regions) {
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }

    const data = canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
    return { ...snapshot, data };
  } catch {
    // If masking fails (e.g., jsdom without canvas), return original
    return snapshot;
  }
}

// ---------------------------------------------------------------------------
// Result mapping
// ---------------------------------------------------------------------------

/**
 * Map a VisualRegressionResult to a ScreenshotAssertionResult.
 */
function mapResult(
  vr: VisualRegressionResult,
  baselineKey?: string,
): ScreenshotAssertionResult {
  return {
    pass: vr.pass,
    diffPercentage: vr.diffPercentage,
    diffPixelCount: vr.diffPixelCount,
    totalPixels: vr.totalPixels,
    diffRegion: vr.diffRegion,
    diffImage: vr.diffImage,
    baselineKey,
  };
}

// ---------------------------------------------------------------------------
// ScreenshotAssertionManager
// ---------------------------------------------------------------------------

/**
 * Manages screenshot baselines and visual regression assertions.
 *
 * Wraps the UI Bridge SDK's capture and comparison functions with
 * a baseline storage layer and a structured assertion result API.
 */
export class ScreenshotAssertionManager {
  private readonly store: BaselineStore;

  constructor(store: BaselineStore) {
    this.store = store;
  }

  /**
   * Capture a baseline screenshot of an element and store it.
   *
   * @param elementId - The element's identifier.
   * @param element - The DOM element to capture.
   * @param key - Storage key. Defaults to `baseline-${elementId}`.
   * @returns The captured snapshot, or null if capture failed.
   */
  async captureBaseline(
    elementId: string,
    element: HTMLElement,
    key?: string,
  ): Promise<MediaSnapshotData | null> {
    const storageKey = key ?? `baseline-${elementId}`;
    const snapshot = await captureElement(
      element,
      elementId,
      DEFAULTS.maxSize,
    );
    if (!snapshot) return null;

    await this.store.save(storageKey, snapshot);
    return snapshot;
  }

  /**
   * Assert that an element's current appearance matches its stored baseline.
   *
   * If no baseline exists and `updateBaseline` is true, the current
   * screenshot is saved as the new baseline and the assertion passes.
   * If no baseline exists and `updateBaseline` is false, the assertion
   * fails with an error.
   *
   * @param elementId - The element's identifier.
   * @param element - The DOM element to capture and compare.
   * @param options - Comparison thresholds and baseline options.
   * @returns The assertion result.
   */
  async assertMatchesBaseline(
    elementId: string,
    element: HTMLElement,
    options?: ScreenshotAssertionOptions,
  ): Promise<ScreenshotAssertionResult> {
    const opts = { ...DEFAULTS, ...options };
    const storageKey = opts.baselineKey ?? `baseline-${elementId}`;

    // Capture current
    const current = await captureElement(element, elementId, opts.maxSize);
    if (!current) {
      return {
        pass: false,
        diffPercentage: 100,
        diffPixelCount: 0,
        totalPixels: 0,
        baselineKey: storageKey,
        error: "Failed to capture current screenshot",
      };
    }

    // Load baseline
    const baseline = await this.store.load(storageKey);
    if (!baseline) {
      if (opts.updateBaseline) {
        // Save current as the new baseline
        await this.store.save(storageKey, current);
        return {
          pass: true,
          diffPercentage: 0,
          diffPixelCount: 0,
          totalPixels: current.width * current.height,
          baselineKey: storageKey,
        };
      }
      return {
        pass: false,
        diffPercentage: 100,
        diffPixelCount: 0,
        totalPixels: 0,
        baselineKey: storageKey,
        error: `No baseline found for key "${storageKey}"`,
      };
    }

    // Apply masks if specified
    const masks = opts.maskRegions;
    const maskedBaseline = masks && masks.length > 0 ? await applyMask(baseline, masks) : baseline;
    const maskedCurrent = masks && masks.length > 0 ? await applyMask(current, masks) : current;

    // Compare
    const vr = await compareVisualRegression(maskedBaseline, maskedCurrent, {
      pixelThreshold: opts.pixelThreshold,
      failureThreshold: opts.failureThreshold,
      failureThresholdType: opts.failureThresholdType,
      blur: opts.blur,
    });

    const result = mapResult(vr, storageKey);

    // Optionally update baseline on pass
    if (opts.updateBaseline && result.pass) {
      await this.store.save(storageKey, current);
    }

    return result;
  }

  /**
   * Assert that two elements look the same by comparing their screenshots.
   *
   * Captures screenshots of both elements and compares them directly,
   * without using the baseline store.
   *
   * @param elementA - First element to capture.
   * @param elementB - Second element to capture.
   * @param options - Comparison thresholds.
   * @returns The assertion result.
   */
  async assertElementsMatch(
    elementA: { id: string; element: HTMLElement },
    elementB: { id: string; element: HTMLElement },
    options?: ScreenshotAssertionOptions,
  ): Promise<ScreenshotAssertionResult> {
    const opts = { ...DEFAULTS, ...options };

    const snapshotA = await captureElement(
      elementA.element,
      elementA.id,
      opts.maxSize,
    );
    const snapshotB = await captureElement(
      elementB.element,
      elementB.id,
      opts.maxSize,
    );

    if (!snapshotA || !snapshotB) {
      return {
        pass: false,
        diffPercentage: 100,
        diffPixelCount: 0,
        totalPixels: 0,
        error: `Failed to capture screenshot for ${!snapshotA ? elementA.id : elementB.id}`,
      };
    }

    return this.compareSnapshots(snapshotA, snapshotB, options);
  }

  /**
   * Compare two snapshots directly and return a structured assertion result.
   *
   * Thin wrapper around the UI Bridge SDK's `compareVisualRegression`.
   *
   * @param a - First snapshot.
   * @param b - Second snapshot.
   * @param options - Comparison thresholds.
   * @returns The assertion result.
   */
  async compareSnapshots(
    a: MediaSnapshotData,
    b: MediaSnapshotData,
    options?: ScreenshotAssertionOptions,
  ): Promise<ScreenshotAssertionResult> {
    const opts = { ...DEFAULTS, ...options };

    // Apply masks if specified
    const masks = opts.maskRegions;
    const maskedA = masks && masks.length > 0 ? await applyMask(a, masks) : a;
    const maskedB = masks && masks.length > 0 ? await applyMask(b, masks) : b;

    const vr = await compareVisualRegression(maskedA, maskedB, {
      pixelThreshold: opts.pixelThreshold,
      failureThreshold: opts.failureThreshold,
      failureThresholdType: opts.failureThresholdType,
      blur: opts.blur,
    });

    return mapResult(vr);
  }
}
