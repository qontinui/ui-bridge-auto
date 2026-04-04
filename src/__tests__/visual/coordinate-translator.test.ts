import { describe, it, expect, beforeEach } from "vitest";
import { CoordinateTranslator, type WindowLike } from "../../visual/coordinate-translator";

// ---------------------------------------------------------------------------
// Mock window
// ---------------------------------------------------------------------------

function createMockWindow(overrides: Partial<WindowLike> = {}): WindowLike {
  return {
    scrollX: 0,
    scrollY: 0,
    screenX: 100,
    screenY: 50,
    innerWidth: 1280,
    innerHeight: 720,
    outerWidth: 1300,
    outerHeight: 800,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock element with controllable getBoundingClientRect
// ---------------------------------------------------------------------------

function createMockElement(
  left: number,
  top: number,
  width: number,
  height: number,
): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  });
  return el;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CoordinateTranslator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // -----------------------------------------------------------------------
  // Viewport <-> Page
  // -----------------------------------------------------------------------

  describe("viewportToPage / pageToViewport", () => {
    it("adds scroll offsets for viewport-to-page", () => {
      const win = createMockWindow({ scrollX: 200, scrollY: 500 });
      const t = new CoordinateTranslator(win);

      const result = t.viewportToPage({ x: 100, y: 50 });
      expect(result).toEqual({ x: 300, y: 550 });
    });

    it("subtracts scroll offsets for page-to-viewport", () => {
      const win = createMockWindow({ scrollX: 200, scrollY: 500 });
      const t = new CoordinateTranslator(win);

      const result = t.pageToViewport({ x: 300, y: 550 });
      expect(result).toEqual({ x: 100, y: 50 });
    });

    it("roundtrips viewport -> page -> viewport", () => {
      const win = createMockWindow({ scrollX: 123, scrollY: 456 });
      const t = new CoordinateTranslator(win);
      const original = { x: 42, y: 99 };

      const roundtrip = t.pageToViewport(t.viewportToPage(original));
      expect(roundtrip).toEqual(original);
    });

    it("is identity when not scrolled", () => {
      const win = createMockWindow({ scrollX: 0, scrollY: 0 });
      const t = new CoordinateTranslator(win);

      expect(t.viewportToPage({ x: 50, y: 75 })).toEqual({ x: 50, y: 75 });
      expect(t.pageToViewport({ x: 50, y: 75 })).toEqual({ x: 50, y: 75 });
    });

    it("handles negative viewport coordinates (partially scrolled-out elements)", () => {
      const win = createMockWindow({ scrollX: 100, scrollY: 200 });
      const t = new CoordinateTranslator(win);

      const result = t.viewportToPage({ x: -50, y: -100 });
      expect(result).toEqual({ x: 50, y: 100 });
    });
  });

  // -----------------------------------------------------------------------
  // Viewport <-> Screen
  // -----------------------------------------------------------------------

  describe("viewportToScreen / screenToViewport", () => {
    it("adds screen position and chrome offset", () => {
      const win = createMockWindow({
        screenX: 100,
        screenY: 50,
        innerWidth: 1280,
        innerHeight: 720,
        outerWidth: 1300, // 20px chrome on sides
        outerHeight: 800, // 80px chrome on top
      });
      const t = new CoordinateTranslator(win);

      const result = t.viewportToScreen({ x: 0, y: 0 });
      // screenX + chromeOffsetX = 100 + 20 = 120
      // screenY + chromeOffsetY = 50 + 80 = 130
      expect(result).toEqual({ x: 120, y: 130 });
    });

    it("roundtrips viewport -> screen -> viewport", () => {
      const win = createMockWindow({
        screenX: 200,
        screenY: 100,
        outerWidth: 1400,
        outerHeight: 900,
        innerWidth: 1280,
        innerHeight: 720,
      });
      const t = new CoordinateTranslator(win);
      const original = { x: 500, y: 300 };

      const roundtrip = t.screenToViewport(t.viewportToScreen(original));
      expect(roundtrip).toEqual(original);
    });

    it("handles zero chrome offset", () => {
      const win = createMockWindow({
        screenX: 0,
        screenY: 0,
        innerWidth: 1280,
        innerHeight: 720,
        outerWidth: 1280,
        outerHeight: 720,
      });
      const t = new CoordinateTranslator(win);

      expect(t.viewportToScreen({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    });

    it("screen translation is independent of scroll position", () => {
      const win = createMockWindow({
        scrollX: 500,
        scrollY: 1000,
        screenX: 100,
        screenY: 50,
        outerWidth: 1280,
        outerHeight: 720,
        innerWidth: 1280,
        innerHeight: 720,
      });
      const t = new CoordinateTranslator(win);

      // Scroll should NOT affect screen coordinates — viewport-to-screen
      // is about physical screen position, not document position
      const result = t.viewportToScreen({ x: 10, y: 20 });
      expect(result).toEqual({ x: 110, y: 70 });
    });
});

  // -----------------------------------------------------------------------
  // Element <-> Viewport
  // -----------------------------------------------------------------------

  describe("elementToViewport / viewportToElement", () => {
    it("offsets by element bounding rect", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const el = createMockElement(150, 200, 300, 100);

      const result = t.elementToViewport({ x: 10, y: 5 }, el);
      expect(result).toEqual({ x: 160, y: 205 });
    });

    it("inverse: viewport point to element-local", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const el = createMockElement(150, 200, 300, 100);

      const result = t.viewportToElement({ x: 160, y: 205 }, el);
      expect(result).toEqual({ x: 10, y: 5 });
    });

    it("origin (0,0) in element maps to element top-left in viewport", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const el = createMockElement(42, 99, 200, 50);

      expect(t.elementToViewport({ x: 0, y: 0 }, el)).toEqual({ x: 42, y: 99 });
    });

    it("roundtrips element -> viewport -> element", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const el = createMockElement(300, 400, 100, 50);
      const original = { x: 25, y: 10 };

      const roundtrip = t.viewportToElement(t.elementToViewport(original, el), el);
      expect(roundtrip).toEqual(original);
    });
  });

  // -----------------------------------------------------------------------
  // Element <-> Page
  // -----------------------------------------------------------------------

  describe("elementToPage / pageToElement", () => {
    it("chains element -> viewport -> page", () => {
      const win = createMockWindow({ scrollX: 100, scrollY: 200 });
      const t = new CoordinateTranslator(win);
      const el = createMockElement(50, 75, 200, 100);

      const result = t.elementToPage({ x: 10, y: 5 }, el);
      // elementToViewport: (50+10, 75+5) = (60, 80)
      // viewportToPage: (60+100, 80+200) = (160, 280)
      expect(result).toEqual({ x: 160, y: 280 });
    });

    it("roundtrips element -> page -> element", () => {
      const win = createMockWindow({ scrollX: 300, scrollY: 150 });
      const t = new CoordinateTranslator(win);
      const el = createMockElement(100, 200, 50, 50);
      const original = { x: 15, y: 20 };

      const roundtrip = t.pageToElement(t.elementToPage(original, el), el);
      expect(roundtrip).toEqual(original);
    });
  });

  // -----------------------------------------------------------------------
  // getScrollIntoViewTarget
  // -----------------------------------------------------------------------

  describe("getScrollIntoViewTarget", () => {
    it("returns element top-left in page coordinates", () => {
      const win = createMockWindow({ scrollX: 0, scrollY: 500 });
      const t = new CoordinateTranslator(win);
      const el = createMockElement(20, 100, 200, 50);

      const target = t.getScrollIntoViewTarget(el);
      // elementToPage({0,0}, el) => viewportToPage(elementToViewport({0,0}))
      // elementToViewport: (20, 100)
      // viewportToPage: (20+0, 100+500) = (20, 600)
      expect(target).toEqual({ x: 20, y: 600 });
    });
  });

  // -----------------------------------------------------------------------
  // regionToPage
  // -----------------------------------------------------------------------

  describe("regionToPage", () => {
    it("translates region by scroll offsets", () => {
      const win = createMockWindow({ scrollX: 50, scrollY: 300 });
      const t = new CoordinateTranslator(win);

      const result = t.regionToPage({ x: 10, y: 20, width: 100, height: 50 });
      expect(result).toEqual({ x: 60, y: 320, width: 100, height: 50 });
    });

    it("preserves width and height", () => {
      const win = createMockWindow({ scrollX: 999, scrollY: 999 });
      const t = new CoordinateTranslator(win);

      const result = t.regionToPage({ x: 0, y: 0, width: 400, height: 300 });
      expect(result.width).toBe(400);
      expect(result.height).toBe(300);
    });
  });

  // -----------------------------------------------------------------------
  // resolveFrameOffset
  // -----------------------------------------------------------------------

  describe("resolveFrameOffset", () => {
    it("returns iframe bounding rect position", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const iframe = createMockElement(100, 200, 800, 600) as unknown as HTMLIFrameElement;

      const offset = t.resolveFrameOffset(iframe);
      expect(offset.x).toBe(100);
      expect(offset.y).toBe(200);
      expect(offset.frameElement).toBe(iframe);
    });
  });

  // -----------------------------------------------------------------------
  // translateThroughFrames
  // -----------------------------------------------------------------------

  describe("translateThroughFrames", () => {
    it("accumulates offsets through nested iframes", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const inner = createMockElement(50, 30, 400, 300) as unknown as HTMLIFrameElement;
      const outer = createMockElement(100, 100, 800, 600) as unknown as HTMLIFrameElement;

      const result = t.translateThroughFrames({ x: 10, y: 20 }, [inner, outer]);
      // inner offset: (50, 30) => (60, 50)
      // outer offset: (100, 100) => (160, 150)
      expect(result).toEqual({ x: 160, y: 150 });
    });

    it("returns original point for empty frames array", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const result = t.translateThroughFrames({ x: 42, y: 99 }, []);
      expect(result).toEqual({ x: 42, y: 99 });
    });

    it("handles single frame", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const frame = createMockElement(200, 150, 600, 400) as unknown as HTMLIFrameElement;

      const result = t.translateThroughFrames({ x: 5, y: 10 }, [frame]);
      expect(result).toEqual({ x: 205, y: 160 });
    });

    it("stops gracefully on SecurityError (cross-origin)", () => {
      const t = new CoordinateTranslator(createMockWindow());
      const good = createMockElement(50, 50, 400, 300) as unknown as HTMLIFrameElement;

      // Create a frame that throws on getBoundingClientRect
      const bad = document.createElement("iframe") as HTMLIFrameElement;
      bad.getBoundingClientRect = () => {
        throw new DOMException("Blocked a frame", "SecurityError");
      };

      // good processes, bad stops
      const result = t.translateThroughFrames({ x: 10, y: 10 }, [good, bad]);
      expect(result).toEqual({ x: 60, y: 60 });
    });
  });
});
