/**
 * Unit tests for `crossCheckText` (Section 8).
 *
 * OCR is stubbed via a canned `IOCRProvider` — no Tesseract, no real
 * pixel reads. Tests the rule-based classifier in isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { crossCheckText } from "../../visual/text-cross-check";
import type { QueryableElement } from "../../core/element-query";
import type { TextRegion } from "../../visual/types";

beforeEach(() => {
  document.body.innerHTML = "";
});

function regionsForConfidence(
  text: string,
  confidences: number[],
): TextRegion[] {
  return confidences.map((c) => ({
    text,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    confidence: c,
  }));
}

function makeElement(
  text: string,
  attachStyles?: (el: HTMLElement) => void,
): QueryableElement {
  const el = document.createElement("span");
  el.textContent = text;
  document.body.appendChild(el);
  attachStyles?.(el);
  return {
    id: "t",
    element: el,
    type: "span",
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: text,
      rect: { x: 0, y: 0, width: 100, height: 30 },
    }),
  };
}

describe("crossCheckText", () => {
  it("returns skipped when no OCR provider or text is supplied", async () => {
    const el = makeElement("Submit");
    const r = await crossCheckText(el, {});
    expect(r.skipped).toBe(true);
    if (r.skipped) {
      expect(r.reason).toBe("no ocr provider");
    }
  });

  it("passes when DOM and OCR text match (ignoring case)", async () => {
    const el = makeElement("Submit");
    const r = await crossCheckText(el, { ocrText: "submit" });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(true);
      expect(r.cause).toBeUndefined();
    }
  });

  it("fails with classification when OCR returns empty AND font-display is swap", async () => {
    const el = makeElement("Submit", (e) => {
      e.style.setProperty("font-display", "swap");
    });
    const r = await crossCheckText(el, { ocrText: "" });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(false);
      expect(r.cause).toBe("font-not-loaded");
    }
  });

  it("classifies a clip-path ancestor as css-clip", async () => {
    const wrapper = document.createElement("div");
    wrapper.style.clipPath = "inset(0 50% 0 0)";
    document.body.appendChild(wrapper);
    const el = document.createElement("span");
    el.textContent = "Submit";
    wrapper.appendChild(el);
    const target: QueryableElement = {
      id: "t",
      element: el,
      type: "span",
      getState: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: "Submit",
        rect: { x: 0, y: 0, width: 100, height: 30 },
      }),
    };
    const r = await crossCheckText(target, { ocrText: "Suxxx" });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(false);
      expect(r.cause).toBe("css-clip");
    }
  });

  it("returns mismatch with cause=unknown when no rule fires", async () => {
    const el = makeElement("Submit");
    const r = await crossCheckText(el, { ocrText: "Cancelxxx" });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(false);
      expect(r.cause).toBe("unknown");
    }
  });

  it("classifies low-contrast when OCR confidence is below threshold", async () => {
    const el = makeElement("Submit");
    const r = await crossCheckText(el, {
      ocrText: "Submitxxx",
      ocrRegions: regionsForConfidence("Submitxxx", [0.2]),
      lowContrastThreshold: 0.5,
    });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(false);
      expect(r.cause).toBe("low-contrast");
    }
  });
});
