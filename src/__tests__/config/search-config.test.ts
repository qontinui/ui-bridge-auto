import { describe, it, expect } from "vitest";
import {
  createDefaultSearchConfig,
  mergeSearchConfig,
  validateSearchConfig,
} from "../../config/search-config";

describe("createDefaultSearchConfig", () => {
  it("returns expected defaults", () => {
    const c = createDefaultSearchConfig();
    expect(c.defaultTimeout).toBe(5000);
    expect(c.fuzzyThreshold).toBe(0.3);
    expect(c.fuzzyEnabled).toBe(true);
    expect(c.caseSensitive).toBe(false);
    expect(c.maxResults).toBe(50);
    expect(c.includeHidden).toBe(false);
    expect(c.includeDisabled).toBe(true);
    expect(c.preferStableIds).toBe(true);
  });
});

describe("mergeSearchConfig", () => {
  it("overrides only specified fields", () => {
    const base = createDefaultSearchConfig();
    const merged = mergeSearchConfig(base, { fuzzyThreshold: 0.8, maxResults: 10 });
    expect(merged.fuzzyThreshold).toBe(0.8);
    expect(merged.maxResults).toBe(10);
    expect(merged.defaultTimeout).toBe(5000);
  });

  it("preserves base when overrides is empty", () => {
    const base = createDefaultSearchConfig();
    expect(mergeSearchConfig(base, {})).toEqual(base);
  });
});

describe("validateSearchConfig", () => {
  it("returns no errors for valid config", () => {
    const errors = validateSearchConfig(createDefaultSearchConfig());
    expect(errors).toEqual([]);
  });

  it("rejects negative defaultTimeout", () => {
    const c = { ...createDefaultSearchConfig(), defaultTimeout: -1 };
    const errors = validateSearchConfig(c);
    expect(errors).toContain("defaultTimeout must be a positive number");
  });

  it("rejects fuzzyThreshold out of range", () => {
    const c = { ...createDefaultSearchConfig(), fuzzyThreshold: 1.5 };
    expect(validateSearchConfig(c)).toContain("fuzzyThreshold must be between 0.0 and 1.0");
  });

  it("rejects non-positive maxResults", () => {
    const c = { ...createDefaultSearchConfig(), maxResults: 0 };
    expect(validateSearchConfig(c)).toContain("maxResults must be a positive number");
  });

  it("rejects non-integer maxResults", () => {
    const c = { ...createDefaultSearchConfig(), maxResults: 3.5 };
    expect(validateSearchConfig(c)).toContain("maxResults must be an integer");
  });
});
