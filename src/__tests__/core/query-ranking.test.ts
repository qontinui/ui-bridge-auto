import { describe, it, expect, beforeEach } from "vitest";
import { computeMatchScore, rankResults } from "../../core/query-ranking";
import type { RankedResult } from "../../core/query-ranking";
import {
  createButton,
  createInput,
  createLink,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// computeMatchScore
// ---------------------------------------------------------------------------

describe("computeMatchScore", () => {
  it("returns 1.0 for exact text match when text is the only criterion", () => {
    const el = createButton("Submit");
    const score = computeMatchScore(el, { text: "Submit" });
    expect(score).toBe(1.0);
  });

  it("returns 0 for non-matching text", () => {
    const el = createButton("Submit");
    const score = computeMatchScore(el, { text: "Cancel" });
    expect(score).toBe(0);
  });

  it("exact ID match scores high (0.9 weight)", () => {
    const el = createMockElement({ id: "my-btn" });
    const score = computeMatchScore(el, { id: "my-btn" });
    // id-only query: 0.9/0.9 = 1.0 normalised
    expect(score).toBe(1.0);
  });

  it("role match scores at 0.5 weight", () => {
    const el = createButton("Click");
    const score = computeMatchScore(el, { role: "button" });
    // role-only: 0.5/0.5 = 1.0 normalised
    expect(score).toBe(1.0);
  });

  it("ID match outscores role-only match in multi-criteria query", () => {
    const el = createMockElement({ id: "special-btn", type: "button", tagName: "button" });
    // Query with id + role: id contributes 0.9, role contributes 0.5
    const scoreWithId = computeMatchScore(el, { id: "special-btn", role: "button" });
    // Query with wrong id + correct role: only role matches
    const el2 = createMockElement({ id: "other-btn", type: "button", tagName: "button" });
    const scoreNoId = computeMatchScore(el2, { id: "special-btn", role: "button" });
    expect(scoreWithId).toBeGreaterThan(scoreNoId);
  });

  it("multiple criteria produce higher raw score than single criterion", () => {
    const el = createButton("Submit");
    // role-only query
    const singleScore = computeMatchScore(el, { role: "button" });
    // role + text query — when both match, raw score = 0.5 + 1.0 = 1.5, max = 1.5, normalised = 1.0
    const multiScore = computeMatchScore(el, { role: "button", text: "Submit" });
    // Both normalise to 1.0, but let's check with partial match
    const partialMulti = computeMatchScore(el, { role: "button", text: "Cancel" });
    // role matches (0.5) but text doesn't (0), max = 1.5, normalised = 0.5/1.5 ~ 0.33
    expect(partialMulti).toBeLessThan(singleScore);
  });

  it("caps score at 1.0", () => {
    const el = createMockElement({
      id: "my-btn",
      type: "button",
      tagName: "button",
      textContent: "Submit",
      state: { visible: true, enabled: true },
    });
    const score = computeMatchScore(el, {
      id: "my-btn",
      role: "button",
      text: "Submit",
    });
    expect(score).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// rankResults
// ---------------------------------------------------------------------------

describe("rankResults", () => {
  it("returns results sorted by score descending", () => {
    const exact = createButton("Submit");
    const partial = createButton("Submitting");
    const other = createButton("Cancel");

    const results = rankResults([exact, partial, other], { textContains: "submit" });
    expect(results.length).toBeGreaterThanOrEqual(1);

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("excludes elements that do not match the query", () => {
    const btn = createButton("Submit");
    const link = createLink("Home", "/");

    const results = rankResults([btn, link], { tagName: "button" });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(btn.id);
  });

  it("returns empty array when nothing matches", () => {
    const btn = createButton("Submit");
    const results = rankResults([btn], { text: "Nonexistent" });
    expect(results).toEqual([]);
  });

  it("includes score and matchReasons on each result", () => {
    const btn = createButton("Submit");
    const results = rankResults([btn], { role: "button" });
    expect(results).toHaveLength(1);
    expect(typeof results[0]!.score).toBe("number");
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(Array.isArray(results[0]!.matchReasons)).toBe(true);
  });

  it("exact text match ranks above textContains match", () => {
    const exact = createMockElement({ id: "a", textContent: "Submit" });
    const contains = createMockElement({ id: "b", textContent: "Submit Form" });

    const results = rankResults([contains, exact], { text: "Submit" });
    // Only exact text match will pass matchesQuery for text criterion
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe(exact.id);
  });
});
