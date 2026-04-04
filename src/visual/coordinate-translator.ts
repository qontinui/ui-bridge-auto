/**
 * Coordinate translation between viewport, page, screen, and element-local
 * coordinate spaces.
 *
 * All browser-based automation operates in viewport coordinates, but there
 * are scenarios where page (document), screen, or element-local coordinates
 * are needed — for example, when capturing screenshots of scrolled-out
 * elements or translating through nested iframes.
 *
 * @example
 * ```ts
 * const translator = new CoordinateTranslator();
 *
 * // Convert viewport coordinates to page (document) coordinates
 * const pagePoint = translator.viewportToPage({ x: 100, y: 200 });
 *
 * // Convert an element-local point to viewport coordinates
 * const vpPoint = translator.elementToViewport({ x: 10, y: 5 }, myElement);
 * ```
 */

import type { ViewportRegion } from "../types/region";
import type { CoordinatePoint, FrameOffset } from "./types";

// ---------------------------------------------------------------------------
// Window abstraction for testability
// ---------------------------------------------------------------------------

/**
 * Minimal window interface used by the translator.
 * Allows injection of a mock window in tests.
 */
export interface WindowLike {
  scrollX: number;
  scrollY: number;
  screenX: number;
  screenY: number;
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
}

// ---------------------------------------------------------------------------
// CoordinateTranslator
// ---------------------------------------------------------------------------

/**
 * Translates coordinates between viewport, page, screen, and element-local
 * coordinate spaces.
 *
 * Constructor accepts an optional `window` reference for testability.
 * When omitted, uses `globalThis.window`.
 */
export class CoordinateTranslator {
  private readonly win: WindowLike;

  constructor(win?: WindowLike) {
    this.win = win ?? (globalThis.window as unknown as WindowLike);
  }

  // -----------------------------------------------------------------------
  // Viewport <-> Page
  // -----------------------------------------------------------------------

  /**
   * Convert viewport coordinates to page (document) coordinates.
   *
   * Adds the current scroll offsets, so a point at the top-left of the
   * visible viewport maps to its absolute document position.
   */
  viewportToPage(point: CoordinatePoint): CoordinatePoint {
    return {
      x: point.x + this.win.scrollX,
      y: point.y + this.win.scrollY,
    };
  }

  /**
   * Convert page (document) coordinates to viewport coordinates.
   *
   * Subtracts the current scroll offsets.
   */
  pageToViewport(point: CoordinatePoint): CoordinatePoint {
    return {
      x: point.x - this.win.scrollX,
      y: point.y - this.win.scrollY,
    };
  }

  // -----------------------------------------------------------------------
  // Viewport <-> Screen
  // -----------------------------------------------------------------------

  /**
   * Convert viewport coordinates to screen coordinates (best-effort estimate).
   *
   * Uses `window.screenX/screenY` for the browser window position and
   * estimates the chrome (toolbar/tab bar) offset from the difference between
   * `outerWidth/Height` and `innerWidth/Height`.
   *
   * **Limitation:** The exact viewport offset within the browser window cannot
   * be determined precisely in all browsers. This provides a best-effort
   * estimate.
   */
  viewportToScreen(point: CoordinatePoint): CoordinatePoint {
    const chromeOffsetX = this.win.outerWidth - this.win.innerWidth;
    const chromeOffsetY = this.win.outerHeight - this.win.innerHeight;

    return {
      x: point.x + this.win.screenX + chromeOffsetX,
      y: point.y + this.win.screenY + chromeOffsetY,
    };
  }

  /**
   * Convert screen coordinates to viewport coordinates (best-effort estimate).
   *
   * Inverse of {@link viewportToScreen}. Same accuracy limitations apply.
   */
  screenToViewport(point: CoordinatePoint): CoordinatePoint {
    const chromeOffsetX = this.win.outerWidth - this.win.innerWidth;
    const chromeOffsetY = this.win.outerHeight - this.win.innerHeight;

    return {
      x: point.x - this.win.screenX - chromeOffsetX,
      y: point.y - this.win.screenY - chromeOffsetY,
    };
  }

  // -----------------------------------------------------------------------
  // Element <-> Viewport
  // -----------------------------------------------------------------------

  /**
   * Convert a point relative to an element's top-left corner into viewport
   * coordinates.
   *
   * @param point - Point relative to the element's origin.
   * @param element - The reference DOM element.
   */
  elementToViewport(point: CoordinatePoint, element: HTMLElement): CoordinatePoint {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + point.x,
      y: rect.top + point.y,
    };
  }

  /**
   * Convert viewport coordinates to a point relative to an element's
   * top-left corner.
   *
   * @param point - Point in viewport coordinates.
   * @param element - The reference DOM element.
   */
  viewportToElement(point: CoordinatePoint, element: HTMLElement): CoordinatePoint {
    const rect = element.getBoundingClientRect();
    return {
      x: point.x - rect.left,
      y: point.y - rect.top,
    };
  }

  // -----------------------------------------------------------------------
  // Element <-> Page
  // -----------------------------------------------------------------------

  /**
   * Convert a point relative to an element's origin into page (document)
   * coordinates.
   *
   * Chains {@link elementToViewport} then {@link viewportToPage}.
   */
  elementToPage(point: CoordinatePoint, element: HTMLElement): CoordinatePoint {
    return this.viewportToPage(this.elementToViewport(point, element));
  }

  /**
   * Convert page (document) coordinates to a point relative to an element's
   * origin.
   *
   * Chains {@link pageToViewport} then {@link viewportToElement}.
   */
  pageToElement(point: CoordinatePoint, element: HTMLElement): CoordinatePoint {
    return this.viewportToElement(this.pageToViewport(point), element);
  }

  // -----------------------------------------------------------------------
  // Scroll target
  // -----------------------------------------------------------------------

  /**
   * Compute the page-coordinate point that `scrollIntoView` would target
   * for the given element.
   *
   * Returns the element's top-left corner in page coordinates, which is
   * the position the viewport would scroll to in order to bring the element
   * into view.
   */
  getScrollIntoViewTarget(element: HTMLElement): CoordinatePoint {
    return this.elementToPage({ x: 0, y: 0 }, element);
  }

  // -----------------------------------------------------------------------
  // Region translation
  // -----------------------------------------------------------------------

  /**
   * Translate a viewport-pixel region to page (document) coordinates.
   *
   * Structurally identical to ViewportRegion but with scroll offsets applied.
   */
  regionToPage(region: ViewportRegion): ViewportRegion {
    return {
      x: region.x + this.win.scrollX,
      y: region.y + this.win.scrollY,
      width: region.width,
      height: region.height,
    };
  }

  // -----------------------------------------------------------------------
  // Iframe translation
  // -----------------------------------------------------------------------

  /**
   * Resolve the viewport offset introduced by an iframe element.
   *
   * Returns the iframe's bounding rect position, which is the offset
   * applied to all coordinates inside that frame.
   */
  resolveFrameOffset(iframeElement: HTMLIFrameElement): FrameOffset {
    const rect = iframeElement.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      frameElement: iframeElement,
    };
  }

  /**
   * Translate a point through a chain of nested iframes, accumulating
   * their viewport offsets.
   *
   * The point should be in the innermost frame's coordinate space. The
   * frames array should be ordered from innermost to outermost.
   *
   * **Limitation:** Cross-origin iframes cannot be accessed. If a
   * `SecurityError` is encountered, the accumulated offset up to that
   * point is returned.
   *
   * @param point - Point in the innermost frame's coordinate space.
   * @param frames - Iframe elements from innermost to outermost.
   * @returns The point translated to the outermost frame's viewport coordinates.
   */
  translateThroughFrames(
    point: CoordinatePoint,
    frames: HTMLIFrameElement[],
  ): CoordinatePoint {
    let result: CoordinatePoint = { x: point.x, y: point.y };

    for (const frame of frames) {
      try {
        const offset = this.resolveFrameOffset(frame);
        result = {
          x: result.x + offset.x,
          y: result.y + offset.y,
        };
      } catch (e: unknown) {
        // Cross-origin SecurityError — return best-effort result
        if (e instanceof DOMException) {
          break;
        }
        throw e;
      }
    }

    return result;
  }
}
