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
 *
 * Returns a small status object so callers can tell whether a scroll
 * actually happened. When the element is already fully inside the viewport
 * we skip the underlying `scrollIntoView()` call entirely and report
 * `alreadyVisible: true, scrolled: false`. This makes scrollIntoView a
 * no-op-success in the common pre-click case (an agent eagerly scrolls a
 * button into view before clicking it, even though the button was already
 * visible), instead of producing a confusing failure log when downstream
 * detectors observe "no change".
 *
 * Only fully-visible elements short-circuit: an element that is partially
 * clipped still gets the scroll so its `block`/`inline` alignment can take
 * effect. Element-not-in-DOM is *not* handled here — the caller's element
 * resolution has already failed in that case.
 */
export function performScrollIntoView(
  element: HTMLElement,
  params?: ScrollIntoViewParams,
): { alreadyVisible: boolean; scrolled: boolean } {
  // Only honour the early-return when we have a usable viewport. In jsdom
  // and other non-browser hosts `window.innerWidth/innerHeight` may be 0
  // and `getBoundingClientRect` is a stub — fall through to the native
  // call so the legacy semantics are preserved.
  if (
    typeof window !== "undefined" &&
    window.innerWidth > 0 &&
    window.innerHeight > 0 &&
    typeof element.getBoundingClientRect === "function"
  ) {
    const rect = element.getBoundingClientRect();
    const fullyVisible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;
    if (fullyVisible) {
      return { alreadyVisible: true, scrolled: false };
    }
  }

  element.scrollIntoView({
    behavior: params?.smooth ? "smooth" : "auto",
    block: params?.block || "center",
    inline: params?.inline || "nearest",
  });
  return { alreadyVisible: false, scrolled: true };
}
