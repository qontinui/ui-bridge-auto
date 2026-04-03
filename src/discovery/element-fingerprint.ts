/**
 * Structural fingerprinting for element identity tracking.
 *
 * A fingerprint captures the structural characteristics of a DOM element —
 * tag name, role, text hash, ARIA label, depth, sibling index, and parent
 * tag. Two fingerprints can be compared to determine whether they likely
 * refer to the same logical element across DOM mutations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElementFingerprint {
  tagName: string;
  role: string;
  textHash: string;
  ariaLabel: string;
  depth: number;
  siblingIndex: number;
  parentTag: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple string hash (djb2). Deterministic, fast, no crypto dependency.
 */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // Convert to unsigned hex
  return (hash >>> 0).toString(16);
}

function inferRole(el: HTMLElement): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;

  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case "button":
      return "button";
    case "a":
      return "link";
    case "input":
      return "textbox";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    default:
      if (/^h[1-6]$/.test(tag)) return "heading";
      return tag;
  }
}

function computeDepth(el: HTMLElement): number {
  let depth = 0;
  let current: HTMLElement | null = el.parentElement;
  while (current) {
    depth++;
    current = current.parentElement;
  }
  return depth;
}

function computeSiblingIndex(el: HTMLElement): number {
  if (!el.parentElement) return 0;
  const children = Array.from(el.parentElement.children);
  return children.indexOf(el);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a structural fingerprint for a DOM element.
 */
export function computeFingerprint(element: HTMLElement): ElementFingerprint {
  const text = (element.textContent ?? "").trim();

  return {
    tagName: element.tagName.toLowerCase(),
    role: inferRole(element),
    textHash: djb2(text),
    ariaLabel: element.getAttribute("aria-label") ?? "",
    depth: computeDepth(element),
    siblingIndex: computeSiblingIndex(element),
    parentTag: element.parentElement
      ? element.parentElement.tagName.toLowerCase()
      : "",
  };
}

/**
 * Determine whether two fingerprints refer to the same logical element.
 *
 * Matches on tag, role, text hash, and aria-label. Depth and sibling index
 * are allowed to differ by a small margin (elements may shift position
 * slightly across renders).
 */
export function fingerprintMatch(
  a: ElementFingerprint,
  b: ElementFingerprint,
): boolean {
  if (a.tagName !== b.tagName) return false;
  if (a.role !== b.role) return false;
  if (a.textHash !== b.textHash) return false;
  if (a.ariaLabel !== b.ariaLabel) return false;
  if (a.parentTag !== b.parentTag) return false;

  // Allow small positional drift
  if (Math.abs(a.depth - b.depth) > 2) return false;
  if (Math.abs(a.siblingIndex - b.siblingIndex) > 3) return false;

  return true;
}
