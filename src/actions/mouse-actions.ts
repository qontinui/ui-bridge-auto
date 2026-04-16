/**
 * Mouse action implementations — click, double-click, right-click, middle-click,
 * hover, and drag.
 */

import {
  createMouseEvent,
  createMouseEventAt,
  elementFromPointSafe,
  sleep,
  type MouseActionParams,
} from "./dom-helpers";

// ---------------------------------------------------------------------------
// Click retargeting — handle non-interactive wrappers around real buttons.
//
// Common case: React toggle rendered as <div><button>...</button></div> with
// the outer <div> carrying the title/aria-label. A native .click() on the
// wrapper does not bubble into React's SyntheticEvent delegation because the
// onClick is attached to the inner <button>. We detect this case and retarget
// the click to the single interactive descendant (if unambiguous).
// ---------------------------------------------------------------------------

const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], [role="link"], [role="switch"], ' +
  '[role="checkbox"], [role="tab"], [role="menuitem"], ' +
  'input, select, textarea, [tabindex]:not([tabindex="-1"])';

function isInteractive(el: HTMLElement): boolean {
  if (
    el.tagName === "BUTTON" ||
    el.tagName === "A" ||
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA"
  )
    return true;
  const role = el.getAttribute("role");
  if (
    role === "button" ||
    role === "link" ||
    role === "switch" ||
    role === "checkbox" ||
    role === "tab" ||
    role === "menuitem"
  )
    return true;
  const tabIndex = el.getAttribute("tabindex");
  if (tabIndex !== null && tabIndex !== "-1") return true;
  return false;
}

/**
 * If `el` itself is interactive, return it unchanged. Otherwise, if there is
 * exactly one interactive descendant, retarget to it. If there are zero or
 * multiple interactive descendants, return the original element (ambiguity
 * means the caller's selector should be narrower — don't guess).
 *
 * Exported for unit testing. Not part of the public API.
 */
export function retargetForClick(el: HTMLElement): HTMLElement {
  if (isInteractive(el)) return el;
  const candidates = Array.from(el.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR));
  return candidates.length === 1 ? candidates[0] : el;
}

/**
 * 1. Click — mousedown + mouseup + native click() + anchor fallback.
 *
 * Uses native click() because it works with React's event delegation.
 * dispatchEvent(new MouseEvent('click')) does NOT trigger React onClick
 * because React 17+ delegates events at the root and doesn't intercept
 * programmatically dispatched events.
 *
 * When `element` is a non-interactive wrapper with a single interactive
 * descendant (e.g., <div title="..."><button/></div>), we retarget the click
 * to the descendant so React's SyntheticEvent delegation fires. All other
 * event dispatch still uses the original element so hover / focus semantics
 * are preserved if the wrapper has its own handlers.
 */
export function performClick(element: HTMLElement, params?: MouseActionParams): void {
  const clickTarget = retargetForClick(element);
  element.dispatchEvent(createMouseEvent("mousedown", element, params));
  element.dispatchEvent(createMouseEvent("mouseup", element, params));
  clickTarget.click();

  // Anchor navigation fallback: native click already handles this,
  // but keep for elements inside anchors where element !== anchor.
  const anchor = clickTarget.closest("a");
  if (anchor && anchor !== clickTarget && anchor.hasAttribute("href")) {
    anchor.click();
  }
}

/**
 * 2. Double-click — two clicks + dblclick event.
 */
export function performDoubleClick(element: HTMLElement, params?: MouseActionParams): void {
  performClick(element, params);
  performClick(element, params);
  element.dispatchEvent(createMouseEvent("dblclick", element, params));
}

/**
 * 3. Right-click — mousedown(right) + mouseup(right) + contextmenu(right).
 *
 * Right-click does not use native .click(), so retargeting is not applied —
 * the contextmenu event bubbles from the original element naturally.
 */
export function performRightClick(element: HTMLElement, params?: MouseActionParams): void {
  const opts: MouseActionParams = { ...params, button: "right" };
  element.dispatchEvent(createMouseEvent("mousedown", element, opts));
  element.dispatchEvent(createMouseEvent("mouseup", element, opts));
  element.dispatchEvent(createMouseEvent("contextmenu", element, opts));
}

/**
 * 4. Middle-click — mousedown(middle) + mouseup(middle) + auxclick(middle).
 *
 * Browsers fire 'auxclick' (not 'click') for non-primary button clicks.
 * React's onAuxClick handler listens for this event type. Like right-click,
 * this path does not use native .click() and so does not retarget.
 */
export function performMiddleClick(element: HTMLElement, params?: MouseActionParams): void {
  const opts: MouseActionParams = { ...params, button: "middle" };
  element.dispatchEvent(createMouseEvent("mousedown", element, opts));
  element.dispatchEvent(createMouseEvent("mouseup", element, opts));
  element.dispatchEvent(createMouseEvent("auxclick", element, opts));
}

/**
 * 11. Hover — mouseenter + mouseover.
 */
export function performHover(element: HTMLElement): void {
  element.dispatchEvent(createMouseEvent("mouseenter", element));
  element.dispatchEvent(createMouseEvent("mouseover", element));
}

/** Parameters for drag actions. */
export interface DragParams {
  target?: { elementId?: string; selector?: string };
  targetPosition?: { x: number; y: number };
  sourceOffset?: { x: number; y: number };
  targetOffset?: { x: number; y: number };
  steps?: number;
  holdDelay?: number;
  releaseDelay?: number;
  html5?: boolean;
  /** Resolver for target elementId — provided by the executor. */
  resolveElement?: (id: string) => HTMLElement | null;
}

/**
 * 16. Drag — full mouse event sequence + optional HTML5 drag events.
 *
 * Follows the composite pattern: mousedown on source -> wait -> mousemove x N
 * along path -> mouseup on target. Optionally dispatches HTML5 drag events
 * (dragstart/dragover/drop/dragend) for apps that use the HTML5 DnD API.
 */
export async function performDrag(
  element: HTMLElement,
  params?: DragParams,
): Promise<{ warning?: string }> {
  const sourceRect = element.getBoundingClientRect();
  const sourceX = sourceRect.left + (params?.sourceOffset?.x ?? sourceRect.width / 2);
  const sourceY = sourceRect.top + (params?.sourceOffset?.y ?? sourceRect.height / 2);

  // Check if element appears to be draggable
  const computedStyle = window.getComputedStyle(element);
  const isDraggable =
    element.draggable ||
    element.getAttribute("aria-grabbed") !== null ||
    element.getAttribute("role") === "slider" ||
    computedStyle.cursor === "grab" ||
    computedStyle.cursor === "move" ||
    computedStyle.cursor === "grabbing";

  // Resolve target position
  let targetX: number;
  let targetY: number;

  if (params?.targetPosition) {
    targetX = params.targetPosition.x;
    targetY = params.targetPosition.y;
  } else if (params?.target) {
    let targetElement: HTMLElement | null = null;

    if (params.target.elementId && params.resolveElement) {
      targetElement = params.resolveElement(params.target.elementId);
    } else if (params.target.selector) {
      targetElement = document.querySelector<HTMLElement>(params.target.selector);
    }

    if (!targetElement) {
      throw new Error(`Drag target element not found: ${JSON.stringify(params.target)}`);
    }
    const targetRect = targetElement.getBoundingClientRect();
    targetX = targetRect.left + (params?.targetOffset?.x ?? targetRect.width / 2);
    targetY = targetRect.top + (params?.targetOffset?.y ?? targetRect.height / 2);
  } else {
    throw new Error("Drag requires either target or targetPosition");
  }

  const steps = params?.steps ?? 10;
  const holdDelay = params?.holdDelay ?? 100;
  const releaseDelay = params?.releaseDelay ?? 50;

  // 1. Dispatch mousedown on source
  element.dispatchEvent(createMouseEventAt("mousedown", sourceX, sourceY));

  // 2. Optionally dispatch dragstart (HTML5 mode, requires DragEvent support)
  const canHTML5 = params?.html5 && typeof DragEvent !== "undefined";
  if (canHTML5) {
    element.dispatchEvent(
      new DragEvent("dragstart", {
        bubbles: true,
        cancelable: true,
        clientX: sourceX,
        clientY: sourceY,
      }),
    );
  }

  // 3. Wait hold delay (matches qontinui core's delay_between_mouse_down_and_move)
  if (holdDelay > 0) {
    await sleep(holdDelay);
  }

  // 4. Dispatch intermediate mousemove events along the path
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const currentX = sourceX + (targetX - sourceX) * progress;
    const currentY = sourceY + (targetY - sourceY) * progress;

    // Find the element under the cursor (falls back to source if unavailable)
    const dispatchTarget = elementFromPointSafe(currentX, currentY) || element;

    dispatchTarget.dispatchEvent(createMouseEventAt("mousemove", currentX, currentY));

    if (canHTML5) {
      dispatchTarget.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: currentX,
          clientY: currentY,
        }),
      );
    }
  }

  // 5. Dispatch mouseup on the element under the final position
  const dropTarget = elementFromPointSafe(targetX, targetY) || element;
  dropTarget.dispatchEvent(createMouseEventAt("mouseup", targetX, targetY));

  // 6. Optionally dispatch drop + dragend (HTML5 mode)
  if (canHTML5) {
    dropTarget.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        clientX: targetX,
        clientY: targetY,
      }),
    );
    element.dispatchEvent(
      new DragEvent("dragend", {
        bubbles: true,
        cancelable: true,
        clientX: targetX,
        clientY: targetY,
      }),
    );
  }

  // 7. Wait release delay (matches qontinui core's delay_after_drag)
  if (releaseDelay > 0) {
    await sleep(releaseDelay);
  }

  return {
    warning: isDraggable
      ? undefined
      : "Element does not appear to be draggable (no draggable attribute, aria-grabbed, or grab/move cursor). Drag events were dispatched but may have no effect.",
  };
}
