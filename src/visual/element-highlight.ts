/**
 * Element Highlight — Visual Bounding-Box Overlays for Automation
 *
 * Draws temporary CSS overlay rectangles around elements during automation,
 * giving users visual feedback of what the system is interacting with.
 *
 * Follows the CSS injection pattern from `@qontinui/ui-bridge`'s
 * `click-highlight.ts`, adapted for bounding-box rectangles with
 * action-type color coding and flash modes.
 *
 * @example
 * ```ts
 * const manager = new ElementHighlightManager();
 *
 * // Highlight a region directly
 * const id = manager.highlight({ x: 100, y: 200, width: 300, height: 50 });
 *
 * // Highlight an element from registry with action-type color
 * manager.highlightAction('btn-submit', 'click', registry);
 *
 * // Dismiss all highlights
 * manager.dismissAll();
 * ```
 */

import type { ViewportRegion } from "../types/region";
import type { ActionType } from "../types/transition";
import type { RegistryLike } from "../state/state-detector";
import type { HighlightOptions, ActiveHighlight } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CSS class prefix for highlight elements. */
const HIGHLIGHT_CLASS = "ui-bridge-auto-highlight";

/** Default highlight options. */
const DEFAULTS: Required<HighlightOptions> = {
  color: "#00c800",
  duration: 800,
  thickness: 3,
  flash: false,
  flashInterval: 200,
  label: "",
  opacity: 0.7,
};

/**
 * Color presets per action type. Groups related actions under the same color.
 *
 * - Green: click actions
 * - Blue: text input actions
 * - Orange: scroll actions
 * - Purple: selection/toggle actions
 * - Teal: focus/hover actions
 * - Yellow: everything else
 */
export const ACTION_HIGHLIGHT_COLORS: Record<ActionType, string> = {
  click: "#00c800",
  doubleClick: "#00c800",
  rightClick: "#00c800",
  middleClick: "#00c800",
  type: "#0064ff",
  setValue: "#0064ff",
  clear: "#0064ff",
  sendKeys: "#0064ff",
  scroll: "#ff8c00",
  scrollIntoView: "#ff8c00",
  select: "#b400b4",
  check: "#b400b4",
  uncheck: "#b400b4",
  toggle: "#b400b4",
  focus: "#00b4b4",
  hover: "#00b4b4",
  blur: "#00b4b4",
  drag: "#c8c800",
  mouseDown: "#c8c800",
  mouseUp: "#c8c800",
  keyDown: "#c8c800",
  keyUp: "#c8c800",
  submit: "#c8c800",
  reset: "#c8c800",
};

// ---------------------------------------------------------------------------
// CSS injection (once per document)
// ---------------------------------------------------------------------------

let styleInjected = false;

function injectStyles(): void {
  if (styleInjected) return;
  styleInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      box-sizing: border-box;
      border-style: solid;
      opacity: var(--hl-opacity, 0.7);
      animation: ${HIGHLIGHT_CLASS}-fade var(--hl-duration, 800ms) ease-out forwards;
    }

    .${HIGHLIGHT_CLASS}--flash {
      animation: ${HIGHLIGHT_CLASS}-blink var(--hl-flash-interval, 200ms) ease-in-out infinite alternate;
    }

    .${HIGHLIGHT_CLASS}__label {
      position: fixed;
      pointer-events: none;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
      color: #fff;
      opacity: var(--hl-opacity, 0.7);
      animation: ${HIGHLIGHT_CLASS}-fade var(--hl-duration, 800ms) ease-out forwards;
    }

    @keyframes ${HIGHLIGHT_CLASS}-fade {
      0% { opacity: var(--hl-opacity, 0.7); }
      70% { opacity: var(--hl-opacity, 0.7); }
      100% { opacity: 0; }
    }

    @keyframes ${HIGHLIGHT_CLASS}-blink {
      0% { opacity: 0; }
      100% { opacity: var(--hl-opacity, 0.7); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Reset the style injection flag. Used in tests to ensure clean state.
 * @internal
 */
export function _resetStyleInjection(): void {
  styleInjected = false;
}

// ---------------------------------------------------------------------------
// ElementHighlightManager
// ---------------------------------------------------------------------------

/**
 * Manages visual bounding-box highlight overlays for automation elements.
 *
 * Creates temporary CSS overlay rectangles that auto-dismiss after a
 * configurable duration. Supports action-type color coding, flash mode,
 * and optional text labels.
 */
export class ElementHighlightManager {
  private readonly highlights = new Map<string, ActiveHighlight>();
  private nextId = 0;

  /**
   * Highlight a viewport region with a bounding-box overlay.
   *
   * @param region - The viewport-pixel region to highlight.
   * @param options - Customisation for color, duration, flash, etc.
   * @returns A unique highlight ID that can be used with {@link dismiss}.
   */
  highlight(region: ViewportRegion, options?: HighlightOptions): string {
    injectStyles();

    const opts: Required<HighlightOptions> = { ...DEFAULTS, ...options };
    const id = `hl-${++this.nextId}`;

    // Main highlight box
    const el = document.createElement("div");
    el.className = opts.flash
      ? `${HIGHLIGHT_CLASS} ${HIGHLIGHT_CLASS}--flash`
      : HIGHLIGHT_CLASS;
    el.dataset.highlightId = id;

    el.style.setProperty("--hl-opacity", String(opts.opacity));
    el.style.setProperty("--hl-duration", `${opts.duration}ms`);
    if (opts.flash) {
      el.style.setProperty("--hl-flash-interval", `${opts.flashInterval}ms`);
    }

    el.style.left = `${region.x}px`;
    el.style.top = `${region.y}px`;
    el.style.width = `${region.width}px`;
    el.style.height = `${region.height}px`;
    el.style.borderWidth = `${opts.thickness}px`;
    el.style.borderColor = opts.color;
    el.dataset.highlightColor = opts.color;

    document.body.appendChild(el);

    // Optional label
    let labelElement: HTMLDivElement | undefined;
    if (opts.label) {
      labelElement = document.createElement("div");
      labelElement.className = `${HIGHLIGHT_CLASS}__label`;
      labelElement.textContent = opts.label;
      labelElement.style.setProperty("--hl-opacity", String(opts.opacity));
      labelElement.style.setProperty("--hl-duration", `${opts.duration}ms`);
      labelElement.style.left = `${region.x}px`;
      labelElement.style.top = `${region.y - 20}px`;
      labelElement.style.backgroundColor = opts.color;

      document.body.appendChild(labelElement);
    }

    // Auto-dismiss timer
    const timerId = setTimeout(() => {
      this.dismiss(id);
    }, opts.duration);

    const highlight: ActiveHighlight = {
      id,
      region,
      options: opts,
      domElement: el,
      labelElement,
      timerId,
    };

    this.highlights.set(id, highlight);
    return id;
  }

  /**
   * Highlight an element from the registry by its ID.
   *
   * Looks up the element's bounding rect from the registry and creates
   * a highlight overlay around it.
   *
   * @param elementId - The registry element ID.
   * @param registry - The element registry to look up the element.
   * @param options - Highlight options.
   * @returns The highlight ID, or `null` if the element was not found.
   */
  highlightElement(
    elementId: string,
    registry: RegistryLike,
    options?: HighlightOptions,
  ): string | null {
    const elements = registry.getAllElements();
    const element = elements.find((el) => el.id === elementId);
    if (!element) return null;

    const state = element.getState();
    const rect = state.rect;
    if (!rect) return null;

    const region: ViewportRegion = {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };

    const id = this.highlight(region, options);

    // Store the element ID reference
    const hl = this.highlights.get(id);
    if (hl) {
      hl.elementId = elementId;
    }

    return id;
  }

  /**
   * Highlight an element with an action-type-appropriate color.
   *
   * Automatically selects the highlight color based on the action type
   * (e.g., green for click, blue for type, orange for scroll).
   *
   * @param elementId - The registry element ID.
   * @param actionType - The action being performed.
   * @param registry - The element registry.
   * @param options - Additional highlight options (color will be overridden).
   * @returns The highlight ID, or `null` if the element was not found.
   */
  highlightAction(
    elementId: string,
    actionType: ActionType,
    registry: RegistryLike,
    options?: Partial<HighlightOptions>,
  ): string | null {
    const color = ACTION_HIGHLIGHT_COLORS[actionType] ?? "#c8c800";
    return this.highlightElement(elementId, registry, {
      ...options,
      color,
    });
  }

  /**
   * Dismiss a specific highlight by ID.
   *
   * Removes the overlay and label elements from the DOM and clears the
   * auto-dismiss timer.
   *
   * @param highlightId - The ID returned by {@link highlight}.
   */
  dismiss(highlightId: string): void {
    const hl = this.highlights.get(highlightId);
    if (!hl) return;

    clearTimeout(hl.timerId);
    hl.domElement.remove();
    hl.labelElement?.remove();
    this.highlights.delete(highlightId);
  }

  /**
   * Dismiss all active highlights.
   */
  dismissAll(): void {
    for (const id of [...this.highlights.keys()]) {
      this.dismiss(id);
    }
  }

  /**
   * Get all currently active highlights.
   *
   * @returns A snapshot array of active highlights (not a live reference).
   */
  getActive(): ActiveHighlight[] {
    return [...this.highlights.values()];
  }
}
