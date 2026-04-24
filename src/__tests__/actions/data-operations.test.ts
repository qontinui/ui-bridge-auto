import { describe, it, expect, beforeEach } from "vitest";
import {
  extractValue,
  interpolate,
  evaluateExpression,
} from "../../actions/data-operations";
import {
  createButton,
  createInput,
  createCheckbox,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// extractValue
// ---------------------------------------------------------------------------

describe("extractValue", () => {
  it("'text' returns textContent", () => {
    const el = createButton("Submit Order");
    const result = extractValue(el, "text");
    expect(result).toBe("Submit Order");
  });

  it("'value' returns element value", () => {
    const el = createInput("Email", {
      state: { value: "user@example.com" },
    });
    const result = extractValue(el, "value");
    expect(result).toBe("user@example.com");
  });

  it("'checked' returns boolean", () => {
    const el = createCheckbox("Accept Terms", true);
    const result = extractValue(el, "checked");
    expect(result).toBe(true);
  });

  it("'checked' returns false for unchecked", () => {
    const el = createCheckbox("Accept Terms", false);
    const result = extractValue(el, "checked");
    expect(result).toBe(false);
  });

  it("custom attribute via getAttribute", () => {
    const el = createMockElement({
      attributes: { "data-testid": "my-widget" },
    });
    const result = extractValue(el, "attribute:data-testid");
    expect(result).toBe("my-widget");
  });

  it("returns undefined for missing attribute", () => {
    const el = createButton("Click");
    const result = extractValue(el, "attribute:data-missing");
    expect(result).toBeNull();
  });

  it("'className' returns a plain string even for SVG elements", () => {
    // Regression: SVGElement.className is SVGAnimatedString, not string.
    // Returning that to callers makes subsequent `.split(...)` etc. throw
    // ("className.split is not a function" from get_snapshot).
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon primary");
    const el: import("../../core/element-query").QueryableElement = {
      id: "svg-1",
      element: svg as unknown as HTMLElement,
      type: "generic",
      getState: () => ({ visible: true, enabled: true }),
    };
    const result = extractValue(el, "className");
    expect(typeof result).toBe("string");
    expect(result).toBe("icon primary");
    // The critical invariant: result must support string ops.
    expect(() => (result as string).split(/\s+/)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// interpolate
// ---------------------------------------------------------------------------

describe("interpolate", () => {
  it("replaces {{varName}} with values", () => {
    const result = interpolate("Hello, {{name}}!", { name: "World" });
    expect(result).toBe("Hello, World!");
  });

  it("replaces multiple variables", () => {
    const result = interpolate("{{greeting}}, {{name}}!", {
      greeting: "Hi",
      name: "Alice",
    });
    expect(result).toBe("Hi, Alice!");
  });

  it("leaves unknown variables as-is", () => {
    const result = interpolate("Hello, {{unknown}}!", {});
    expect(result).toBe("Hello, {{unknown}}!");
  });

  it("handles nested object access ({{user.name}})", () => {
    const result = interpolate("Hello, {{user.name}}!", {
      user: { name: "Bob" },
    });
    expect(result).toBe("Hello, Bob!");
  });

  it("handles empty string values", () => {
    const result = interpolate("Value: {{val}}", { val: "" });
    expect(result).toBe("Value: ");
  });
});

// ---------------------------------------------------------------------------
// evaluateExpression
// ---------------------------------------------------------------------------

describe("evaluateExpression", () => {
  it("equality (==)", () => {
    expect(evaluateExpression("hello", "==", "hello")).toBe(true);
    expect(evaluateExpression("hello", "==", "world")).toBe(false);
  });

  it("inequality (!=)", () => {
    expect(evaluateExpression("hello", "!=", "world")).toBe(true);
    expect(evaluateExpression("hello", "!=", "hello")).toBe(false);
  });

  it("greater than (>)", () => {
    expect(evaluateExpression(10, ">", 5)).toBe(true);
    expect(evaluateExpression(3, ">", 7)).toBe(false);
  });

  it("less than (<)", () => {
    expect(evaluateExpression(3, "<", 7)).toBe(true);
    expect(evaluateExpression(10, "<", 5)).toBe(false);
  });

  it("greater than or equal (>=)", () => {
    expect(evaluateExpression(5, ">=", 5)).toBe(true);
    expect(evaluateExpression(6, ">=", 5)).toBe(true);
    expect(evaluateExpression(4, ">=", 5)).toBe(false);
  });

  it("less than or equal (<=)", () => {
    expect(evaluateExpression(5, "<=", 5)).toBe(true);
    expect(evaluateExpression(4, "<=", 5)).toBe(true);
    expect(evaluateExpression(6, "<=", 5)).toBe(false);
  });

  it("contains", () => {
    expect(evaluateExpression("hello world", "contains", "world")).toBe(true);
    expect(evaluateExpression("hello world", "contains", "mars")).toBe(false);
  });

  it("matches (regex)", () => {
    expect(evaluateExpression("test-123", "matches", "^test-\\d+$")).toBe(true);
    expect(evaluateExpression("other", "matches", "^test-\\d+$")).toBe(false);
  });
});
