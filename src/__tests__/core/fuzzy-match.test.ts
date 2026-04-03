import { describe, it, expect } from "vitest";
import {
  levenshteinDistance,
  similarity,
  isFuzzyMatch,
  bestFuzzyMatch,
  tokenMatch,
} from "../../core/fuzzy-match";

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("hello", "hello")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(levenshteinDistance("", "")).toBe(0);
  });

  it("returns length of other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("xyz", "")).toBe(3);
  });

  it("returns 1 for a single character substitution", () => {
    expect(levenshteinDistance("cat", "car")).toBe(1);
  });

  it("returns 1 for a single character insertion", () => {
    expect(levenshteinDistance("cat", "cats")).toBe(1);
  });

  it("returns 1 for a single character deletion", () => {
    expect(levenshteinDistance("cats", "cat")).toBe(1);
  });

  it("handles completely different strings", () => {
    expect(levenshteinDistance("abc", "xyz")).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(
      levenshteinDistance("sitting", "kitten"),
    );
  });

  it("handles classic kitten/sitting example", () => {
    // kitten -> sitten -> sittin -> sitting = 3
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// similarity
// ---------------------------------------------------------------------------

describe("similarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(similarity("hello", "hello")).toBe(1.0);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(similarity("", "")).toBe(1.0);
  });

  it("returns 0.0 for completely different same-length strings", () => {
    expect(similarity("abc", "xyz")).toBe(0.0);
  });

  it("returns a value between 0 and 1 for partial match", () => {
    const score = similarity("submit", "submot");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("longer shared prefix yields higher similarity", () => {
    const scoreClose = similarity("button", "buttan");
    const scoreFar = similarity("button", "xxxxxx");
    expect(scoreClose).toBeGreaterThan(scoreFar);
  });
});

// ---------------------------------------------------------------------------
// isFuzzyMatch
// ---------------------------------------------------------------------------

describe("isFuzzyMatch", () => {
  it("matches identical strings at any threshold", () => {
    expect(isFuzzyMatch("hello", "hello", 0.99)).toBe(true);
  });

  it("matches similar strings within default threshold", () => {
    // "submit" vs "submot" => similarity ~0.83 which exceeds default 0.7
    expect(isFuzzyMatch("submit", "submot")).toBe(true);
  });

  it("rejects strings below threshold", () => {
    expect(isFuzzyMatch("abc", "xyz", 0.5)).toBe(false);
  });

  it("uses default threshold of 0.7 when not specified", () => {
    // "abcdef" vs "abcxyz" => 3 changes in 6 chars => similarity 0.5 < 0.7
    expect(isFuzzyMatch("abcdef", "abcxyz")).toBe(false);
  });

  it("early-exits when length difference exceeds threshold", () => {
    // Very different lengths — should exit before computing full distance
    expect(isFuzzyMatch("a", "abcdefghij", 0.9)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bestFuzzyMatch
// ---------------------------------------------------------------------------

describe("bestFuzzyMatch", () => {
  it("returns null for empty candidates list", () => {
    expect(bestFuzzyMatch("hello", [])).toBeNull();
  });

  it("finds the best match in a list", () => {
    const result = bestFuzzyMatch("submit", ["cancel", "submot", "delete"]);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("submot");
    expect(result!.index).toBe(1);
    expect(result!.score).toBeGreaterThan(0.5);
  });

  it("returns exact match with score 1.0", () => {
    const result = bestFuzzyMatch("save", ["open", "save", "close"]);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("save");
    expect(result!.score).toBe(1.0);
  });

  it("is case-insensitive", () => {
    const result = bestFuzzyMatch("SUBMIT", ["submit", "cancel"]);
    expect(result).not.toBeNull();
    expect(result!.value).toBe("submit");
    expect(result!.score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// tokenMatch
// ---------------------------------------------------------------------------

describe("tokenMatch", () => {
  it("returns true when all tokens are present", () => {
    expect(tokenMatch("submit form", "click to submit the form")).toBe(true);
  });

  it("returns false when a token is missing", () => {
    expect(tokenMatch("submit form", "click to cancel the form")).toBe(false);
  });

  it("is order-independent", () => {
    expect(tokenMatch("form submit", "submit the form")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(tokenMatch("Submit Form", "submit the form")).toBe(true);
  });

  it("returns true for empty needle", () => {
    expect(tokenMatch("", "anything")).toBe(true);
  });

  it("returns false when haystack is empty but needle is not", () => {
    expect(tokenMatch("submit", "")).toBe(false);
  });
});
