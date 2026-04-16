/**
 * Generate stable element identifiers that survive re-renders.
 *
 * Uses a priority-ordered strategy:
 * 1. data-testid attribute
 * 2. data-ui-id attribute
 * 3. HTML id attribute (if intentional, not a random hash)
 * 4. Constructed from {role}-{slug}-{nearestLandmark}, where slug is sourced
 *    (in priority order) from aria-label, title, or textContent. aria-label
 *    and title are preferred because authors set them explicitly and they are
 *    usually stable across localization / dynamic content changes.
 *
 * Collision disambiguation: when two sibling elements would produce the same
 * constructed slug (e.g., two buttons with identical title), a short hash of
 * the element's DOM-path is appended instead of a positional index. The hash
 * is stable across re-renders as long as the DOM structure above the element
 * is stable, so UI Bridge ids do not drift when sibling order changes.
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
// DOM-path hash — stable across re-renders, used as a collision disambiguator
// instead of positional index (which drifts with sibling insertion/removal).
// ---------------------------------------------------------------------------

/**
 * Build a compact DOM-path from document.body down to `el`. Each segment is
 * `tag[nth-of-type]` so the path is stable across re-renders (nth-of-type is
 * stable under identical structure) but changes if the element moves in the
 * tree — which is exactly what we want for disambiguation.
 */
function domPath(el: HTMLElement): string {
  const segments: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body && current.parentElement) {
    const parentEl: HTMLElement = current.parentElement;
    const tag = current.tagName.toLowerCase();
    const currentTag = current.tagName;
    // nth-of-type among siblings with the same tag
    const sameTagSiblings: Element[] = Array.from(parentEl.children).filter(
      (c: Element) => c.tagName === currentTag,
    );
    const index = sameTagSiblings.indexOf(current);
    segments.unshift(`${tag}[${index}]`);
    current = parentEl;
  }
  return segments.join(">");
}

/**
 * Short deterministic hash of a string (FNV-1a 32-bit), rendered as 6 hex
 * characters. Collisions are possible but vanishingly rare for the small
 * number of colliding slugs in a single registry snapshot.
 */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a stable, deterministic identifier for a DOM element.
 *
 * @param element The DOM element to identify.
 * @param existingIds Optional set of previously-assigned ids. When provided,
 *   if the constructed id would collide with an existing entry, a short
 *   DOM-path hash is appended for disambiguation. Callers that assign ids
 *   in batch should pass this so collisions produce stable, non-positional
 *   suffixes. The set is NOT mutated — callers add the returned id after.
 */
export function generateStableId(
  element: HTMLElement,
  existingIds?: ReadonlySet<string>,
): string {
  // Priority 1: data-testid
  const testId = element.getAttribute("data-testid");
  if (testId) return testId;

  // Priority 2: data-ui-id
  const uiId = element.getAttribute("data-ui-id");
  if (uiId) return uiId;

  // Priority 3: HTML id (if intentional)
  const htmlId = element.id;
  if (htmlId && looksIntentional(htmlId)) return htmlId;

  // Priority 4: constructed from role, slug, and landmark.
  // Slug source priority: aria-label > title > textContent. The first two are
  // author-set and usually stable across localization / dynamic content
  // changes; textContent is the last resort.
  const role = inferRole(element);
  const ariaLabel = element.getAttribute("aria-label");
  const title = element.getAttribute("title");
  const slugSource = ariaLabel ?? title ?? element.textContent?.slice(0, 60) ?? "";
  const slug = toKebab(slugSource, 40);
  const landmark = findNearestLandmark(element);

  const parts = [role];
  if (slug) parts.push(slug);
  parts.push(landmark);
  const baseId = parts.join("-");

  // Collision disambiguation: append a short DOM-path hash (NOT a positional
  // index). The hash is stable across re-renders so the id does not drift
  // when siblings are added/removed elsewhere.
  if (existingIds && existingIds.has(baseId)) {
    return `${baseId}-${shortHash(domPath(element))}`;
  }
  return baseId;
}
