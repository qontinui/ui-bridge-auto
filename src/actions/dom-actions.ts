/**
 * DOM action implementations — the single source of truth for how UI actions
 * (click, type, scroll, drag, etc.) are performed on DOM elements.
 *
 * Mirrors the qontinui Python library's action model: one definition per action.
 * Includes React-specific workarounds for controlled inputs and event delegation.
 */

import {
  createMouseEvent,
  createMouseEventAt,
  elementFromPointSafe,
  sleep,
  getNativeSetter,
  notifyReactValueChange,
  resetReactValueTracker,
  getReactProps,
  findOpenDropdown,
  findDropdownOption,
  findScrollableElement,
  keyToCode,
  NON_PRINTABLE_KEYS,
  type MouseActionParams,
} from "./dom-helpers";

// ---- Parameter types ----

export interface TypeParams {
  text?: string;
  clear?: boolean;
  delay?: number;
  triggerEvents?: boolean;
}

export interface SendKeysParams {
  keys?: Array<{
    key: string;
    modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
    holdDuration?: number;
  }>;
  delay?: number;
}

export interface SelectParams {
  value?: string | string[];
  byLabel?: boolean;
  additive?: boolean;
}

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

export interface AutocompleteParams {
  searchText: string;
  selectValue?: string;
  suggestionTimeout?: number;
  clear?: boolean;
}

// ---- Action implementations ----

/**
 * 1. Click — mousedown + mouseup + native click() + anchor fallback.
 *
 * Uses native click() because it works with React's event delegation.
 * dispatchEvent(new MouseEvent('click')) does NOT trigger React onClick
 * because React 17+ delegates events at the root and doesn't intercept
 * programmatically dispatched events.
 */
export function performClick(element: HTMLElement, params?: MouseActionParams): void {
  element.dispatchEvent(createMouseEvent("mousedown", element, params));
  element.dispatchEvent(createMouseEvent("mouseup", element, params));
  element.click();

  // Anchor navigation fallback: native click already handles this,
  // but keep for elements inside anchors where element !== anchor.
  const anchor = element.closest("a");
  if (anchor && anchor !== element && anchor.hasAttribute("href")) {
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
 * React's onAuxClick handler listens for this event type.
 */
export function performMiddleClick(element: HTMLElement, params?: MouseActionParams): void {
  const opts: MouseActionParams = { ...params, button: "middle" };
  element.dispatchEvent(createMouseEvent("mousedown", element, opts));
  element.dispatchEvent(createMouseEvent("mouseup", element, opts));
  element.dispatchEvent(createMouseEvent("auxclick", element, opts));
}

/**
 * 5. Type — React-compatible char-by-char typing.
 *
 * Uses the native value setter to bypass React's synthetic event system.
 * React overrides the value property; setting .value directly doesn't
 * trigger onChange. The native setter + dispatched 'input' event does.
 *
 * Also directly invokes __reactProps$.onChange for embedded WebViews (Tauri)
 * where React's event delegation may not receive bubbled synthetic events.
 */
export async function performType(element: HTMLElement, params?: TypeParams): Promise<void> {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("Type action requires an input or textarea element");
  }

  const nativeSetter = getNativeSetter(element);

  element.focus();

  if (params?.clear) {
    const prevClear = element.value;
    if (nativeSetter) {
      nativeSetter("");
    } else {
      element.value = "";
    }
    notifyReactValueChange(element, prevClear);
  }

  const text = params?.text || "";
  const delay = params?.delay || 0;

  for (const char of text) {
    const current = element.value;
    if (nativeSetter) {
      nativeSetter(current + char);
    } else {
      element.value = current + char;
    }
    if (params?.triggerEvents !== false) {
      notifyReactValueChange(element, current);
    }
    if (delay > 0) {
      await sleep(delay);
    }
  }

  if (params?.triggerEvents !== false) {
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * 6. SendKeys — real keyboard events: keydown/keypress/keyup.
 *
 * For each key descriptor, fires keydown -> keypress -> keyup (keypress is
 * skipped for non-printable keys like Enter, Escape, Arrow*, etc.).
 * This is the correct way to interact with elements that consume raw
 * keyboard events (xterm.js terminals, CodeMirror, Monaco, canvas games).
 */
export async function performSendKeys(element: HTMLElement, params?: SendKeysParams): Promise<void> {
  if (!params?.keys?.length) return;

  element.focus();
  const delay = params.delay || 0;

  for (const keyDesc of params.keys) {
    const { key } = keyDesc;
    if (!key || typeof key !== "string") continue;
    const mods = keyDesc.modifiers || {};
    const eventInit: KeyboardEventInit = {
      key,
      code: keyToCode(key),
      bubbles: true,
      cancelable: true,
      ctrlKey: mods.ctrl || false,
      shiftKey: mods.shift || false,
      altKey: mods.alt || false,
      metaKey: mods.meta || false,
    };

    element.dispatchEvent(new KeyboardEvent("keydown", eventInit));

    const isInputElement =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

    // Fire keypress for printable characters only (no modifiers except shift)
    if (key.length === 1 && !NON_PRINTABLE_KEYS.has(key) && !mods.ctrl && !mods.alt && !mods.meta) {
      element.dispatchEvent(new KeyboardEvent("keypress", eventInit));
      // Insert character into input/textarea value (keypress alone doesn't update .value)
      if (isInputElement) {
        const start = element.selectionStart ?? element.value.length;
        const end = element.selectionEnd ?? start;
        element.value = element.value.slice(0, start) + key + element.value.slice(end);
        element.selectionStart = element.selectionEnd = start + 1;
        element.dispatchEvent(
          new InputEvent("input", { bubbles: true, data: key, inputType: "insertText" }),
        );
      }
    } else if (key === "Backspace" && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
      // Handle Backspace: remove character before cursor
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      if (start !== end) {
        element.value = element.value.slice(0, start) + element.value.slice(end);
        element.selectionStart = element.selectionEnd = start;
      } else if (start > 0) {
        element.value = element.value.slice(0, start - 1) + element.value.slice(start);
        element.selectionStart = element.selectionEnd = start - 1;
      }
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
      );
    } else if (key === "Delete" && isInputElement && !mods.ctrl && !mods.alt && !mods.meta) {
      // Handle Delete: remove character after cursor (or selection)
      const start = element.selectionStart ?? element.value.length;
      const end = element.selectionEnd ?? start;
      if (start !== end) {
        element.value = element.value.slice(0, start) + element.value.slice(end);
        element.selectionStart = element.selectionEnd = start;
      } else if (start < element.value.length) {
        element.value = element.value.slice(0, start) + element.value.slice(start + 1);
        element.selectionStart = element.selectionEnd = start;
      }
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, inputType: "deleteContentForward" }),
      );
    }

    element.dispatchEvent(new KeyboardEvent("keyup", eventInit));

    if (delay > 0) {
      await sleep(delay);
    }
  }
}

/**
 * 7. Clear — set value to "" with React notification.
 */
export function performClear(element: HTMLElement): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return;
  }

  const previousValue = element.value;
  const nativeSetter = getNativeSetter(element);

  if (nativeSetter) {
    nativeSetter("");
  } else {
    element.value = "";
  }

  // Reset _valueTracker so React detects old !== new
  resetReactValueTracker(element, previousValue);
  element.dispatchEvent(new Event("input", { bubbles: true }));

  // Also invoke __reactProps$.onChange directly for embedded WebViews (Tauri)
  const reactProps = getReactProps(element);
  if (reactProps?.onChange && typeof reactProps.onChange === "function") {
    (reactProps.onChange as (e: unknown) => void)({
      target: element,
      currentTarget: element,
      type: "change",
      bubbles: true,
      preventDefault: () => {},
      stopPropagation: () => {},
      nativeEvent: new Event("input"),
    });
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * 8. Select — native select + combobox delegation.
 *
 * For native <select> elements: sets option.selected, resets React's
 * _valueTracker, and dispatches change events.
 * For combobox elements (role="combobox" or aria-expanded): clicks to open,
 * finds the dropdown, and clicks the matching option.
 */
export async function performSelect(element: HTMLElement, params?: SelectParams): Promise<void> {
  // Handle Radix/headless combobox elements (render as <button> with role="combobox")
  if (!(element instanceof HTMLSelectElement)) {
    const role = element.getAttribute("role");
    if (role === "combobox" || element.hasAttribute("aria-expanded")) {
      await performComboboxSelect(element, params);
      return;
    }
    throw new Error(
      `Cannot select on ${element.tagName}. Use a <select> element or a combobox (role="combobox").`,
    );
  }

  const values = Array.isArray(params?.value) ? params.value : [params?.value];

  // Save the old value before any changes — needed for React's value tracker
  const previousValue = element.value;

  if (!params?.additive) {
    for (let i = 0; i < element.options.length; i++) {
      element.options[i].selected = false;
    }
  }

  let selectedValue: string | undefined;
  for (let i = 0; i < element.options.length; i++) {
    const option = element.options[i];
    const matchValue = params?.byLabel ? option.text : option.value;
    if (values.includes(matchValue)) {
      option.selected = true;
      selectedValue = option.value;
    }
  }

  // React uses _valueTracker to compare old vs new values when handling
  // change events. Setting option.selected updates the DOM value through
  // React's intercepted setter, which also updates the tracker — making
  // React think old === new and skip the onChange call.
  // Fix: reset the tracker to the previous value so React detects the diff.
  resetReactValueTracker(element, previousValue);

  // Also try calling React's onChange handler directly via internal props.
  const reactProps = getReactProps(element);
  if (reactProps?.onChange && typeof reactProps.onChange === "function") {
    const syntheticEvent = {
      target: element,
      currentTarget: element,
      type: "change",
      bubbles: true,
      preventDefault: () => {},
      stopPropagation: () => {},
      nativeEvent: new Event("change"),
    };
    (reactProps.onChange as (e: unknown) => void)(syntheticEvent);
    return; // React handler called directly, no need for native events
  }

  // Use the native setter as well, for non-React environments
  if (selectedValue !== undefined) {
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    if (nativeSelectValueSetter) {
      nativeSelectValueSetter.call(element, selectedValue);
    }
  }

  // Dispatch events — React's event delegation will pick these up
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Handle select on combobox elements (Radix, headless UI, MUI, Select2, Ant Design, etc.)
 * Strategy: click to open -> find listbox/dropdown -> find option -> click option.
 */
async function performComboboxSelect(element: HTMLElement, params?: SelectParams): Promise<void> {
  const targetValue = Array.isArray(params?.value) ? params.value[0] : params?.value;
  if (!targetValue) {
    throw new Error("Select action on combobox requires a value");
  }

  // Click to open the combobox dropdown
  element.click();

  // Wait for the dropdown to render, then find and click the option.
  // Use a retry loop because some frameworks (MUI, Ant Design) render
  // the dropdown asynchronously after a paint cycle.
  return new Promise<void>((resolve) => {
    let attempts = 0;
    const maxAttempts = 5;
    const attemptInterval = 50;

    const tryFindOption = (): void => {
      attempts++;
      const dropdown = findOpenDropdown(element);

      if (!dropdown && attempts < maxAttempts) {
        setTimeout(tryFindOption, attemptInterval);
        return;
      }

      if (!dropdown) {
        console.warn(
          `[dom-actions] performComboboxSelect: dropdown not found after ${maxAttempts} attempts for value "${targetValue}"`,
        );
        resolve();
        return;
      }

      // Find matching option across various frameworks
      const matched = findDropdownOption(dropdown, targetValue, params?.byLabel);
      if (matched) {
        matched.click();
      } else {
        console.warn(
          `[dom-actions] performComboboxSelect: option "${targetValue}" not found in dropdown`,
        );
      }
      resolve();
    };

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(tryFindOption);
    } else {
      setTimeout(tryFindOption, 0);
    }
  });
}

/**
 * 9. Focus — focus() + FocusEvent.
 */
export function performFocus(element: HTMLElement): void {
  element.focus();
  element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
}

/**
 * 10. Blur — blur() + FocusEvent.
 */
export function performBlur(element: HTMLElement): void {
  element.blur();
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

/**
 * 11. Hover — mouseenter + mouseover.
 */
export function performHover(element: HTMLElement): void {
  element.dispatchEvent(createMouseEvent("mouseenter", element));
  element.dispatchEvent(createMouseEvent("mouseover", element));
}

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

/**
 * 14. Check — set checkbox/radio to a specific checked state, or toggle ARIA switch.
 */
export function performCheck(element: HTMLElement, checked: boolean): void {
  if (
    element instanceof HTMLInputElement &&
    (element.type === "checkbox" || element.type === "radio")
  ) {
    if (element.checked !== checked) {
      element.checked = checked;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (element.getAttribute("role") === "switch") {
    // React switch components toggle via click
    const isChecked = element.getAttribute("aria-checked") === "true";
    if (isChecked !== checked) {
      element.click();
    }
  }
}

/**
 * 15. Toggle — toggle checked state of checkbox or ARIA switch.
 */
export function performToggle(element: HTMLElement): void {
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    element.checked = !element.checked;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element.getAttribute("role") === "switch") {
    element.click();
  }
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

/**
 * 17. SetValue — set value directly with native setter + React tracking.
 */
export function performSetValue(element: HTMLElement, params?: { value: string }): void {
  const value = params?.value;
  if (value === undefined) {
    throw new Error('setValue requires a "value" parameter');
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const previousValue = element.value;

    const nativeSetter = getNativeSetter(element);
    if (nativeSetter) {
      nativeSetter(value);
    } else {
      element.value = value;
    }

    // Reset _valueTracker so React detects old !== new
    resetReactValueTracker(element, previousValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));

    // Also invoke __reactProps$.onChange directly for embedded WebViews (Tauri)
    const reactProps = getReactProps(element);
    if (reactProps?.onChange && typeof reactProps.onChange === "function") {
      (reactProps.onChange as (e: unknown) => void)({
        target: element,
        currentTarget: element,
        type: "change",
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
        nativeEvent: new Event("input"),
      });
    }

    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element instanceof HTMLSelectElement) {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/**
 * 18. Submit — dispatch submit event + requestSubmit().
 */
export function performSubmit(element: HTMLElement): void {
  const form = element instanceof HTMLFormElement ? element : element.closest("form");
  if (form) {
    // Dispatch submit event first (allows preventDefault)
    const submitEvent = new Event("submit", { bubbles: true, cancelable: true });
    if (form.dispatchEvent(submitEvent)) {
      form.requestSubmit();
    }
  } else {
    throw new Error("No form found for submit action");
  }
}

/**
 * 19. Reset — form.reset() + reset event.
 */
export function performReset(element: HTMLElement): void {
  const form = element instanceof HTMLFormElement ? element : element.closest("form");
  if (form) {
    form.reset();
    form.dispatchEvent(new Event("reset", { bubbles: true }));
  } else {
    throw new Error("No form found for reset action");
  }
}

/**
 * 20. Autocomplete — type search text, wait for dropdown suggestions, click match.
 */
export async function performAutocomplete(
  element: HTMLElement,
  params?: AutocompleteParams,
): Promise<void> {
  if (!params?.searchText) {
    throw new Error("Autocomplete action requires searchText parameter");
  }

  const timeout = params.suggestionTimeout ?? 2000;
  const selectValue = params.selectValue || params.searchText;

  // Clear and type the search text
  if (params.clear !== false) {
    performClear(element);
  }
  await performType(element, { text: params.searchText });

  // Wait for suggestions to appear by polling for dropdown/listbox
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeout) {
    await sleep(pollInterval);

    // Look for suggestion containers
    const dropdown = findOpenDropdown(element);
    if (!dropdown) continue;

    const match = findDropdownOption(dropdown, selectValue);
    if (match) {
      match.click();
      return;
    }
  }

  throw new Error(
    `Autocomplete: no matching suggestion for "${selectValue}" within ${timeout}ms`,
  );
}

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
