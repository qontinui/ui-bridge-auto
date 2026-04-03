/**
 * Generate stable element identifiers that survive re-renders.
 *
 * Uses a priority-ordered strategy:
 * 1. data-testid attribute
 * 2. data-ui-id attribute
 * 3. HTML id attribute (if intentional, not a random hash)
 * 4. Constructed from {role}-{textContent}-{nearestLandmark}
 *
 * The output is deterministic — the same element always produces the same ID
 * regardless of render order or sibling count.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: IDs that look like random hashes (hex/base64/uuid fragments)
 * are not stable across renders.
 */
function looksIntentional(id: string): boolean {
  // Reject IDs that are entirely hex-like, contain colons (React-generated),
  // or match common random patterns (e.g. "r:abc123", ":r0:", "uid-a1b2c3d4")
  if (/^:r\d+:/.test(id)) return false;
  if (/^r:/.test(id)) return false;
  if (/^[0-9a-f]{8,}$/i.test(id)) return false;
  if (/^[0-9a-f-]{36}$/i.test(id)) return false; // UUID
  if (/^(uid|id|el|react)-[0-9a-f]+$/i.test(id)) return false;
  return id.length > 0;
}

/**
 * Convert a string to a kebab-case slug, truncated to maxLen characters.
 */
function toKebab(text: string, maxLen: number): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLen);
}

/**
 * Infer a semantic role from an element's tag name or explicit role attribute.
 */
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
      return el.getAttribute("type") === "checkbox"
        ? "checkbox"
        : el.getAttribute("type") === "radio"
          ? "radio"
          : "textbox";
    case "select":
      return "combobox";
    case "textarea":
      return "textbox";
    case "img":
      return "img";
    case "nav":
      return "navigation";
    case "main":
      return "main";
    case "header":
      return "banner";
    case "footer":
      return "contentinfo";
    default:
      if (/^h[1-6]$/.test(tag)) return "heading";
      return tag;
  }
}

const LANDMARK_ROLES = new Set([
  "dialog",
  "navigation",
  "main",
  "form",
  "banner",
  "contentinfo",
  "complementary",
  "region",
]);

/**
 * Walk up the DOM to find the nearest landmark context.
 */
function findNearestLandmark(el: HTMLElement): string {
  let current = el.parentElement;
  while (current && current !== document.body) {
    // Explicit landmark role
    const role = current.getAttribute("role");
    if (role && LANDMARK_ROLES.has(role)) {
      const label = current.getAttribute("aria-label");
      return label ? `${role}-${toKebab(label, 20)}` : role;
    }

    // aria-label on any ancestor is a useful context signal
    const ariaLabel = current.getAttribute("aria-label");
    if (ariaLabel) {
      return toKebab(ariaLabel, 30);
    }

    // Heading text inside the ancestor (e.g., a section with an h2)
    const heading = current.querySelector("h1, h2, h3, h4, h5, h6");
    if (heading && heading.textContent) {
      return toKebab(heading.textContent, 30);
    }

    current = current.parentElement;
  }
  return "root";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a stable, deterministic identifier for a DOM element.
 */
export function generateStableId(element: HTMLElement): string {
  // Priority 1: data-testid
  const testId = element.getAttribute("data-testid");
  if (testId) return testId;

  // Priority 2: data-ui-id
  const uiId = element.getAttribute("data-ui-id");
  if (uiId) return uiId;

  // Priority 3: HTML id (if intentional)
  const htmlId = element.id;
  if (htmlId && looksIntentional(htmlId)) return htmlId;

  // Priority 4: constructed from role, text, and landmark
  const role = inferRole(element);
  const text = toKebab(element.textContent?.slice(0, 30) ?? "", 30);
  const landmark = findNearestLandmark(element);

  const parts = [role];
  if (text) parts.push(text);
  parts.push(landmark);

  return parts.join("-");
}
