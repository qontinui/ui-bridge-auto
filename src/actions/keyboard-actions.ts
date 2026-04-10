/**
 * Keyboard action implementations — type and sendKeys.
 */

import {
  sleep,
  getNativeSetter,
  notifyReactValueChange,
  keyToCode,
  NON_PRINTABLE_KEYS,
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

// ---- Implementations ----

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
