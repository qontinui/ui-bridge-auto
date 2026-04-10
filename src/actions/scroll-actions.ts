/**
 * Scroll and navigation action implementations.
 */

import { findScrollableElement } from "./dom-helpers";

// ---- Parameter types ----

export interface ScrollParams {
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  deltaY?: number;
  deltaX?: number;
  position?: { x: number; y: number };
  toElement?: string;
  smooth?: boolean;
}

export interface ScrollIntoViewParams {
  smooth?: boolean;
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
}

// ---- Implementations ----

/**
 * 12. Scroll — multi-mode scroll with smooth wait.
 *
 * Supports: directional scroll, delta-based scroll, position-based scroll,
 * and scroll-to-element. Returns scroll info with before/after positions.
 */
export async function performScroll(
  element: HTMLElement,
  params?: ScrollParams,
): Promise<{ scrollInfo: { before: { scrollTop: number; scrollLeft: number }; after: { scrollTop: number; scrollLeft: number }; changed: boolean } }> {
  const scrollTarget = findScrollableElement(element);
  const isSmooth = !!params?.smooth;

  // Capture pre-scroll state
  const before = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };

  if (params?.toElement) {
    const target = document.querySelector<HTMLElement>(params.toElement);
    if (target) {
      target.scrollIntoView({ behavior: isSmooth ? "smooth" : "auto" });
    }
  } else if (params?.position) {
    scrollTarget.scrollTo({
      left: params.position.x,
      top: params.position.y,
      behavior: isSmooth ? "smooth" : "auto",
    });
  } else if (params?.deltaY !== undefined || params?.deltaX !== undefined) {
    // deltaY/deltaX use wheel-event semantics: positive = down/right, negative = up/left.
    const dx = params.deltaX ?? 0;
    const dy = params.deltaY ?? 0;
    scrollTarget.scrollBy({ left: dx, top: dy, behavior: isSmooth ? "smooth" : "auto" });
  } else {
    const amount = params?.amount || 100;
    const direction = params?.direction || "down";

    switch (direction) {
      case "up":
        scrollTarget.scrollBy({ top: -amount, behavior: isSmooth ? "smooth" : "auto" });
        break;
      case "down":
        scrollTarget.scrollBy({ top: amount, behavior: isSmooth ? "smooth" : "auto" });
        break;
      case "left":
        scrollTarget.scrollBy({ left: -amount, behavior: isSmooth ? "smooth" : "auto" });
        break;
      case "right":
        scrollTarget.scrollBy({ left: amount, behavior: isSmooth ? "smooth" : "auto" });
        break;
    }
  }

  // For smooth scrolling, wait for the animation to complete before capturing
  if (isSmooth) {
    await new Promise<void>((resolve) => {
      let lastTop = scrollTarget.scrollTop;
      let lastLeft = scrollTarget.scrollLeft;
      let stableFrames = 0;
      const check = () => {
        if (scrollTarget.scrollTop === lastTop && scrollTarget.scrollLeft === lastLeft) {
          stableFrames++;
          if (stableFrames >= 3) {
            resolve();
            return;
          }
        } else {
          stableFrames = 0;
          lastTop = scrollTarget.scrollTop;
          lastLeft = scrollTarget.scrollLeft;
        }
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(check);
        } else {
          setTimeout(check, 16);
        }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(check);
      } else {
        setTimeout(check, 16);
      }
      // Safety timeout: don't wait more than 1s
      setTimeout(resolve, 1000);
    });
  }

  // For non-smooth (instant) scrolls, yield one frame so the browser
  // applies the scroll position before we read it
  if (!isSmooth) {
    await new Promise<void>((r) => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => r());
      } else {
        setTimeout(r, 0);
      }
    });
  }

  // Capture post-scroll state
  const after = { scrollTop: scrollTarget.scrollTop, scrollLeft: scrollTarget.scrollLeft };

  return {
    scrollInfo: {
      before,
      after,
      changed: before.scrollTop !== after.scrollTop || before.scrollLeft !== after.scrollLeft,
    },
  };
}

/**
 * 13. ScrollIntoView — scrollIntoView with alignment options.
 */
export function performScrollIntoView(element: HTMLElement, params?: ScrollIntoViewParams): void {
  element.scrollIntoView({
    behavior: params?.smooth ? "smooth" : "auto",
    block: params?.block || "center",
    inline: params?.inline || "nearest",
  });
}
