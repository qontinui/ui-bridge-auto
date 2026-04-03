import { describe, it, expect, beforeEach } from "vitest";
import { matchesSemantic, semanticSearch } from "../../core/semantic-match";
import type { SemanticQuery } from "../../core/semantic-match";
import {
  createButton,
  createInput,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// matchesSemantic
// ---------------------------------------------------------------------------

describe("matchesSemantic", () => {
  it("matches by purpose", () => {
    const el = createButton("Submit");
    (el as any).purpose = "submit form data";
    expect(matchesSemantic(el, "submit form data")).toBe(true);
  });

  it("matches by semanticType", () => {
    const el = createButton("Go");
    (el as any).semanticType = "submit-button";
    expect(matchesSemantic(el, "submit-button")).toBe(true);
  });

  it("matches by alias", () => {
    const el = createButton("Submit");
    (el as any).aliases = ["send", "save", "confirm"];
    expect(matchesSemantic(el, "confirm")).toBe(true);
  });

  it("matches by label when no semantic fields set", () => {
    const el = createButton("Save Changes");
    expect(matchesSemantic(el, "Save Changes")).toBe(true);
  });

  it("fuzzy-matches misspelled purpose", () => {
    const el = createButton("Submit");
    (el as any).purpose = "submit form data";
    // "sumbit" is a common typo for "submit" — token match on "form" + "data" helps
    expect(matchesSemantic(el, "sumbit form data")).toBe(true);
  });

  it("rejects completely unrelated query", () => {
    const el = createButton("Submit");
    (el as any).purpose = "submit form data";
    expect(matchesSemantic(el, "navigate to homepage")).toBe(false);
  });

  it("matches alias even if purpose does not match", () => {
    const el = createButton("X");
    (el as any).purpose = "close dialog";
    (el as any).aliases = ["dismiss", "exit"];
    expect(matchesSemantic(el, "exit")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// semanticSearch
// ---------------------------------------------------------------------------

describe("semanticSearch", () => {
  it("finds elements matching description", () => {
    const btn = createButton("Submit");
    (btn as any).purpose = "submit form data";

    const input = createInput("Email");
    (input as any).purpose = "enter email address";

    const results = semanticSearch([btn, input], {
      description: "submit form",
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.element.id).toBe(btn.id);
    expect(results[0]!.matchedOn).toBe("purpose");
  });

  it("respects maxResults", () => {
    const elements = Array.from({ length: 5 }, (_, i) => {
      const el = createButton(`Button ${i}`);
      (el as any).purpose = `action ${i}`;
      return el;
    });

    const results = semanticSearch(elements, {
      description: "action",
      maxResults: 2,
    });

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("returns results sorted by score descending", () => {
    const exact = createButton("Submit");
    (exact as any).purpose = "submit";

    const partial = createButton("Cancel");
    (partial as any).purpose = "cancel submission";

    const results = semanticSearch([partial, exact], {
      description: "submit",
      minScore: 0.1,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should have the higher score
    if (results.length >= 2) {
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    }
  });

  it("excludes elements below minScore", () => {
    const el = createButton("X");
    (el as any).purpose = "something completely unrelated";

    const results = semanticSearch([el], {
      description: "navigate home",
      minScore: 0.9,
    });

    expect(results.length).toBe(0);
  });

  it("scores reflect match quality — exact label scores higher", () => {
    const perfect = createButton("Save");
    (perfect as any).purpose = "save";

    const okay = createButton("Delete");
    (okay as any).purpose = "delete record";

    const results = semanticSearch([okay, perfect], {
      description: "save",
      minScore: 0.1,
    });

    const perfectResult = results.find((r) => r.element.id === perfect.id);
    const okayResult = results.find((r) => r.element.id === okay.id);

    expect(perfectResult).toBeDefined();
    if (okayResult) {
      expect(perfectResult!.score).toBeGreaterThan(okayResult.score);
    }
  });
});
