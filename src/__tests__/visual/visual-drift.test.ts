/**
 * Unit tests for `runVisualDrift` (Section 8).
 *
 * Stubs `ScreenshotAssertionManager` so we can drive the result shape
 * without invoking real screenshot capture or pixel diff.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  asDriftReport,
  runVisualDrift,
} from "../../visual/visual-drift";
import type { QueryableElement } from "../../core/element-query";
import type {
  ScreenshotAssertionOptions,
  ScreenshotAssertionResult,
} from "../../visual/types";
import type { ScreenshotAssertionManager } from "../../visual/screenshot-assertion";

beforeEach(() => {
  document.body.innerHTML = "";
});

function makeElement(id: string): QueryableElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return {
    id,
    element: el,
    type: "div",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: "",
      rect: { x: 0, y: 0, width: 100, height: 30 },
    }),
  };
}

function stubManager(
  resultsById: Record<string, ScreenshotAssertionResult>,
): ScreenshotAssertionManager {
  const stub: Partial<ScreenshotAssertionManager> = {
    assertMatchesBaseline: async (
      elementId: string,
      _element: HTMLElement,
      _options?: ScreenshotAssertionOptions,
    ): Promise<ScreenshotAssertionResult> => {
      return (
        resultsById[elementId] ?? {
          pass: true,
          diffPercentage: 0,
          diffPixelCount: 0,
          totalPixels: 0,
        }
      );
    },
  };
  return stub as ScreenshotAssertionManager;
}

describe("runVisualDrift", () => {
  it("returns empty entries when every element passes", async () => {
    const a = makeElement("a");
    const b = makeElement("b");
    const manager = stubManager({});
    const r = await runVisualDrift([a, b], manager);
    expect(r.entries).toEqual([]);
    expect(r.details).toEqual([]);
  });

  it("emits visual-drift entries for failing elements", async () => {
    const a = makeElement("a");
    const b = makeElement("b");
    const manager = stubManager({
      a: {
        pass: false,
        diffPercentage: 5.5,
        diffPixelCount: 55,
        totalPixels: 1000,
        diffRegion: { x: 0, y: 0, width: 10, height: 10 },
      },
    });
    const r = await runVisualDrift([a, b], manager);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]?.id).toBe("a");
    expect(r.entries[0]?.kind).toBe("visual-drift");
    expect(r.entries[0]?.detail).toContain("5.5%");
    expect(r.details).toHaveLength(1);
    expect(r.details[0]?.diffPercentage).toBe(5.5);
  });

  it("sorts entries by id ascending (deterministic)", async () => {
    const z = makeElement("z");
    const a = makeElement("a");
    const m = makeElement("m");
    const manager = stubManager({
      z: { pass: false, diffPercentage: 1, diffPixelCount: 1, totalPixels: 100 },
      a: { pass: false, diffPercentage: 2, diffPixelCount: 2, totalPixels: 100 },
      m: { pass: false, diffPercentage: 3, diffPixelCount: 3, totalPixels: 100 },
    });
    const r = await runVisualDrift([z, a, m], manager);
    expect(r.entries.map((e) => e.id)).toEqual(["a", "m", "z"]);
  });

  it("excludes errored captures from entries but surfaces them in details", async () => {
    const a = makeElement("a");
    const manager = stubManager({
      a: {
        pass: false,
        diffPercentage: 100,
        diffPixelCount: 0,
        totalPixels: 0,
        error: "No baseline",
      },
    });
    const r = await runVisualDrift([a], manager);
    expect(r.entries).toEqual([]);
    expect(r.details).toHaveLength(1);
    expect(r.details[0]?.error).toBe("No baseline");
  });

  it("`asDriftReport` packages entries onto the transitions slot", async () => {
    const a = makeElement("a");
    const manager = stubManager({
      a: { pass: false, diffPercentage: 1, diffPixelCount: 1, totalPixels: 100 },
    });
    const r = await runVisualDrift([a], manager);
    const report = asDriftReport(r);
    expect(report.states).toEqual([]);
    expect(report.transitions).toHaveLength(1);
    expect(report.transitions[0]?.kind).toBe("visual-drift");
  });
});
