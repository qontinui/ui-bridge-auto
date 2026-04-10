/**
 * DOM action implementations — the single source of truth for how UI actions
 * (click, type, scroll, drag, etc.) are performed on DOM elements.
 *
 * Mirrors the qontinui Python library's action model: one definition per action.
 * Includes React-specific workarounds for controlled inputs and event delegation.
 *
 * Implementations are organized by interaction category:
 * - mouse-actions.ts: click, double-click, right-click, middle-click, hover, drag
 * - keyboard-actions.ts: type, sendKeys
 * - form-actions.ts: clear, select, focus, blur, check, toggle, setValue, submit, reset, autocomplete
 * - scroll-actions.ts: scroll, scrollIntoView
 *
 * This file re-exports all actions and provides the performAction dispatcher.
 */

import { sleep } from "./dom-helpers";
import type { MouseActionParams } from "./dom-helpers";

// Re-export all action implementations and types from sub-modules
export { performClick, performDoubleClick, performRightClick, performMiddleClick, performHover, performDrag, type DragParams } from "./mouse-actions";
export { performType, performSendKeys, type TypeParams, type SendKeysParams } from "./keyboard-actions";
export { performClear, performSelect, performFocus, performBlur, performCheck, performToggle, performSetValue, performSubmit, performReset, performAutocomplete, type SelectParams, type AutocompleteParams } from "./form-actions";
export { performScroll, performScrollIntoView, type ScrollParams, type ScrollIntoViewParams } from "./scroll-actions";

// Import for dispatcher
import { performClick, performDoubleClick, performRightClick, performMiddleClick, performHover, performDrag, type DragParams } from "./mouse-actions";
import { performType, performSendKeys, type TypeParams, type SendKeysParams } from "./keyboard-actions";
import { performClear, performSelect, performFocus, performBlur, performCheck, performToggle, performSetValue, performSubmit, performReset, performAutocomplete, type SelectParams, type AutocompleteParams } from "./form-actions";
import { performScroll, performScrollIntoView, type ScrollParams, type ScrollIntoViewParams } from "./scroll-actions";

/**
 * 21. Dispatcher — routes action names to the correct perform* function.
 *
 * Also handles auto-hover for opacity:0 elements (revealed on parent hover).
 * Replaces the SDK's switch statement with a standalone dispatcher.
 */
export async function performAction(
  element: HTMLElement,
  action: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  // Auto-hover parent if element is opacity-hidden (e.g., close button revealed on hover)
  if (typeof window !== "undefined") {
    const computedStyle = window.getComputedStyle(element);
    if (parseFloat(computedStyle.opacity) === 0 && element.parentElement) {
      performHover(element.parentElement);
      await sleep(100);
    }
  }

  switch (action) {
    case "click":
      return performClick(element, params as MouseActionParams);
    case "doubleClick":
      return performDoubleClick(element, params as MouseActionParams);
    case "rightClick":
      return performRightClick(element, params as MouseActionParams);
    case "middleClick":
      return performMiddleClick(element, params as MouseActionParams);
    case "type":
      return performType(element, params as TypeParams);
    case "sendKeys":
      return performSendKeys(element, params as SendKeysParams);
    case "clear":
      return performClear(element);
    case "select":
      return performSelect(element, params as SelectParams);
    case "focus":
      return performFocus(element);
    case "blur":
      return performBlur(element);
    case "hover":
      return performHover(element);
    case "scroll":
      return performScroll(element, params as ScrollParams);
    case "scrollIntoView":
      return performScrollIntoView(element, params as ScrollIntoViewParams);
    case "check":
      return performCheck(element, true);
    case "uncheck":
      return performCheck(element, false);
    case "toggle":
      return performToggle(element);
    case "drag":
      return performDrag(element, params as DragParams);
    case "setValue":
      return performSetValue(element, params as { value: string });
    case "submit":
      return performSubmit(element);
    case "reset":
      return performReset(element);
    case "autocomplete":
      return performAutocomplete(element, params as unknown as AutocompleteParams);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
