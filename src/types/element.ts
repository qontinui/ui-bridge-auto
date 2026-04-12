/**
 * DOM element model for automation.
 *
 * Extends the UI Bridge's RegisteredElement concept with automation metadata,
 * structural context, and a full snapshot of element state at query time.
 * This is the canonical element representation used throughout ui-bridge-auto.
 */

// ---------------------------------------------------------------------------
// Element type taxonomy
// ---------------------------------------------------------------------------

/**
 * Semantic element types recognised by the automation system.
 * Maps to ARIA roles and common HTML element categories.
 */
export type ElementType =
  | "button"
  | "link"
  | "input"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "switch"
  | "slider"
  | "tab"
  | "menuitem"
  | "option"
  | "heading"
  | "paragraph"
  | "image"
  | "list"
  | "listitem"
  | "table"
  | "cell"
  | "dialog"
  | "alert"
  | "navigation"
  | "form"
  | "toolbar"
  | "tooltip"
  | "badge"
  | "generic";

/** All valid ElementType values as a runtime array for validation. */
export const ELEMENT_TYPES: readonly ElementType[] = [
  "button",
  "link",
  "input",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "tab",
  "menuitem",
  "option",
  "heading",
  "paragraph",
  "image",
  "list",
  "listitem",
  "table",
  "cell",
  "dialog",
  "alert",
  "navigation",
  "form",
  "toolbar",
  "tooltip",
  "badge",
  "generic",
] as const;

// ---------------------------------------------------------------------------
// Element rect
// ---------------------------------------------------------------------------

/** Viewport-relative bounding rectangle for a DOM element. */
export interface ElementRect {
  /** X offset from viewport left edge (px). */
  x: number;
  /** Y offset from viewport top edge (px). */
  y: number;
  /** Element width (px). */
  width: number;
  /** Element height (px). */
  height: number;
  /** Alias for y. */
  top: number;
  /** x + width. */
  right: number;
  /** y + height. */
  bottom: number;
  /** Alias for x. */
  left: number;
}

// ---------------------------------------------------------------------------
// Element state
// ---------------------------------------------------------------------------

/**
 * Subset of computed CSS styles relevant for automation decisions.
 * Values are the serialised CSS strings returned by getComputedStyle().
 */
export interface ComputedStyleSubset {
  display: string;
  visibility: string;
  opacity: string;
  pointerEvents: string;
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
}

/**
 * Complete snapshot of a DOM element's interactive state at a specific moment.
 * Captured once per query and treated as immutable after creation.
 */
export interface ElementState {
  /** Whether the element is visible (not display:none, visibility:hidden, or zero-size). */
  visible: boolean;
  /** Whether the element is enabled (not disabled or aria-disabled). */
  enabled: boolean;
  /** Whether the element currently has focus. */
  focused: boolean;
  /** Checkbox / radio checked state. */
  checked?: boolean;
  /** Option / listbox selected state. */
  selected?: boolean;
  /** Disclosure / accordion expanded state. */
  expanded?: boolean;
  /** Toggle button pressed state. */
  pressed?: boolean | "mixed";

  /** Trimmed text content of the element. */
  textContent: string;
  /** Current value for inputs, selects, and other form controls. */
  value?: string | number | boolean;
  /** Placeholder text, if any. */
  placeholder?: string;

  /** Viewport-relative bounding rect. */
  rect: ElementRect;

  /** Relevant computed CSS properties. */
  computedStyles: ComputedStyleSubset;
}

// ---------------------------------------------------------------------------
// Automation element
// ---------------------------------------------------------------------------

/**
 * Core element model for automation — wraps a UI Bridge registry element
 * with automation metadata, structural context, and a state snapshot.
 *
 * An AutomationElement is immutable once created; to get updated state,
 * re-query the element from the registry.
 */
export interface AutomationElement {
  /** UI Bridge registry element ID. */
  id: string;
  /** Fingerprint-based stable ID that persists across DOM mutations. */
  stableId: string;
  /** Semantic element type. */
  type: ElementType;
  /** Human-readable label (aria-label, visible text, or computed). */
  label: string;

  /** DOM state snapshot at query time. */
  state: ElementState;

  /** Explicit automation identifier (data-testid, data-ui-id). */
  automationId?: string;
  /** Descriptive semantic type (e.g., "submit-button", "search-input"). */
  semanticType?: string;
  /** Human-readable description of what this element does. */
  purpose?: string;
  /** Alternative names for fuzzy matching. */
  aliases: string[];

  /** Nearest landmark context (dialog name, form label, nav region). */
  landmark?: string;
  /** DOM depth from document body. */
  depth: number;
  /** Parent element's semantic type, if available. */
  parentType?: string;

  /** Stable reference ID assigned at snapshot time. Present only when
   *  the snapshot was created through a ref-aware capture path. */
  refId?: string;
}

// ---------------------------------------------------------------------------
// Element snapshot
// ---------------------------------------------------------------------------

/**
 * A complete snapshot of all automation elements at a single point in time.
 * Used for state detection, diffing, and historical comparison.
 */
export interface ElementSnapshot {
  /** When this snapshot was captured (epoch ms). */
  timestamp: number;
  /** All elements in the snapshot. */
  elements: AutomationElement[];
  /** Total number of elements in the DOM at capture time. */
  totalDomElements: number;
  /** How long the snapshot capture took (ms). */
  captureTimeMs: number;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Check whether a string is a valid ElementType.
 */
export function isElementType(value: string): value is ElementType {
  return (ELEMENT_TYPES as readonly string[]).includes(value);
}

/**
 * Check whether an object satisfies the AutomationElement interface.
 * Validates the presence and types of all required fields.
 */
export function isAutomationElement(value: unknown): value is AutomationElement {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.stableId === "string" &&
    typeof obj.type === "string" &&
    isElementType(obj.type as string) &&
    typeof obj.label === "string" &&
    obj.state !== null &&
    typeof obj.state === "object" &&
    Array.isArray(obj.aliases) &&
    typeof obj.depth === "number"
  );
}

/**
 * Check whether an object satisfies the ElementState interface.
 * Validates the presence and types of all required fields.
 */
export function isElementState(value: unknown): value is ElementState {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.visible === "boolean" &&
    typeof obj.enabled === "boolean" &&
    typeof obj.focused === "boolean" &&
    typeof obj.textContent === "string" &&
    obj.rect !== null &&
    typeof obj.rect === "object" &&
    obj.computedStyles !== null &&
    typeof obj.computedStyles === "object"
  );
}

/**
 * Check whether an object satisfies the ElementRect interface.
 */
export function isElementRect(value: unknown): value is ElementRect {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.x === "number" &&
    typeof obj.y === "number" &&
    typeof obj.width === "number" &&
    typeof obj.height === "number" &&
    typeof obj.top === "number" &&
    typeof obj.right === "number" &&
    typeof obj.bottom === "number" &&
    typeof obj.left === "number"
  );
}

/**
 * Check whether an object satisfies the ElementSnapshot interface.
 */
export function isElementSnapshot(value: unknown): value is ElementSnapshot {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.timestamp === "number" &&
    Array.isArray(obj.elements) &&
    typeof obj.totalDomElements === "number" &&
    typeof obj.captureTimeMs === "number"
  );
}
