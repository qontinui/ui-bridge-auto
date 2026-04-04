import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MediaSnapshotData, VisualRegressionResult } from "@qontinui/ui-bridge";

// ---------------------------------------------------------------------------
// Mock @qontinui/ui-bridge capture/compare functions
// ---------------------------------------------------------------------------

const mockCaptureMediaSnapshot = vi.fn(
  (_el: HTMLElement, _id: string, _maxSize?: number): MediaSnapshotData | null => null,
);
const mockCaptureElementScreenshot = vi.fn(
  (_el: HTMLElement, _id: string, _opts?: Record<string, unknown>): Promise<MediaSnapshotData | null> =>
    Promise.resolve(null),
);
const mockCompareVisualRegression = vi.fn(
  (_a: MediaSnapshotData, _b: MediaSnapshotData, _opts?: Record<string, unknown>): Promise<VisualRegressionResult> =>
    Promise.resolve({ pass: true, diffPixelCount: 0, diffPercentage: 0, totalPixels: 0, dimensions: { width: 0, height: 0 } }),
);

vi.mock("@qontinui/ui-bridge", () => ({
  captureMediaSnapshot: (...args: Parameters<typeof mockCaptureMediaSnapshot>) =>
    mockCaptureMediaSnapshot(...args),
  captureElementScreenshot: (...args: Parameters<typeof mockCaptureElementScreenshot>) =>
    mockCaptureElementScreenshot(...args),
  compareVisualRegression: (...args: Parameters<typeof mockCompareVisualRegression>) =>
    mockCompareVisualRegression(...args),
}));

import {
  InMemoryBaselineStore,
  ScreenshotAssertionManager,
} from "../../visual/screenshot-assertion";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function createSnapshot(
  id: string,
  width = 100,
  height = 50,
): MediaSnapshotData {
  return {
    data: `base64-${id}`,
    width,
    height,
    mediaType: "image/png",
    elementId: id,
    timestamp: Date.now(),
  };
}

function createPassResult(totalPixels = 5000): VisualRegressionResult {
  return {
    pass: true,
    diffPixelCount: 0,
    diffPercentage: 0,
    totalPixels,
    dimensions: { width: 100, height: 50 },
  };
}

function createFailResult(
  diffPercent = 5.5,
  diffPixels = 275,
  totalPixels = 5000,
): VisualRegressionResult {
  return {
    pass: false,
    diffPixelCount: diffPixels,
    diffPercentage: diffPercent,
    totalPixels,
    diffRegion: { x: 10, y: 10, width: 30, height: 20 },
    diffImage: "base64-diff-image",
    dimensions: { width: 100, height: 50 },
  };
}

// ---------------------------------------------------------------------------
// InMemoryBaselineStore
// ---------------------------------------------------------------------------

describe("InMemoryBaselineStore", () => {
  let store: InMemoryBaselineStore;

  beforeEach(() => {
    store = new InMemoryBaselineStore();
  });

  it("saves and loads a snapshot", async () => {
    const snap = createSnapshot("el-1");
    await store.save("key-1", snap);

    const loaded = await store.load("key-1");
    expect(loaded).toEqual(snap);
  });

  it("returns null for non-existent key", async () => {
    const loaded = await store.load("nonexistent");
    expect(loaded).toBeNull();
  });

  it("reports existence correctly", async () => {
    expect(await store.exists("key-1")).toBe(false);

    await store.save("key-1", createSnapshot("el-1"));
    expect(await store.exists("key-1")).toBe(true);
  });

  it("deletes a key and returns true", async () => {
    await store.save("key-1", createSnapshot("el-1"));
    const deleted = await store.delete("key-1");

    expect(deleted).toBe(true);
    expect(await store.exists("key-1")).toBe(false);
  });

  it("returns false when deleting non-existent key", async () => {
    const deleted = await store.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("lists all keys", async () => {
    await store.save("a", createSnapshot("1"));
    await store.save("b", createSnapshot("2"));
    await store.save("c", createSnapshot("3"));

    const keys = await store.listKeys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain("a");
    expect(keys).toContain("b");
    expect(keys).toContain("c");
  });

  it("returns empty array when no keys", async () => {
    const keys = await store.listKeys();
    expect(keys).toEqual([]);
  });

  it("clears all entries", async () => {
    await store.save("a", createSnapshot("1"));
    await store.save("b", createSnapshot("2"));

    store.clear();

    expect(await store.listKeys()).toEqual([]);
    expect(await store.exists("a")).toBe(false);
  });

  it("overwrites existing key on save", async () => {
    const snap1 = createSnapshot("el-1", 100, 50);
    const snap2 = createSnapshot("el-1", 200, 100);

    await store.save("key-1", snap1);
    await store.save("key-1", snap2);

    const loaded = await store.load("key-1");
    expect(loaded?.width).toBe(200);
    expect(loaded?.height).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ScreenshotAssertionManager
// ---------------------------------------------------------------------------

describe("ScreenshotAssertionManager", () => {
  let store: InMemoryBaselineStore;
  let manager: ScreenshotAssertionManager;

  beforeEach(() => {
    store = new InMemoryBaselineStore();
    manager = new ScreenshotAssertionManager(store);
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // captureBaseline
  // -----------------------------------------------------------------------

  describe("captureBaseline", () => {
    it("captures and saves a baseline for a canvas element", async () => {
      const canvas = document.createElement("canvas");
      const snap = createSnapshot("canvas-1");
      mockCaptureMediaSnapshot.mockReturnValue(snap);

      const result = await manager.captureBaseline("canvas-1", canvas);

      expect(result).toEqual(snap);
      expect(mockCaptureMediaSnapshot).toHaveBeenCalledWith(
        canvas,
        "canvas-1",
        1024,
      );
      expect(await store.exists("baseline-canvas-1")).toBe(true);
    });

    it("captures and saves a baseline for a div element", async () => {
      const div = document.createElement("div");
      const snap = createSnapshot("div-1");
      mockCaptureElementScreenshot.mockResolvedValue(snap);

      const result = await manager.captureBaseline("div-1", div);

      expect(result).toEqual(snap);
      expect(mockCaptureElementScreenshot).toHaveBeenCalled();
      expect(await store.exists("baseline-div-1")).toBe(true);
    });

    it("uses custom key when provided", async () => {
      const div = document.createElement("div");
      mockCaptureElementScreenshot.mockResolvedValue(createSnapshot("el-1"));

      await manager.captureBaseline("el-1", div, "my-custom-key");

      expect(await store.exists("my-custom-key")).toBe(true);
      expect(await store.exists("baseline-el-1")).toBe(false);
    });

    it("returns null when capture fails", async () => {
      const div = document.createElement("div");
      mockCaptureElementScreenshot.mockResolvedValue(null);

      const result = await manager.captureBaseline("el-1", div);

      expect(result).toBeNull();
      expect(await store.exists("baseline-el-1")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // assertMatchesBaseline
  // -----------------------------------------------------------------------

  describe("assertMatchesBaseline", () => {
    it("passes when current matches baseline", async () => {
      const div = document.createElement("div");
      const baselineSnap = createSnapshot("div-1");
      const currentSnap = createSnapshot("div-1");
      await store.save("baseline-div-1", baselineSnap);

      mockCaptureElementScreenshot.mockResolvedValue(currentSnap);
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      const result = await manager.assertMatchesBaseline("div-1", div);

      expect(result.pass).toBe(true);
      expect(result.diffPercentage).toBe(0);
      expect(result.baselineKey).toBe("baseline-div-1");
    });

    it("fails when current differs from baseline", async () => {
      const div = document.createElement("div");
      await store.save("baseline-div-1", createSnapshot("div-1"));

      mockCaptureElementScreenshot.mockResolvedValue(createSnapshot("div-1"));
      mockCompareVisualRegression.mockResolvedValue(createFailResult());

      const result = await manager.assertMatchesBaseline("div-1", div);

      expect(result.pass).toBe(false);
      expect(result.diffPercentage).toBe(5.5);
      expect(result.diffPixelCount).toBe(275);
      expect(result.diffRegion).toBeDefined();
      expect(result.diffImage).toBe("base64-diff-image");
    });

    it("returns error when no baseline and updateBaseline is false", async () => {
      const div = document.createElement("div");
      mockCaptureElementScreenshot.mockResolvedValue(createSnapshot("div-1"));

      const result = await manager.assertMatchesBaseline("div-1", div);

      expect(result.pass).toBe(false);
      expect(result.error).toContain("No baseline found");
    });

    it("saves current as baseline when updateBaseline is true and no baseline exists", async () => {
      const div = document.createElement("div");
      const snap = createSnapshot("div-1");
      mockCaptureElementScreenshot.mockResolvedValue(snap);

      const result = await manager.assertMatchesBaseline("div-1", div, {
        updateBaseline: true,
      });

      expect(result.pass).toBe(true);
      expect(result.diffPercentage).toBe(0);
      expect(await store.exists("baseline-div-1")).toBe(true);
    });

    it("updates baseline on pass when updateBaseline is true", async () => {
      const div = document.createElement("div");
      const oldBaseline = createSnapshot("div-1", 100, 50);
      const newSnapshot = createSnapshot("div-1", 200, 100);
      await store.save("baseline-div-1", oldBaseline);

      mockCaptureElementScreenshot.mockResolvedValue(newSnapshot);
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      await manager.assertMatchesBaseline("div-1", div, {
        updateBaseline: true,
      });

      const stored = await store.load("baseline-div-1");
      expect(stored?.width).toBe(200);
    });

    it("does not update baseline on fail even with updateBaseline true", async () => {
      const div = document.createElement("div");
      const oldBaseline = createSnapshot("div-1", 100, 50);
      await store.save("baseline-div-1", oldBaseline);

      mockCaptureElementScreenshot.mockResolvedValue(
        createSnapshot("div-1", 200, 100),
      );
      mockCompareVisualRegression.mockResolvedValue(createFailResult());

      await manager.assertMatchesBaseline("div-1", div, {
        updateBaseline: true,
      });

      const stored = await store.load("baseline-div-1");
      expect(stored?.width).toBe(100); // unchanged
    });

    it("uses custom baselineKey", async () => {
      const div = document.createElement("div");
      await store.save("custom-key", createSnapshot("div-1"));

      mockCaptureElementScreenshot.mockResolvedValue(createSnapshot("div-1"));
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      const result = await manager.assertMatchesBaseline("div-1", div, {
        baselineKey: "custom-key",
      });

      expect(result.pass).toBe(true);
      expect(result.baselineKey).toBe("custom-key");
    });

    it("returns error when capture fails", async () => {
      const div = document.createElement("div");
      mockCaptureElementScreenshot.mockResolvedValue(null);

      const result = await manager.assertMatchesBaseline("div-1", div);

      expect(result.pass).toBe(false);
      expect(result.error).toContain("Failed to capture");
    });

    it("passes comparison options to compareVisualRegression", async () => {
      const div = document.createElement("div");
      await store.save("baseline-div-1", createSnapshot("div-1"));
      mockCaptureElementScreenshot.mockResolvedValue(createSnapshot("div-1"));
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      await manager.assertMatchesBaseline("div-1", div, {
        pixelThreshold: 20,
        failureThreshold: 5,
        failureThresholdType: "pixel",
        blur: 2,
      });

      expect(mockCompareVisualRegression).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        {
          pixelThreshold: 20,
          failureThreshold: 5,
          failureThresholdType: "pixel",
          blur: 2,
        },
      );
    });
  });

  // -----------------------------------------------------------------------
  // assertElementsMatch
  // -----------------------------------------------------------------------

  describe("assertElementsMatch", () => {
    it("captures both elements and compares", async () => {
      const divA = document.createElement("div");
      const divB = document.createElement("div");
      const snapA = createSnapshot("a");
      const snapB = createSnapshot("b");

      mockCaptureElementScreenshot
        .mockResolvedValueOnce(snapA)
        .mockResolvedValueOnce(snapB);
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      const result = await manager.assertElementsMatch(
        { id: "a", element: divA },
        { id: "b", element: divB },
      );

      expect(result.pass).toBe(true);
      expect(mockCaptureElementScreenshot).toHaveBeenCalledTimes(2);
    });

    it("returns error when first capture fails", async () => {
      const divA = document.createElement("div");
      const divB = document.createElement("div");

      mockCaptureElementScreenshot
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(createSnapshot("b"));

      const result = await manager.assertElementsMatch(
        { id: "a", element: divA },
        { id: "b", element: divB },
      );

      expect(result.pass).toBe(false);
      expect(result.error).toContain("a");
    });

    it("returns error when second capture fails", async () => {
      const divA = document.createElement("div");
      const divB = document.createElement("div");

      mockCaptureElementScreenshot
        .mockResolvedValueOnce(createSnapshot("a"))
        .mockResolvedValueOnce(null);

      const result = await manager.assertElementsMatch(
        { id: "a", element: divA },
        { id: "b", element: divB },
      );

      expect(result.pass).toBe(false);
      expect(result.error).toContain("b");
    });
  });

  // -----------------------------------------------------------------------
  // compareSnapshots
  // -----------------------------------------------------------------------

  describe("compareSnapshots", () => {
    it("maps passing result correctly", async () => {
      mockCompareVisualRegression.mockResolvedValue(createPassResult(10000));

      const result = await manager.compareSnapshots(
        createSnapshot("a"),
        createSnapshot("b"),
      );

      expect(result.pass).toBe(true);
      expect(result.diffPercentage).toBe(0);
      expect(result.diffPixelCount).toBe(0);
      expect(result.totalPixels).toBe(10000);
      expect(result.baselineKey).toBeUndefined();
    });

    it("maps failing result correctly", async () => {
      mockCompareVisualRegression.mockResolvedValue(
        createFailResult(2.5, 250, 10000),
      );

      const result = await manager.compareSnapshots(
        createSnapshot("a"),
        createSnapshot("b"),
      );

      expect(result.pass).toBe(false);
      expect(result.diffPercentage).toBe(2.5);
      expect(result.diffPixelCount).toBe(250);
      expect(result.totalPixels).toBe(10000);
      expect(result.diffRegion).toEqual({
        x: 10, y: 10, width: 30, height: 20,
      });
      expect(result.diffImage).toBe("base64-diff-image");
    });

    it("passes options to compareVisualRegression", async () => {
      mockCompareVisualRegression.mockResolvedValue(createPassResult());

      await manager.compareSnapshots(
        createSnapshot("a"),
        createSnapshot("b"),
        { pixelThreshold: 15, blur: 3 },
      );

      expect(mockCompareVisualRegression).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          pixelThreshold: 15,
          blur: 3,
        }),
      );
    });
  });
});
