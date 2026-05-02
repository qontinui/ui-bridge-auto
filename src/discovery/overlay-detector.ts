/**
 * Detect and register elements in dynamically-created overlays.
 *
 * Watches for new DOM elements appended to document.body that exhibit overlay
 * characteristics — high z-index, fixed/absolute positioning, or portal data
 * attributes (Radix, HeadlessUI, generic `[class*=portal]`).
 *
 * When an overlay is detected, its interactive descendants are collected and
 * forwarded to the registered callback. A removal watcher is installed to
 * notify when the overlay leaves the DOM.
 */

// ---------------------------------------------------------------------------
// Interactive element selectors
// ---------------------------------------------------------------------------

const INTERACTIVE_SELECTOR = [
  "button",
  "input",
  "a[href]",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='tab']",
  "[tabindex]",
].join(",");

// ---------------------------------------------------------------------------
// Overlay heuristics
// ---------------------------------------------------------------------------

function isOverlayElement(el: HTMLElement): boolean {
  // Portal data attributes (Radix, HeadlessUI, generic)
  if (
    el.hasAttribute("data-radix-portal") ||
    el.hasAttribute("data-headlessui-portal") ||
    (el.className && typeof el.className === "string" && /portal/i.test(el.className))
  ) {
    return true;
  }

  const style = window.getComputedStyle(el);

  // Position: fixed or absolute
  if (style.position === "fixed" || style.position === "absolute") {
    return true;
  }

  // z-index > 0
  const zIndex = parseInt(style.zIndex, 10);
  if (!isNaN(zIndex) && zIndex > 0) {
    return true;
  }

  return false;
}

/**
 * Pure heuristic predicate exposing the same overlay classification used
 * by `OverlayDetector` internally. Useful when callers (e.g. visibility
 * scoring in Section 8) need to ask "is this element overlay-shaped?"
 * without subscribing to the full detector lifecycle.
 *
 * Returns `true` if the element looks like an overlay (portal data
 * attribute, fixed/absolute positioning, or positive z-index).
 */
export function isOverlayCandidate(el: HTMLElement): boolean {
  return isOverlayElement(el);
}

function collectInteractiveElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];

  // Include root itself if interactive
  if (root.matches(INTERACTIVE_SELECTOR)) {
    elements.push(root);
  }

  const descendants = root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR);
  for (let i = 0; i < descendants.length; i++) {
    elements.push(descendants[i]);
  }

  return elements;
}

// ---------------------------------------------------------------------------
// OverlayDetector
// ---------------------------------------------------------------------------

export class OverlayDetector {
  private observer: MutationObserver | null = null;
  private removalObserver: MutationObserver | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingNodes: HTMLElement[] = [];
  private trackedOverlays = new Set<HTMLElement>();

  constructor(
    private onOverlayDetected: (elements: HTMLElement[]) => void,
    private onOverlayRemoved?: (overlay: HTMLElement) => void,
  ) {}

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start watching document.body for overlay additions.
   */
  start(): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node instanceof HTMLElement) {
            this.pendingNodes.push(node);
          }
        }
      }

      if (this.pendingNodes.length > 0) {
        this.scheduleDetection();
      }
    });

    this.observer.observe(document.body, { childList: true });

    // Removal watcher — observes the entire body subtree for removals
    this.removalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.removedNodes.length; i++) {
          const node = mutation.removedNodes[i];
          if (node instanceof HTMLElement && this.trackedOverlays.has(node)) {
            this.trackedOverlays.delete(node);
            this.onOverlayRemoved?.(node);
          }
        }
      }
    });

    this.removalObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop watching for overlays.
   */
  stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.removalObserver) {
      this.removalObserver.disconnect();
      this.removalObserver = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingNodes.length = 0;
  }

  /**
   * Stop watching and release all references.
   */
  dispose(): void {
    this.stop();
    this.trackedOverlays.clear();
  }

  /**
   * Return `true` when `el` (or any of its ancestors up to `document.body`)
   * is currently in the tracked-overlay set — i.e., the detector has
   * reported it via `onOverlayDetected` and has not yet seen it removed.
   *
   * Used by Section 8's visibility scoring to distinguish "covered by an
   * overlay we know about" (expected behavior — modal, dropdown, etc.) from
   * "covered by some other element" (potential layout bug). Call sites must
   * have a started detector; on a stopped detector the set is always empty.
   */
  isKnownOverlay(el: HTMLElement): boolean {
    if (this.trackedOverlays.has(el)) return true;
    let current: HTMLElement | null = el.parentElement;
    while (current) {
      if (this.trackedOverlays.has(current)) return true;
      current = current.parentElement;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private scheduleDetection(): void {
    if (this.debounceTimer !== null) return;

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.processNodes();
    }, 16); // ~1 frame
  }

  private processNodes(): void {
    const nodes = this.pendingNodes.splice(0);

    for (const node of nodes) {
      if (!document.body.contains(node)) continue;
      if (!isOverlayElement(node)) continue;

      const interactive = collectInteractiveElements(node);
      if (interactive.length === 0) continue;

      this.trackedOverlays.add(node);
      this.onOverlayDetected(interactive);
    }
  }
}
