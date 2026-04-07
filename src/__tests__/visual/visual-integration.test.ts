/**
 * Visual module integration tests.
 *
 * Exercises the full visual feature chain: text extraction, assertions,
 * screenshot comparison, highlights, coordinate translation, engine
 * integration, and server handler wiring.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { MediaSnapshotData, VisualRegressionResult } from "@qontinui/ui-bridge";

// ---------------------------------------------------------------------------
// Mock @qontinui/ui-bridge (must be before imports that use it)
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
    Promise.resolve({ pass: true, diffPixelCount: 0, diffPercentage: 0, totalPixels: 5000, dimensions: { width: 100, height: 50 } }),
);

vi.mock("@qontinui/ui-bridge", () => ({
  captureMediaSnapshot: (...args: Parameters<typeof mockCaptureMediaSnapshot>) =>
    mockCaptureMediaSnapshot(...args),
  captureElementScreenshot: (...args: Parameters<typeof mockCaptureElementScreenshot>) =>
    mockCaptureElementScreenshot(...args),
  compareVisualRegression: (...args: Parameters<typeof mockCompareVisualRegression>) =>
    mockCompareVisualRegression(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mock setup)
// ---------------------------------------------------------------------------

import { extractElementText, assertTextInElement } from "../../visual/text-assertion";
import { InMemoryBaselineStore, ScreenshotAssertionManager } from "../../visual/screenshot-assertion";
import { ElementHighlightManager, _resetStyleInjection } from "../../visual/element-highlight";
import { CoordinateTranslator, type WindowLike } from "../../visual/coordinate-translator";
import { AutomationEngine } from "../../core/engine";
import { createAutoHandlers } from "../../server/endpoints";
import { MockRegistry } from "../../test-utils/mock-registry";
import type { QueryableElement } from "../../core/element-query";
import type { RegistryLike } from "../../state/state-detector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSnapshot(id: string): MediaSnapshotData {
  return {
    data: `base64-${id}`,
    width: 100,
    height: 50,
    mediaType: "image/png",
    elementId: id,
    timestamp: Date.now(),
  };
}

function createMockElement(
  id: string,
  tagName: string,
  textContent: string,
): QueryableElement {
  const el = document.createElement(tagName);
  el.textContent = textContent;
  return {
    id,
    type: "button",
    label: id,
    element: el,
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent,
      rect: { x: 10, y: 20, width: 100, height: 30 },
      computedStyles: {},
    }),
  };
}

// Mock executor satisfying ActionExecutorLike
function createMockExecutor() {
  return {
    findElement: (_query: unknown) => null,
    executeAction: async () => {},
    waitForIdle: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Visual Module Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetStyleInjection();
  });

  // -----------------------------------------------------------------------
  // Text extraction
  // -----------------------------------------------------------------------

  describe("text extraction chain", () => {
    it("extracts DOM text from a div", async () => {
      const div = document.createElement("div");
      div.textContent = "Hello Visual Module";

      const result = await extractElementText(div, "div-1");
      expect(result.text).toBe("Hello Visual Module");
      expect(result.source).toBe("dom");
    });

    it("returns OCR path for canvas without provider", async () => {
      const canvas = document.createElement("canvas");

      const result = await extractElementText(canvas, "canvas-1");
      expect(result.source).toBe("ocr");
      expect(result.text).toBe("");
    });

    it("assertTextInElement passes for matching text", async () => {
      const registry: RegistryLike = {
        getAllElements: () => [createMockElement("btn-1", "button", "Submit")],
        on: () => () => {},
      };

      const result = await assertTextInElement(
        { id: "btn-1" },
        "Submit",
        registry,
      );

      expect(result.pass).toBe(true);
      expect(result.confidence).toBe(1.0);
      expect(result.matchType).toBe("dom");
    });

    it("assertTextInElement fails for non-matching text", async () => {
      const registry: RegistryLike = {
        getAllElements: () => [createMockElement("btn-1", "button", "Cancel")],
        on: () => () => {},
      };

      const result = await assertTextInElement(
        { id: "btn-1" },
        "Submit Order",
        registry,
        { fuzzyThreshold: 0.9 },
      );

      expect(result.pass).toBe(false);
      expect(result.confidence).toBeLessThan(0.9);
    });
  });

  // -----------------------------------------------------------------------
  // Screenshot comparison
  // -----------------------------------------------------------------------

  describe("screenshot comparison chain", () => {
    it("InMemoryBaselineStore full CRUD cycle", async () => {
      const store = new InMemoryBaselineStore();
      const snap = createSnapshot("el-1");

      await store.save("key-1", snap);
      expect(await store.exists("key-1")).toBe(true);

      const loaded = await store.load("key-1");
      expect(loaded).toEqual(snap);

      const keys = await store.listKeys();
      expect(keys).toContain("key-1");

      await store.delete("key-1");
      expect(await store.exists("key-1")).toBe(false);
    });

    it("ScreenshotAssertionManager.compareSnapshots pass", async () => {
      mockCompareVisualRegression.mockResolvedValue({
        pass: true,
        diffPixelCount: 0,
        diffPercentage: 0,
        totalPixels: 5000,
        dimensions: { width: 100, height: 50 },
      });

      const store = new InMemoryBaselineStore();
      const manager = new ScreenshotAssertionManager(store);
      const result = await manager.compareSnapshots(
        createSnapshot("a"),
        createSnapshot("b"),
      );

      expect(result.pass).toBe(true);
      expect(result.diffPercentage).toBe(0);
    });

    it("ScreenshotAssertionManager.compareSnapshots fail", async () => {
      mockCompareVisualRegression.mockResolvedValue({
        pass: false,
        diffPixelCount: 500,
        diffPercentage: 10,
        totalPixels: 5000,
        diffRegion: { x: 0, y: 0, width: 50, height: 25 },
        dimensions: { width: 100, height: 50 },
      });

      const store = new InMemoryBaselineStore();
      const manager = new ScreenshotAssertionManager(store);
      const result = await manager.compareSnapshots(
        createSnapshot("a"),
        createSnapshot("b"),
      );

      expect(result.pass).toBe(false);
      expect(result.diffPercentage).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // Highlights
  // -----------------------------------------------------------------------

  describe("highlight chain", () => {
    it("ElementHighlightManager creates and dismisses overlay", () => {
      const manager = new ElementHighlightManager();
      const id = manager.highlight({ x: 10, y: 20, width: 100, height: 50 });

      expect(manager.getActive()).toHaveLength(1);
      expect(document.querySelectorAll("[data-highlight-id]")).toHaveLength(1);

      manager.dismiss(id);

      expect(manager.getActive()).toHaveLength(0);
      expect(document.querySelectorAll("[data-highlight-id]")).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Coordinate translation
  // -----------------------------------------------------------------------

  describe("coordinate translation chain", () => {
    it("viewport ↔ page roundtrip", () => {
      const win: WindowLike = {
        scrollX: 100, scrollY: 200,
        screenX: 0, screenY: 0,
        innerWidth: 1280, innerHeight: 720,
        outerWidth: 1280, outerHeight: 720,
      };
      const translator = new CoordinateTranslator(win);

      const original = { x: 50, y: 75 };
      const page = translator.viewportToPage(original);
      const roundtrip = translator.pageToViewport(page);

      expect(roundtrip).toEqual(original);
      expect(page).toEqual({ x: 150, y: 275 });
    });
  });

  // -----------------------------------------------------------------------
  // Engine integration
  // -----------------------------------------------------------------------

  describe("engine integration", () => {
    it("creates highlightManager when enableHighlights is true", () => {
      const registry = new MockRegistry();
      const executor = createMockExecutor();
      const engine = new AutomationEngine({
        registry,
        executor,
        enableHighlights: true,
      });

      expect(engine.highlightManager).not.toBeNull();
      engine.dispose();
    });

    it("highlightManager is null when enableHighlights is false", () => {
      const registry = new MockRegistry();
      const executor = createMockExecutor();
      const engine = new AutomationEngine({
        registry,
        executor,
        enableHighlights: false,
      });

      expect(engine.highlightManager).toBeNull();
      engine.dispose();
    });

    it("getOCRProvider returns null when OCR is not enabled", async () => {
      const registry = new MockRegistry();
      const executor = createMockExecutor();
      const engine = new AutomationEngine({
        registry,
        executor,
      });

      const provider = await engine.getOCRProvider();
      expect(provider).toBeNull();
      engine.dispose();
    });

    it("getOCRProvider returns custom provider when provided", async () => {
      const mockProvider = {
        extractText: async () => "mock text",
      };
      const registry = new MockRegistry();
      const executor = createMockExecutor();
      const engine = new AutomationEngine({
        registry,
        executor,
        ocrProvider: mockProvider,
      });

      const provider = await engine.getOCRProvider();
      expect(provider).toBe(mockProvider);
      engine.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Server handler wiring
  // -----------------------------------------------------------------------

  describe("server handler wiring", () => {
    it("createAutoHandlers returns all expected visual handler keys", () => {
      const registry = new MockRegistry();
      const executor = createMockExecutor();
      const engine = new AutomationEngine({ registry, executor });

      const handlers = createAutoHandlers({ engine, registry, executor });

      // Visual handlers should be present
      expect(handlers).toHaveProperty("highlightElement");
      expect(handlers).toHaveProperty("dismissHighlight");
      expect(handlers).toHaveProperty("dismissAllHighlights");
      expect(handlers).toHaveProperty("assertText");
      expect(handlers).toHaveProperty("extractText");
      expect(handlers).toHaveProperty("captureBaseline");
      expect(handlers).toHaveProperty("assertScreenshot");
      expect(handlers).toHaveProperty("translateCoordinate");

      // Core handlers should also be present
      expect(handlers).toHaveProperty("findElement");
      expect(handlers).toHaveProperty("executeSequence");
      expect(handlers).toHaveProperty("navigateToState");

      engine.dispose();
    });
  });
});
