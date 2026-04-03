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
