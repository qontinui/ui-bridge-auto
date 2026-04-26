/**
 * Form action implementations — clear, select, focus, blur, check, toggle,
 * setValue, submit, reset, and autocomplete.
 */

import {
  sleep,
  getNativeSetter,
  resetReactValueTracker,
  getReactProps,
  findOpenDropdown,
  findDropdownOption,
} from "./dom-helpers";
import { performType } from "./keyboard-actions";

// ---- Parameter types ----

export interface SelectParams {
  value?: string | string[];
  byLabel?: boolean;
  additive?: boolean;
}

export interface AutocompleteParams {
  searchText: string;
  selectValue?: string;
  suggestionTimeout?: number;
  clear?: boolean;
}

// ---- Implementations ----

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
  // Validate that the caller provided a `value`. Without this guard, a missing
  // or misspelled key produces `[undefined]` below, no <option> matches, and
  // the action returns success with the select unchanged — an invisible
  // failure mode.
  if (params?.value === undefined || params.value === null) {
    throw new Error(
      "select action requires a 'value' parameter (string or string[]) — the option value(s) to select.",
    );
  }

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
 * 15. Toggle — generic open/close toggle action.
 *
 * Dispatches based on element type so disclosure widgets become drivable
 * without a separate action verb (UI Bridge testability plan, Item 2):
 *
 * - `<input type="checkbox">`: flip `checked` + fire `change`.
 * - `<details>`: flip the `open` property (not the attribute) and dispatch
 *   the native `toggle` event so React `onToggle` handlers observe the change.
 * - `<dialog>`: call `close()` / `showModal()` depending on current state.
 * - Anything carrying `aria-expanded`: flip the attribute and fire a
 *   synthetic click so framework click handlers run and manage the
 *   associated visual collapse.
 * - `role="switch"`: synthetic click (unchanged legacy path).
 * - Fallback: synthetic click — catches the "I forgot to mark this as a
 *   disclosure but the click handler does the right thing" case.
 */
export function performToggle(element: HTMLElement): void {
  if (element instanceof HTMLInputElement && element.type === "checkbox") {
    element.checked = !element.checked;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (element instanceof HTMLDetailsElement) {
    element.open = !element.open;
    element.dispatchEvent(new Event("toggle", { bubbles: false }));
    return;
  }

  if (typeof HTMLDialogElement !== "undefined" && element instanceof HTMLDialogElement) {
    if (element.open) {
      element.close();
    } else if (typeof element.showModal === "function") {
      element.showModal();
    } else {
      element.setAttribute("open", "");
      element.dispatchEvent(new Event("close", { bubbles: false }));
    }
    return;
  }

  const ariaExpanded = element.getAttribute("aria-expanded");
  if (ariaExpanded !== null) {
    const next = ariaExpanded === "true" ? "false" : "true";
    element.setAttribute("aria-expanded", next);
    element.click();
    return;
  }

  if (element.getAttribute("role") === "switch") {
    element.click();
    return;
  }

  // Last-resort fallback — matches the SDK-side DefaultActionExecutor path.
  element.click();
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
