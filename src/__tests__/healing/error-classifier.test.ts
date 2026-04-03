import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyError,
  addClassificationRule,
  resetClassificationRules,
} from "../../healing/error-classifier";

beforeEach(() => {
  resetClassificationRules();
});

describe("classifyError", () => {
  it("classifies timeout as transient/retry", () => {
    const result = classifyError(new Error("Operation timeout after 5000ms"));
    expect(result.classification).toBe("transient");
    expect(result.suggestedAction).toBe("retry");
    expect(result.retryable).toBe(true);
  });

  it("classifies 'not found' as transient/relocate", () => {
    const result = classifyError(new Error("Element not found: btn-1"));
    expect(result.classification).toBe("transient");
    expect(result.suggestedAction).toBe("relocate");
    expect(result.retryable).toBe(true);
  });

  it("classifies 'no path' as permanent/reroute", () => {
    const result = classifyError(new Error("No path from A to B"));
    expect(result.classification).toBe("permanent");
    expect(result.suggestedAction).toBe("reroute");
    expect(result.retryable).toBe(false);
  });

  it("classifies 'network' as environmental/wait", () => {
    const result = classifyError(new Error("Network connection failed"));
    expect(result.classification).toBe("environmental");
    expect(result.suggestedAction).toBe("wait");
    expect(result.retryable).toBe(true);
  });

  it("classifies 'disabled' as environmental/wait", () => {
    const result = classifyError(new Error("Button is disabled"));
    expect(result.classification).toBe("environmental");
    expect(result.suggestedAction).toBe("wait");
  });

  it("classifies unknown errors as permanent/abort", () => {
    const result = classifyError(new Error("Something completely unexpected"));
    expect(result.classification).toBe("permanent");
    expect(result.suggestedAction).toBe("abort");
    expect(result.retryable).toBe(false);
  });

  it("supports custom classification rules", () => {
    addClassificationRule(/auth/i, "environmental", "wait");

    const result = classifyError(new Error("Auth token expired"));
    expect(result.classification).toBe("environmental");
    expect(result.suggestedAction).toBe("wait");
  });

  it("custom rules take priority over defaults", () => {
    // Override the default timeout rule
    addClassificationRule(/timeout/i, "permanent", "abort");

    const result = classifyError(new Error("Operation timeout"));
    expect(result.classification).toBe("permanent");
    expect(result.suggestedAction).toBe("abort");
  });

  it("resetClassificationRules restores defaults", () => {
    addClassificationRule(/timeout/i, "permanent", "abort");
    resetClassificationRules();

    const result = classifyError(new Error("Operation timeout"));
    expect(result.classification).toBe("transient");
    expect(result.suggestedAction).toBe("retry");
  });

  it("preserves the original error", () => {
    const original = new Error("test error");
    const result = classifyError(original);
    expect(result.originalError).toBe(original);
  });
});
