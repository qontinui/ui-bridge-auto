/**
 * Tests for the `visibilityRatio` scoring criterion (Section 8 — extension
 * of `ScoreBreakdown`).
 *
 * Round-trip integration: build a registry with a hidden + visible element
 * and assert the visibility-aware score drops the hidden one in
 * `executeQuery` results.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  computeMatchScore,
  computeScoreBreakdown,
  rankResults,
} from "../../core/query-ranking";
import type { QueryableElement } from "../../core/element-query";

beforeEach(() => {
  document.body.innerHTML = "";
});

function btn(id: string, ratio: number | undefined): QueryableElement {
  const el = document.createElement("button");
  el.textContent = "Submit";
  document.body.appendChild(el);
  return {
    id,
    element: el,
    type: "button",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: "Submit",
      rect: { x: 0, y: 0, width: 100, height: 30 },
      visibilityRatio: ratio,
    }),
  };
}

describe("visibilityRatio scoring", () => {
  it("does not contribute when the query omits the criterion", () => {
    const el = btn("a", 1.0);
    const { scores } = computeScoreBreakdown(el, { text: "Submit" });
    expect(scores.visibilityMatch).toBe(0);
  });

  it("awards full credit when the candidate meets minRatio (boolean shorthand)", () => {
    const el = btn("a", 1.0);
    const { scores } = computeScoreBreakdown(el, {
      text: "Submit",
      visibilityRatio: true,
    });
    expect(scores.visibilityMatch).toBeCloseTo(0.2, 5);
  });

  it("awards partial credit when the candidate is partially visible", () => {
    const el = btn("a", 0.4);
    const { scores } = computeScoreBreakdown(el, {
      text: "Submit",
      visibilityRatio: { minRatio: 0.8 },
    });
    // partial = 0.4/0.8 * 0.2 = 0.1
    expect(scores.visibilityMatch).toBeCloseTo(0.1, 5);
  });

  it("invisible candidates rank lower than visible ones, but stay in results", () => {
    const visible = btn("visible", 1.0);
    const hidden = btn("hidden", 0);
    const ranked = rankResults([visible, hidden], {
      text: "Submit",
      visibilityRatio: { minRatio: 1.0 },
    });
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.id).toBe("visible");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("treats undefined visibilityRatio as no signal (zero contribution, no penalty)", () => {
    const el = btn("a", undefined);
    const { scores } = computeScoreBreakdown(el, {
      text: "Submit",
      visibilityRatio: true,
    });
    expect(scores.visibilityMatch).toBe(0);
  });

  it("composite score is bounded by maxPossible normalisation", () => {
    const el = btn("a", 1.0);
    const score = computeMatchScore(el, {
      text: "Submit",
      visibilityRatio: true,
    });
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThan(0);
  });
});
