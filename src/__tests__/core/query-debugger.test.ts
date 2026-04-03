import { describe, it, expect, beforeEach } from "vitest";
import {
  explainQueryMatch,
  diagnoseNoResults,
  formatExplanation,
} from "../../core/query-debugger";
import type { QueryExplanation, CriteriaResult } from "../../types/match";
import {
  createButton,
  createInput,
  createMockElement,
  createCheckbox,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// explainQueryMatch
// ---------------------------------------------------------------------------

describe("explainQueryMatch", () => {
  it("reports passing criterion with correct actual and expected", () => {
    const el = createMockElement({ id: "btn-1", tagName: "button", type: "button" });
    const explanation = explainQueryMatch(el, { id: "btn-1" });

    expect(explanation.matched).toBe(true);
    expect(explanation.criteriaResults).toHaveLength(1);
    expect(explanation.criteriaResults[0]!.criterion).toContain("id");
    expect(explanation.criteriaResults[0]!.matched).toBe(true);
    expect(explanation.criteriaResults[0]!.expected).toBe("btn-1");
    expect(explanation.criteriaResults[0]!.actual).toBe("btn-1");
  });

  it("reports failing criterion", () => {
    const el = createMockElement({ id: "cancel-btn" });
    const explanation = explainQueryMatch(el, { id: "submit-btn" });

    expect(explanation.matched).toBe(false);
    expect(explanation.criteriaResults[0]!.matched).toBe(false);
    expect(explanation.criteriaResults[0]!.expected).toBe("submit-btn");
    expect(explanation.criteriaResults[0]!.actual).toBe("cancel-btn");
  });

  it("evaluates multiple criteria independently", () => {
    const el = createButton("Submit");
    const explanation = explainQueryMatch(el, {
      tagName: "button",
      text: "Cancel",
    });

    expect(explanation.matched).toBe(false);
    const tagCriterion = explanation.criteriaResults.find((c: CriteriaResult) => c.criterion.includes("tagName"));
    const textCriterion = explanation.criteriaResults.find((c: CriteriaResult) => c.criterion.includes("text"));

    expect(tagCriterion!.matched).toBe(true);
    expect(textCriterion!.matched).toBe(false);
    expect(textCriterion!.expected).toBe("Cancel");
    expect(textCriterion!.actual).toBe("Submit");
  });

  it("reports role criterion", () => {
    const el = createButton("Click");
    const explanation = explainQueryMatch(el, { role: "link" });

    expect(explanation.matched).toBe(false);
    expect(explanation.criteriaResults[0]!.criterion).toContain("role");
    expect(explanation.criteriaResults[0]!.matched).toBe(false);
    expect(explanation.criteriaResults[0]!.expected).toBe("link");
    expect(explanation.criteriaResults[0]!.actual).toBe("button");
  });

  it("reports state criteria (visible, enabled, checked)", () => {
    const el = createMockElement({
      state: { visible: true, enabled: false, checked: true },
    });

    const explanation = explainQueryMatch(el, {
      visible: true,
      enabled: true,
      checked: true,
    });

    const visibleC = explanation.criteriaResults.find((c: CriteriaResult) => c.criterion.includes("visible"));
    const enabledC = explanation.criteriaResults.find((c: CriteriaResult) => c.criterion.includes("enabled"));
    const checkedC = explanation.criteriaResults.find((c: CriteriaResult) => c.criterion.includes("checked"));

    expect(visibleC!.matched).toBe(true);
    expect(enabledC!.matched).toBe(false);
    expect(enabledC!.expected).toBe("true");
    expect(enabledC!.actual).toBe("false");
    expect(checkedC!.matched).toBe(true);
  });

  it("sets matched=true only when all criteria pass", () => {
    const el = createButton("Submit");
    const allPass = explainQueryMatch(el, { tagName: "button", text: "Submit" });
    expect(allPass.matched).toBe(true);

    const oneFails = explainQueryMatch(el, { tagName: "button", text: "Cancel" });
    expect(oneFails.matched).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// diagnoseNoResults
// ---------------------------------------------------------------------------

describe("diagnoseNoResults", () => {
  it("finds closest matches sorted by number of passed criteria", () => {
    const btnSubmit = createButton("Submit");
    const btnCancel = createButton("Cancel");
    const input = createInput("Email");

    const diagnosis = diagnoseNoResults(
      [btnSubmit, btnCancel, input],
      { tagName: "button", text: "Save" },
    );

    expect(diagnosis.closestMatches.length).toBeGreaterThanOrEqual(1);
    // Buttons match tagName but not text, so they should score higher than input
    const topMatch = diagnosis.closestMatches[0]!;
    expect(topMatch.matchedCriteria).toBeGreaterThan(0);
    expect(topMatch.failedOn).toContain("text");
  });

  it("suggests relaxing the most commonly failed criterion", () => {
    const el1 = createButton("A");
    const el2 = createButton("B");

    const diagnosis = diagnoseNoResults(
      [el1, el2],
      { text: "Nonexistent", tagName: "button" },
    );

    expect(diagnosis.suggestion.length).toBeGreaterThanOrEqual(1);
    // "text" fails for all elements, so it should be mentioned in the suggestion
    expect(diagnosis.suggestion).toContain("text");
  });

  it("returns empty closestMatches for empty element list", () => {
    const diagnosis = diagnoseNoResults([], { text: "anything" });
    expect(diagnosis.closestMatches).toEqual([]);
    expect(diagnosis.totalElements).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// formatExplanation
// ---------------------------------------------------------------------------

describe("formatExplanation", () => {
  it("produces readable string with MATCHED status", () => {
    const explanation: QueryExplanation = {
      elementId: "btn-1",
      elementLabel: "Submit",
      matched: true,
      criteriaResults: [
        { criterion: "id === 'btn-1'", matched: true, expected: "btn-1", actual: "btn-1" },
      ],
    };

    const output = formatExplanation(explanation);
    expect(output).toContain("btn-1");
    expect(output).toContain("MATCHED");
    expect(output).toContain("[PASS]");
    expect(output).toContain("id");
  });

  it("produces readable string with NOT MATCHED status", () => {
    const explanation: QueryExplanation = {
      elementId: "link-1",
      elementLabel: "",
      matched: false,
      criteriaResults: [
        { criterion: "role === 'button'", matched: false, expected: "button", actual: "link" },
      ],
    };

    const output = formatExplanation(explanation);
    expect(output).toContain("NOT MATCHED");
    expect(output).toContain("[FAIL]");
    expect(output).toContain('expected="button"');
    expect(output).toContain('actual="link"');
  });

  it("includes all criteria in output", () => {
    const explanation: QueryExplanation = {
      elementId: "el-1",
      elementLabel: "",
      matched: false,
      criteriaResults: [
        { criterion: "tagName === 'button'", matched: true, expected: "button", actual: "button" },
        { criterion: "text === 'Save'", matched: false, expected: "Save", actual: "Cancel" },
      ],
    };

    const output = formatExplanation(explanation);
    expect(output).toContain("tagName");
    expect(output).toContain("text");
    expect(output).toContain("[PASS]");
    expect(output).toContain("[FAIL]");
  });
});
