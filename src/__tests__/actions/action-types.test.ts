import { describe, it, expect } from "vitest";
import {
  ACTION_METADATA,
  validateActionParams,
  getActionsByCategory,
} from "../../actions/action-types";

// ---------------------------------------------------------------------------
// ACTION_METADATA completeness
// ---------------------------------------------------------------------------

describe("ACTION_METADATA", () => {
  const expectedTypes = [
    "click",
    "doubleClick",
    "rightClick",
    "type",
    "clear",
    "focus",
    "blur",
    "hover",
    "scroll",
    "scrollIntoView",
    "select",
    "check",
    "uncheck",
    "toggle",
    "press",
    "dragAndDrop",
    "upload",
    "setAttribute",
  ];

  it("has entries for all expected action types", () => {
    for (const t of expectedTypes) {
      expect(ACTION_METADATA).toHaveProperty(t);
    }
    // Implementation may have more types than the minimum expected set
    expect(Object.keys(ACTION_METADATA).length).toBeGreaterThanOrEqual(expectedTypes.length);
  });

  it("every action type has label, description, and category", () => {
    for (const [key, meta] of Object.entries(ACTION_METADATA)) {
      expect(meta.label, `${key}.label`).toBeTruthy();
      expect(meta.description, `${key}.description`).toBeTruthy();
      expect(meta.category, `${key}.category`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// validateActionParams
// ---------------------------------------------------------------------------

describe("validateActionParams", () => {
  it("returns valid: true for correct params", () => {
    const result = validateActionParams("type", { value: "hello" });
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it("returns error when required param 'value' is missing for 'type'", () => {
    const result = validateActionParams("type", {});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("returns valid: true for actions with no required params (click)", () => {
    const result = validateActionParams("click", {});
    expect(result.valid).toBe(true);
  });

  it("returns error for unknown action type", () => {
    const result = validateActionParams("nonexistent" as any, {});
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActionsByCategory
// ---------------------------------------------------------------------------

describe("getActionsByCategory", () => {
  it("returns action types for 'interaction' category", () => {
    const types = getActionsByCategory("interaction");
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("click");
  });

  it("returns action types for 'input' category", () => {
    const types = getActionsByCategory("input");
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("type");
  });

  it("returns empty array for unknown category", () => {
    const types = getActionsByCategory("nonexistent");
    expect(types).toEqual([]);
  });
});
