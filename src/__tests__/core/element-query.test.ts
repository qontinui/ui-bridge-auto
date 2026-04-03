import { describe, it, expect, beforeEach } from "vitest";
import {
  matchesQuery,
  executeQuery,
  findFirst,
  type ElementQuery,
} from "../../core/element-query";
import {
  createMockElement,
  createButton,
  createInput,
  createLink,
  createHeading,
  createCheckbox,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// matchesQuery — identity
// ---------------------------------------------------------------------------

describe("matchesQuery — identity matching", () => {
  it("matches exact string id", () => {
    const el = createMockElement({ id: "submit-btn" });
    const result = matchesQuery(el, { id: "submit-btn" });
    expect(result.matches).toBe(true);
    expect(result.reasons).toContain("id=submit-btn");
  });

  it("rejects non-matching id", () => {
    const el = createMockElement({ id: "cancel-btn" });
    expect(matchesQuery(el, { id: "submit-btn" }).matches).toBe(false);
  });

  it("matches regex id", () => {
    const el = createMockElement({ id: "btn-submit-42" });
    expect(matchesQuery(el, { id: /^btn-submit/ }).matches).toBe(true);
  });

  it("rejects non-matching regex id", () => {
    const el = createMockElement({ id: "link-home" });
    expect(matchesQuery(el, { id: /^btn-/ }).matches).toBe(false);
  });

  it("matches role via explicit attribute", () => {
    const el = createMockElement({
      attributes: { role: "button" },
    });
    expect(matchesQuery(el, { role: "button" }).matches).toBe(true);
  });

  it("matches role via inferred tag mapping", () => {
    const el = createButton("Click");
    // button tag infers role=button
    expect(matchesQuery(el, { role: "button" }).matches).toBe(true);
  });

  it("matches tagName (case-insensitive)", () => {
    const el = createButton("Submit");
    expect(matchesQuery(el, { tagName: "BUTTON" }).matches).toBe(true);
    expect(matchesQuery(el, { tagName: "button" }).matches).toBe(true);
  });

  it("rejects wrong tagName", () => {
    const el = createButton("Submit");
    expect(matchesQuery(el, { tagName: "input" }).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — content
// ---------------------------------------------------------------------------

describe("matchesQuery — content matching", () => {
  it("matches exact text", () => {
    const el = createButton("Submit");
    const result = matchesQuery(el, { text: "Submit" });
    expect(result.matches).toBe(true);
  });

  it("trims text for comparison", () => {
    const el = createMockElement({ textContent: "  Hello  " });
    expect(matchesQuery(el, { text: "Hello" }).matches).toBe(true);
  });

  it("matches textContains (case-insensitive)", () => {
    const el = createButton("Click to Submit Form");
    expect(matchesQuery(el, { textContains: "submit" }).matches).toBe(true);
  });

  it("rejects textContains when not found", () => {
    const el = createButton("Cancel");
    expect(matchesQuery(el, { textContains: "submit" }).matches).toBe(false);
  });

  it("matches textPattern regex", () => {
    const el = createButton("Item 42");
    expect(matchesQuery(el, { textPattern: /Item \d+/ }).matches).toBe(true);
  });

  it("rejects non-matching textPattern", () => {
    const el = createButton("No number here");
    expect(matchesQuery(el, { textPattern: /\d+/ }).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — accessibility
// ---------------------------------------------------------------------------

describe("matchesQuery — ARIA matching", () => {
  it("matches ariaLabel", () => {
    const el = createMockElement({
      attributes: { "aria-label": "Close dialog" },
    });
    expect(matchesQuery(el, { ariaLabel: "close" }).matches).toBe(true);
  });

  it("matches ariaLabel from element label property", () => {
    const el = createMockElement({ label: "Save changes" });
    expect(matchesQuery(el, { ariaLabel: "save" }).matches).toBe(true);
  });

  it("matches ariaSelected=true", () => {
    const el = createMockElement({
      attributes: { "aria-selected": "true" },
    });
    expect(matchesQuery(el, { ariaSelected: true }).matches).toBe(true);
  });

  it("matches ariaSelected=false", () => {
    const el = createMockElement({
      attributes: { "aria-selected": "false" },
    });
    expect(matchesQuery(el, { ariaSelected: false }).matches).toBe(true);
  });

  it("matches ariaExpanded", () => {
    const el = createMockElement({
      attributes: { "aria-expanded": "true" },
    });
    expect(matchesQuery(el, { ariaExpanded: true }).matches).toBe(true);
  });

  it("rejects ariaExpanded mismatch", () => {
    const el = createMockElement({
      attributes: { "aria-expanded": "false" },
    });
    expect(matchesQuery(el, { ariaExpanded: true }).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — attributes
// ---------------------------------------------------------------------------

describe("matchesQuery — attribute matching", () => {
  it("matches string attribute", () => {
    const el = createMockElement({
      attributes: { "data-testid": "my-btn" },
    });
    expect(
      matchesQuery(el, { attributes: { "data-testid": "my-btn" } }).matches,
    ).toBe(true);
  });

  it("matches regex attribute", () => {
    const el = createMockElement({
      attributes: { class: "btn btn-primary large" },
    });
    expect(
      matchesQuery(el, { attributes: { class: /btn-primary/ } }).matches,
    ).toBe(true);
  });

  it("matches boolean attribute (present)", () => {
    const el = createMockElement({
      attributes: { disabled: "" },
    });
    expect(
      matchesQuery(el, { attributes: { disabled: true } }).matches,
    ).toBe(true);
  });

  it("matches boolean attribute (absent)", () => {
    const el = createMockElement({});
    expect(
      matchesQuery(el, { attributes: { disabled: false } }).matches,
    ).toBe(true);
  });

  it("rejects missing attribute when boolean true expected", () => {
    const el = createMockElement({});
    expect(
      matchesQuery(el, { attributes: { disabled: true } }).matches,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — state
// ---------------------------------------------------------------------------

describe("matchesQuery — state matching", () => {
  it("matches visible=true", () => {
    const el = createMockElement({ state: { visible: true } });
    expect(matchesQuery(el, { visible: true }).matches).toBe(true);
  });

  it("rejects visible mismatch", () => {
    const el = createMockElement({ state: { visible: false } });
    expect(matchesQuery(el, { visible: true }).matches).toBe(false);
  });

  it("matches enabled state", () => {
    const el = createMockElement({ state: { enabled: false } });
    expect(matchesQuery(el, { enabled: false }).matches).toBe(true);
  });

  it("matches checked state", () => {
    const el = createCheckbox("Accept", true);
    expect(matchesQuery(el, { checked: true }).matches).toBe(true);
  });

  it("matches focused state", () => {
    const el = createMockElement({ state: { focused: true } });
    expect(matchesQuery(el, { focused: true }).matches).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — spatial
// ---------------------------------------------------------------------------

describe("matchesQuery — spatial matching", () => {
  it("matches element within bounds", () => {
    const el = createMockElement({
      state: { rect: { x: 10, y: 10, width: 50, height: 20 } },
    });
    expect(
      matchesQuery(el, { within: { x: 0, y: 0, width: 200, height: 200 } }).matches,
    ).toBe(true);
  });

  it("rejects element outside bounds", () => {
    const el = createMockElement({
      state: { rect: { x: 300, y: 10, width: 50, height: 20 } },
    });
    expect(
      matchesQuery(el, { within: { x: 0, y: 0, width: 200, height: 200 } }).matches,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — computed styles
// ---------------------------------------------------------------------------

describe("matchesQuery — style matching", () => {
  it("matches exact computed style", () => {
    const el = createMockElement({
      state: { computedStyles: { display: "flex", color: "red" } },
    });
    expect(matchesQuery(el, { style: { display: "flex" } }).matches).toBe(true);
  });

  it("matches regex computed style", () => {
    const el = createMockElement({
      state: { computedStyles: { backgroundColor: "rgb(255, 0, 0)" } },
    });
    expect(
      matchesQuery(el, { style: { backgroundColor: /rgb\(255/ } }).matches,
    ).toBe(true);
  });

  it("rejects when style property missing", () => {
    const el = createMockElement({ state: { computedStyles: {} } });
    expect(matchesQuery(el, { style: { display: "block" } }).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — structural
// ---------------------------------------------------------------------------

describe("matchesQuery — structural matching", () => {
  it("matches parent by tagName", () => {
    const parentDiv = document.createElement("nav");
    document.body.appendChild(parentDiv);

    const el = createMockElement({ parent: parentDiv, tagName: "button" });
    expect(matchesQuery(el, { parent: { tagName: "nav" } }).matches).toBe(true);
  });

  it("rejects when parent doesn't match", () => {
    const parentDiv = document.createElement("div");
    document.body.appendChild(parentDiv);

    const el = createMockElement({ parent: parentDiv });
    expect(matchesQuery(el, { parent: { tagName: "nav" } }).matches).toBe(false);
  });

  it("matches ancestor", () => {
    const grandparent = document.createElement("nav");
    const parent = document.createElement("div");
    grandparent.appendChild(parent);
    document.body.appendChild(grandparent);

    const el = createMockElement({ parent });
    expect(matchesQuery(el, { ancestor: { tagName: "nav" } }).matches).toBe(true);
  });

  it("matches hasChild", () => {
    const el = createMockElement({ tagName: "div" });
    const child = document.createElement("span");
    child.textContent = "icon";
    el.element.appendChild(child);

    expect(matchesQuery(el, { hasChild: { tagName: "span" } }).matches).toBe(true);
  });

  it("rejects hasChild when no match", () => {
    const el = createMockElement({ tagName: "div" });
    expect(matchesQuery(el, { hasChild: { tagName: "span" } }).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesQuery — logical combinators
// ---------------------------------------------------------------------------

describe("matchesQuery — logical combinators", () => {
  it("matches AND (all sub-queries must match)", () => {
    const el = createButton("Submit");
    const query: ElementQuery = {
      and: [{ tagName: "button" }, { text: "Submit" }],
    };
    expect(matchesQuery(el, query).matches).toBe(true);
  });

  it("rejects AND when any sub-query fails", () => {
    const el = createButton("Cancel");
    const query: ElementQuery = {
      and: [{ tagName: "button" }, { text: "Submit" }],
    };
    expect(matchesQuery(el, query).matches).toBe(false);
  });

  it("matches OR (any sub-query can match)", () => {
    const el = createButton("Cancel");
    const query: ElementQuery = {
      or: [{ text: "Submit" }, { text: "Cancel" }],
    };
    expect(matchesQuery(el, query).matches).toBe(true);
  });

  it("rejects OR when no sub-query matches", () => {
    const el = createButton("Delete");
    const query: ElementQuery = {
      or: [{ text: "Submit" }, { text: "Cancel" }],
    };
    expect(matchesQuery(el, query).matches).toBe(false);
  });

  it("matches NOT (element must not match sub-query)", () => {
    const el = createButton("Submit");
    const query: ElementQuery = { not: { text: "Cancel" } };
    expect(matchesQuery(el, query).matches).toBe(true);
  });

  it("rejects NOT when element matches sub-query", () => {
    const el = createButton("Cancel");
    const query: ElementQuery = { not: { text: "Cancel" } };
    expect(matchesQuery(el, query).matches).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeQuery
// ---------------------------------------------------------------------------

describe("executeQuery", () => {
  it("returns all matching elements", () => {
    const btn1 = createButton("Submit");
    const btn2 = createButton("Cancel");
    const link = createLink("Home", "/");

    const results = executeQuery([btn1, btn2, link], { tagName: "button" });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toContain(btn1.id);
    expect(results.map((r) => r.id)).toContain(btn2.id);
  });

  it("returns empty array when no matches", () => {
    const btn = createButton("Submit");
    const results = executeQuery([btn], { tagName: "input" });
    expect(results).toEqual([]);
  });

  it("returns all elements when query matches everything", () => {
    const btn = createButton("A");
    const link = createLink("B", "/");
    const results = executeQuery([btn, link], { visible: true });
    expect(results).toHaveLength(2);
  });

  it("handles empty element list", () => {
    expect(executeQuery([], { text: "anything" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findFirst
// ---------------------------------------------------------------------------

describe("findFirst", () => {
  it("returns first matching element", () => {
    const btn1 = createButton("First");
    const btn2 = createButton("Second");

    const result = findFirst([btn1, btn2], { tagName: "button" });
    expect(result).not.toBeNull();
    expect(result!.id).toBe(btn1.id);
  });

  it("returns null when no match", () => {
    const btn = createButton("Submit");
    expect(findFirst([btn], { tagName: "select" })).toBeNull();
  });

  it("returns null for empty list", () => {
    expect(findFirst([], { text: "anything" })).toBeNull();
  });
});
