/**
 * DOM action helpers — pure DOM utilities for action execution.
 * No dependencies on UI Bridge SDK or ui-bridge-auto internals.
 */

// --- Mouse event helpers ---

export interface MouseActionParams {
  button?: "left" | "right" | "middle";
  clickCount?: number;
  position?: { x: number; y: number };
  holdDuration?: number;
}

export function createMouseEvent(type: string, element: HTMLElement, options?: MouseActionParams): MouseEvent {
  const rect = element.getBoundingClientRect();
  const x = options?.position?.x ?? rect.width / 2;
  const y = options?.position?.y ?? rect.height / 2;
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    view: window,
    button: options?.button === "right" ? 2 : options?.button === "middle" ? 1 : 0,
    clientX: rect.left + x,
    clientY: rect.top + y,
  });
}

export function createMouseEventAt(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
}

export function elementFromPointSafe(x: number, y: number): HTMLElement | null {
  if (typeof document !== "undefined" && typeof document.elementFromPoint === "function") {
    return document.elementFromPoint(x, y) as HTMLElement | null;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- React integration helpers ---

/** Get the native value setter for an input/textarea (bypasses React's override). */
export function getNativeSetter(element: HTMLInputElement | HTMLTextAreaElement): ((v: string) => void) | undefined {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  return descriptor?.set ? (v: string) => descriptor.set!.call(element, v) : undefined;
}

/** Reset React's _valueTracker so it detects value changes. */
export function resetReactValueTracker(element: HTMLElement, previousValue: string): void {
  const tracker = (element as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
  if (tracker) tracker.setValue(previousValue);
}

/** Get React's internal props object (for direct onChange invocation in Tauri WebViews). */
export function getReactProps(element: HTMLElement): Record<string, unknown> | undefined {
  const el = element as unknown as Record<string, unknown>;
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  return key ? (el[key] as Record<string, unknown> | undefined) : undefined;
}

/** Notify React of a value change via _valueTracker reset + native event + direct onChange. */
export function notifyReactValueChange(element: HTMLInputElement | HTMLTextAreaElement, oldValue: string): void {
  resetReactValueTracker(element, oldValue);
  element.dispatchEvent(new Event("input", { bubbles: true }));
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
}

// --- Dropdown/combobox helpers ---

/** Find the open dropdown/listbox associated with a trigger element. Supports ARIA, Radix, MUI, Select2, Ant Design, Headless UI. */
export function findOpenDropdown(trigger: HTMLElement): Element | null {
  // 1. ARIA listbox via aria-controls/aria-owns
  const listboxId = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
  if (listboxId) {
    const el = document.getElementById(listboxId);
    if (el) return el;
  }
  // 2. Radix / shadcn popper
  const radix = document.querySelector('[data-radix-popper-content-wrapper] [role="listbox"], [data-state="open"] [role="listbox"]');
  if (radix) return radix;
  // 3. Generic ARIA listbox
  const ariaListbox = document.querySelector('[role="listbox"]');
  if (ariaListbox) return ariaListbox;
  // 4. MUI Select
  const mui = document.querySelector('.MuiPopover-root [role="listbox"], .MuiPopper-root [role="listbox"], .MuiMenu-list');
  if (mui) return mui;
  // 5. Select2
  const select2 = document.querySelector(".select2-container--open .select2-results__options");
  if (select2) return select2;
  // 6. Ant Design
  const ant = document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
  if (ant) return ant;
  // 7. Headless UI
  const headless = document.querySelector('[data-headlessui-state~="open"] [role="listbox"]');
  if (headless) return headless;
  // 8. Generic
  return document.querySelector('[role="menu"][data-state="open"], .dropdown-menu.show');
}

/** Find a matching option within a dropdown container. */
export function findDropdownOption(dropdown: Element, targetValue: string, byLabel?: boolean): HTMLElement | null {
  const targetLower = targetValue.toLowerCase();
  const selectors = [
    '[role="option"]',
    ".ant-select-item-option",
    ".select2-results__option",
    ".MuiMenuItem-root",
    '[data-headlessui-state] [role="option"]',
    "li[data-value]",
  ];
  for (const selector of selectors) {
    const options = dropdown.querySelectorAll<HTMLElement>(selector);
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const dataValue = opt.getAttribute("data-value") ?? "";
      const text = opt.textContent?.trim() ?? "";
      if (byLabel || !dataValue) {
        if (text === targetValue || text.toLowerCase() === targetLower) return opt;
      } else {
        if (dataValue === targetValue || dataValue.toLowerCase() === targetLower) return opt;
      }
      const ariaLabel = opt.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.toLowerCase() === targetLower) return opt;
    }
  }
  return null;
}

// --- Scrollable element detection ---

/** Walk up the DOM to find the nearest scrollable ancestor. */
export function findScrollableElement(element: HTMLElement): HTMLElement {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const isScrollable =
      (style.overflowY === "auto" || style.overflowY === "scroll" ||
       style.overflowX === "auto" || style.overflowX === "scroll") &&
      (current.scrollHeight > current.clientHeight || current.scrollWidth > current.clientWidth);
    if (isScrollable) return current;
    current = current.parentElement;
  }
  if (document.body.scrollHeight > document.body.clientHeight || document.body.scrollWidth > document.body.clientWidth) {
    return document.body;
  }
  return document.documentElement;
}

// --- Key mapping ---

/** Map a key name to a KeyboardEvent.code value. */
export function keyToCode(key: string): string {
  if (!key || typeof key !== "string") return "";
  if (key.length === 1) {
    const upper = key.toUpperCase();
    if (upper >= "A" && upper <= "Z") return `Key${upper}`;
    if (upper >= "0" && upper <= "9") return `Digit${upper}`;
  }
  const codeMap: Record<string, string> = {
    Enter: "Enter", Tab: "Tab", Escape: "Escape", Backspace: "Backspace",
    Delete: "Delete", " ": "Space", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  };
  return codeMap[key] || key;
}

/** Set of keys where browsers don't fire keypress events. */
export const NON_PRINTABLE_KEYS = new Set([
  "Enter", "Tab", "Escape", "Backspace", "Delete", "Insert",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Home", "End", "PageUp", "PageDown",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "Control", "Shift", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock",
]);
