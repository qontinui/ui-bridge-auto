/**
 * Unit tests for `checkDesignTokens` (Section 8).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildDesignTokenRegistry,
  checkDesignTokens,
} from "../../visual/token-check";
import type { QueryableElement } from "../../core/element-query";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeElement(
  id: string,
  inlineStyles: Record<string, string>,
  textContent = "",
): QueryableElement {
  const el = document.createElement("div");
  for (const [k, v] of Object.entries(inlineStyles)) {
    el.style.setProperty(k, v);
  }
  el.textContent = textContent;
  document.body.appendChild(el);
  return {
    id,
    element: el,
    type: "div",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent,
      rect: { x: 0, y: 0, width: 100, height: 30 },
      computedStyles: {
        display: "block",
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        color: el.style.color || "rgb(0, 0, 0)",
        backgroundColor: el.style.backgroundColor || "rgba(0, 0, 0, 0)",
        fontSize: el.style.fontSize || "16px",
        fontWeight: el.style.fontWeight || "400",
      },
    }),
  };
}

describe("checkDesignTokens", () => {
  it("returns no violations when all tracked properties match the catalog", () => {
    const reg = buildDesignTokenRegistry({
      color: ["rgb(0, 0, 0)"],
      "font-size": ["16px"],
    });
    const el = makeElement("a", { color: "rgb(0, 0, 0)", "font-size": "16px" });
    expect(checkDesignTokens(el, reg)).toEqual([]);
  });

  it("reports a violation when a tracked property is off-token", () => {
    const reg = buildDesignTokenRegistry({
      color: ["rgb(0, 0, 0)", "rgb(34, 34, 34)"],
    });
    const el = makeElement("a", { color: "rgb(255, 0, 0)" });
    const violations = checkDesignTokens(el, reg);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.property).toBe("color");
    expect(violations[0]?.actualValue).toBe("rgb(255, 0, 0)");
    expect(violations[0]?.allowedValues).toEqual([
      "rgb(0, 0, 0)",
      "rgb(34, 34, 34)",
    ]);
  });

  it("emits violations sorted by property name (deterministic)", () => {
    const reg = buildDesignTokenRegistry({
      color: ["rgb(0, 0, 0)"],
      "font-size": ["14px"],
    });
    const el = makeElement("a", {
      color: "rgb(255, 0, 0)",
      "font-size": "20px",
    });
    const violations = checkDesignTokens(el, reg);
    expect(violations.map((v) => v.property)).toEqual(["color", "font-size"]);
  });

  it("skips properties not governed by the registry", () => {
    const reg = buildDesignTokenRegistry({ color: ["rgb(0, 0, 0)"] });
    const el = makeElement("a", { color: "rgb(0, 0, 0)", "font-size": "99px" });
    const violations = checkDesignTokens(el, reg);
    expect(violations).toEqual([]);
  });

  it("reads kebab-case AND camelCase from the typed subset", () => {
    const reg = buildDesignTokenRegistry({ fontSize: ["16px"] });
    const el = makeElement("a", { "font-size": "20px" });
    const violations = checkDesignTokens(el, reg);
    // The typed subset has fontSize, the test computes 20px → violation.
    expect(violations).toHaveLength(1);
    expect(violations[0]?.property).toBe("fontSize");
  });
});
