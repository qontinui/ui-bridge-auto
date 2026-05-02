/**
 * Confidence-aware element-query API tests.
 *
 * Verifies that `findFirst` returns the new `{ match, score, ambiguities }`
 * shape and that `executeQuery` returns ranked results with per-criterion
 * `ScoreBreakdown` attached.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  executeQuery,
  findFirst,
  type ElementQuery,
  type RankedQueryResult,
} from "../../core/element-query";
import type { RankedResult, ScoreBreakdown } from "../../core/query-ranking";
import {
  createButton,
  createLink,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// findFirst — single match
// ---------------------------------------------------------------------------

describe("findFirst — confidence shape", () => {
  it("returns match + score + empty ambiguities when only one element matches", () => {
    const btn = createButton("Submit");
    const link = createLink("Home", "/");

    const result = findFirst([btn, link], { text: "Submit" });

    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe(btn.id);
    expect(result.score).not.toBeNull();
    // exactText match contributes 1.0
    expect((result.score as ScoreBreakdown).exactText).toBeGreaterThan(0);
    expect(result.ambiguities).toEqual([]);
  });

  it("returns top-1 in match and remaining matches in ambiguities", () => {
    const exactBtn = createButton("Save changes");
    const fuzzyBtnA = createButton("Save settings");
    const fuzzyBtnB = createButton("Save profile");

    // Use a query that all three buttons satisfy via textContains
    // ("Save"). The exact-text candidate ranks highest.
    const query: ElementQuery = {
      textContains: "Save",
    };

    const result = findFirst([exactBtn, fuzzyBtnA, fuzzyBtnB], query, {
      ambiguityThreshold: 0.0,
    });

    expect(result.match).not.toBeNull();
    expect(result.score).not.toBeNull();
    expect(result.ambiguities.length).toBeGreaterThanOrEqual(1);

    // The chosen match must NOT appear in ambiguities.
    const chosenId = result.match!.id;
    expect(result.ambiguities.find((a) => a.id === chosenId)).toBeUndefined();

    // Ambiguities are sorted by descending composite score.
    for (let i = 1; i < result.ambiguities.length; i++) {
      expect(result.ambiguities[i - 1].score).toBeGreaterThanOrEqual(
        result.ambiguities[i].score,
      );
    }
  });

  it("returns null match + null score + empty ambiguities when nothing matches", () => {
    const btn = createButton("Submit");

    const result = findFirst([btn], { text: "DoesNotExist" });

    expect(result.match).toBeNull();
    expect(result.score).toBeNull();
    expect(result.ambiguities).toEqual([]);
  });

  it("respects options.maxAmbiguities", () => {
    const buttons = [
      createButton("Save Item 1"),
      createButton("Save Item 2"),
      createButton("Save Item 3"),
      createButton("Save Item 4"),
      createButton("Save Item 5"),
    ];

    const result = findFirst(
      buttons,
      { textContains: "Save" },
      { maxAmbiguities: 2, ambiguityThreshold: 0.0 },
    );

    expect(result.match).not.toBeNull();
    expect(result.ambiguities.length).toBeLessThanOrEqual(2);
  });

  it("respects options.ambiguityThreshold to filter low-score near-misses", () => {
    // Two candidates that both pass `matchesQuery` (with the fuzzy
    // threshold relaxed) but score differently against the fuzzyText
    // criterion. The closer match wins; the farther one is an ambiguity.
    const closer = createButton("Submitt");
    const farther = createButton("Submix");

    const query: ElementQuery = {
      textContains: "Sub",
      fuzzyText: "Submit",
      fuzzyThreshold: 0.0, // relax matchesQuery so both candidates rank
    };

    const looseResult = findFirst([farther, closer], query, {
      ambiguityThreshold: 0.0,
    });

    expect(looseResult.match).not.toBeNull();
    expect(looseResult.match!.id).toBe(closer.id);
    expect(looseResult.ambiguities.length).toBe(1);
    expect(looseResult.ambiguities[0].id).toBe(farther.id);

    // Threshold above the lower candidate's score filters it out.
    const aboveLowScore = looseResult.ambiguities[0].score + 0.0001;
    const strictResult = findFirst([farther, closer], query, {
      ambiguityThreshold: aboveLowScore,
    });
    expect(strictResult.match!.id).toBe(closer.id);
    expect(strictResult.ambiguities).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findFirst — near (cross-element criterion)
// ---------------------------------------------------------------------------

describe("findFirst — near", () => {
  it("still resolves cross-element queries via the near criterion", () => {
    const anchor = createMockElement({
      tagName: "div",
      textContent: "Anchor",
      state: { rect: { x: 0, y: 0, width: 50, height: 50 } },
    });
    const nearby = createMockElement({
      tagName: "button",
      textContent: "Nearby",
      state: { rect: { x: 60, y: 0, width: 50, height: 50 } },
    });
    const farAway = createMockElement({
      tagName: "button",
      textContent: "Far",
      state: { rect: { x: 1000, y: 1000, width: 50, height: 50 } },
    });

    const result = findFirst([anchor, nearby, farAway], {
      tagName: "button",
      near: {
        query: { text: "Anchor" },
        maxDistance: 100,
      },
    });

    expect(result.match).not.toBeNull();
    expect(result.match!.id).toBe(nearby.id);
    expect(result.score).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// executeQuery — RankedQueryResult[]
// ---------------------------------------------------------------------------

describe("executeQuery — confidence shape", () => {
  it("attaches a ScoreBreakdown to every result", () => {
    const btn1 = createButton("Submit");
    const btn2 = createButton("Cancel");

    const results = executeQuery([btn1, btn2], { tagName: "button" });
    expect(results).toHaveLength(2);

    for (const r of results) {
      expect(r.score).toBeDefined();
      // Sanity-check a few breakdown fields exist
      expect(typeof r.score.exactText).toBe("number");
      expect(typeof r.score.idMatch).toBe("number");
    }
  });

  it("sorts results by descending composite score", () => {
    // Three buttons that all pass `matchesQuery` (textContains "Sub" +
    // fuzzyText with threshold 0) but score differently against the
    // fuzzyText similarity contribution.
    const exact = createButton("Submit");
    const closer = createButton("Submitt");
    const farther = createButton("Submix");

    const query: ElementQuery = {
      textContains: "Sub",
      fuzzyText: "Submit",
      fuzzyThreshold: 0.0,
    };

    const ranked: RankedQueryResult[] = executeQuery(
      [farther, closer, exact],
      query,
    );

    expect(ranked).toHaveLength(3);
    // Highest fuzzy similarity (the exact match) wins.
    expect(ranked[0].id).toBe(exact.id);
    // Lowest similarity ranks last.
    expect(ranked[ranked.length - 1].id).toBe(farther.id);
  });

  it("returns ranked candidates for queries with the near criterion", () => {
    const anchor = createMockElement({
      tagName: "div",
      textContent: "Anchor",
      state: { rect: { x: 0, y: 0, width: 50, height: 50 } },
    });
    const near1 = createMockElement({
      tagName: "button",
      textContent: "Near1",
      state: { rect: { x: 60, y: 0, width: 50, height: 50 } },
    });
    const near2 = createMockElement({
      tagName: "button",
      textContent: "Near2",
      state: { rect: { x: 60, y: 60, width: 50, height: 50 } },
    });

    const results = executeQuery([anchor, near1, near2], {
      tagName: "button",
      near: {
        query: { text: "Anchor" },
        maxDistance: 200,
      },
    });

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.score).toBeDefined();
    }
  });

  it("returns an empty array when no element matches", () => {
    const btn = createButton("Submit");
    const results = executeQuery([btn], { text: "DoesNotExist" });
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Type-shape contract
// ---------------------------------------------------------------------------

describe("RankedResult shape in ambiguities", () => {
  it("ambiguity entries carry a composite numeric score plus the breakdown", () => {
    const closer = createButton("Submitt");
    const farther = createButton("Submix");

    const result = findFirst(
      [closer, farther],
      {
        textContains: "Sub",
        fuzzyText: "Submit",
        fuzzyThreshold: 0.0,
      },
      { ambiguityThreshold: 0.0 },
    );

    expect(result.ambiguities.length).toBeGreaterThanOrEqual(1);
    const ambiguity: RankedResult = result.ambiguities[0];
    expect(typeof ambiguity.score).toBe("number");
    expect(ambiguity.scores).toBeDefined();
    expect(typeof ambiguity.scores.exactText).toBe("number");
  });
});
