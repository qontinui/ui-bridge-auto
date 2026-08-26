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

  // --- the `occluded` rule ------------------------------------------------
  //
  // Before it existed, a widget parked on top of a label produced DOM text
  // present + OCR empty, which is `font-not-loaded`'s exact signature. The
  // classifier reported a webfont bug that did not exist while the real
  // defect — something covering the text — went unnamed.

  function queryable(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
    zIndex: string,
    text = "",
  ): QueryableElement {
    const el = document.createElement("div");
    el.textContent = text;
    document.body.appendChild(el);
    return {
      id,
      element: el,
      type: "div",
      getState: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: text,
        rect,
        computedStyles: { zIndex, position: "absolute" },
      }),
    };
  }

  it("blames the covering widget, not the font, when a label is occluded", async () => {
    const label = queryable(
      "terminal-zone-header-8",
      { x: 0, y: 0, width: 400, height: 20 },
      "10",
      "Zone 8: qontinui-web",
    );
    const widget = queryable(
      "terminal-zone-minimap",
      { x: 0, y: 0, width: 400, height: 20 },
      "30",
    );

    const r = await crossCheckText(label, {
      ocrText: "",
      registry: [label, widget],
    });

    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.pass).toBe(false);
      expect(r.cause).toBe("occluded");
      expect(r.occlusion?.occludedBy).toBe("terminal-zone-minimap");
      expect(r.occlusion?.ratio).toBeGreaterThan(0.1);
    }
  });

  it("still reports font-not-loaded when nothing is covering the element", async () => {
    // Same empty-OCR signature, no occluder -> the original rule must still
    // fire. The new rule narrows the diagnosis; it must not shadow it.
    const label = queryable(
      "solo-label",
      { x: 0, y: 0, width: 400, height: 20 },
      "10",
      "Zone 8: qontinui-web",
    );
    const elsewhere = queryable(
      "far-away",
      { x: 900, y: 900, width: 50, height: 50 },
      "30",
    );

    const r = await crossCheckText(label, {
      ocrText: "",
      registry: [label, elsewhere],
    });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.cause).toBe("font-not-loaded");
      expect(r.occlusion).toBeUndefined();
    }
  });

  it("does not blame a tracked overlay for covering the page", async () => {
    // A modal covering its page is the modal working.
    const label = queryable(
      "behind-the-modal",
      { x: 0, y: 0, width: 400, height: 20 },
      "1",
      "Zone 8: qontinui-web",
    );
    const modal = queryable("modal", { x: 0, y: 0, width: 400, height: 20 }, "99");

    const r = await crossCheckText(label, {
      ocrText: "",
      registry: [label, modal],
      isKnownOverlay: (el) => el === modal.element,
    });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.cause).not.toBe("occluded");
    }
  });

  it("evaluates the other rules unchanged when no registry is supplied", async () => {
    // Absence of a registry must not be treated as "nothing is covering it";
    // it must simply skip the rule and let the rest run.
    const el = makeElement("Submit");
    const r = await crossCheckText(el, { ocrText: "" });
    expect(r.skipped).toBe(false);
    if (!r.skipped) {
      expect(r.cause).toBe("font-not-loaded");
    }
  });

});
