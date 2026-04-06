import { describe, it, expect } from "vitest";
import { noMatch, matched, explainMatch, type ElementCriteria } from "../../types/match";
import type { AutomationElement } from "../../types/element";

function makeElement(overrides?: Partial<AutomationElement>): AutomationElement {
  return {
    id: "el-1",
    stableId: "stable-1",
    type: "button",
    label: "Submit",
    state: {
      visible: true,
      enabled: true,
      focused: false,
      textContent: "Submit Form",
      rect: { x: 0, y: 0, width: 100, height: 40, top: 0, right: 100, bottom: 40, left: 0 },
      computedStyles: {
        display: "block",
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        color: "black",
        backgroundColor: "white",
        fontSize: "14px",
        fontWeight: "400",
      },
    },
    aliases: [],
    depth: 3,
    ...overrides,
  } as AutomationElement;
}

describe("noMatch", () => {
  it("returns not-found result", () => {
    const r = noMatch(5);
    expect(r.found).toBe(false);
    expect(r.element).toBeUndefined();
    expect(r.matchReasons).toEqual([]);
    expect(r.queryTime).toBe(5);
  });
});

describe("matched", () => {
  it("returns found result with element and reasons", () => {
    const el = makeElement();
    const r = matched(el, ["role matched", "text matched"], 3);
    expect(r.found).toBe(true);
    expect(r.element).toBe(el);
    expect(r.matchReasons).toEqual(["role matched", "text matched"]);
    expect(r.queryTime).toBe(3);
  });
});

describe("explainMatch", () => {
  it("matches role criterion", () => {
    const result = explainMatch(makeElement(), { role: "button" });
    expect(result.matched).toBe(true);
    expect(result.criteriaResults).toHaveLength(1);
    expect(result.criteriaResults[0].matched).toBe(true);
  });

  it("fails role criterion when type differs", () => {
    const result = explainMatch(makeElement(), { role: "link" });
    expect(result.matched).toBe(false);
  });

  it("matches text criterion (trimmed)", () => {
    const result = explainMatch(makeElement(), { text: "Submit Form" });
    expect(result.matched).toBe(true);
  });

  it("matches textContains (case-insensitive)", () => {
    const result = explainMatch(makeElement(), { textContains: "submit" });
    expect(result.matched).toBe(true);
  });

  it("matches ariaLabel (case-insensitive substring)", () => {
    const result = explainMatch(makeElement({ label: "Submit Button" }), { ariaLabel: "submit" });
    expect(result.matched).toBe(true);
  });

  it("matches id as string", () => {
    const result = explainMatch(makeElement({ id: "btn-1" }), { id: "btn-1" });
    expect(result.matched).toBe(true);
  });

  it("matches id as RegExp", () => {
    const result = explainMatch(makeElement({ id: "btn-42" }), { id: /^btn-\d+$/ });
    expect(result.matched).toBe(true);
  });

  it("matches attributes (data-testid)", () => {
    const el = makeElement({ automationId: "my-btn" });
    const result = explainMatch(el, { attributes: { "data-testid": "my-btn" } });
    expect(result.matched).toBe(true);
  });

  it("fails when one criterion out of many fails", () => {
    const result = explainMatch(makeElement(), { role: "button", text: "Wrong" });
    expect(result.matched).toBe(false);
    expect(result.criteriaResults.some((c) => !c.matched)).toBe(true);
  });

  it("reports elementId and elementLabel", () => {
    const result = explainMatch(makeElement(), { role: "button" });
    expect(result.elementId).toBe("el-1");
    expect(result.elementLabel).toBe("Submit");
  });
});
