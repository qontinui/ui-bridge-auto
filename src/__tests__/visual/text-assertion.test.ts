import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractElementText,
  assertTextInElement,
} from "../../visual/text-assertion";
import type { IOCRProvider } from "../../visual/types";
import type { QueryableElement } from "../../core/element-query";
import type { RegistryLike } from "../../state/state-detector";

// ---------------------------------------------------------------------------
// Mock OCR provider
// ---------------------------------------------------------------------------

function createMockOCRProvider(text: string): IOCRProvider {
  return {
    extractText: vi.fn().mockResolvedValue(text),
    getTextRegions: vi.fn().mockResolvedValue([
      { text, x: 0, y: 0, width: 100, height: 20, confidence: 0.95 },
    ]),
  };
}

// ---------------------------------------------------------------------------
// Mock registry
// ---------------------------------------------------------------------------

function createMockRegistry(
  elements: Array<{
    id: string;
    label?: string;
    tagName?: string;
    textContent?: string;
    type?: string;
  }>,
): RegistryLike {
  const queryable: QueryableElement[] = elements.map((el) => {
    const htmlEl = document.createElement(el.tagName ?? "div");
    if (el.textContent !== undefined) {
      htmlEl.textContent = el.textContent;
    }
    return {
      id: el.id,
      type: el.type ?? "button",
      label: el.label ?? el.id,
      element: htmlEl,
      getState: () => ({
        visible: true,
        enabled: true,
        focused: false,
        textContent: el.textContent ?? "",
        rect: { x: 0, y: 0, width: 100, height: 30 },
        computedStyles: {},
      }),
    };
  });

  return {
    getAllElements: () => queryable,
    on: () => () => {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// extractElementText
// ---------------------------------------------------------------------------

describe("extractElementText", () => {
  it("extracts textContent from DOM elements", async () => {
    const div = document.createElement("div");
    div.textContent = "Hello World";

    const result = await extractElementText(div, "div-1");
    expect(result.text).toBe("Hello World");
    expect(result.source).toBe("dom");
  });

  it("trims whitespace from DOM text", async () => {
    const p = document.createElement("p");
    p.textContent = "  spaced out  ";

    const result = await extractElementText(p, "p-1");
    expect(result.text).toBe("spaced out");
  });

  it("returns empty string for elements with no text", async () => {
    const div = document.createElement("div");

    const result = await extractElementText(div, "div-1");
    expect(result.text).toBe("");
    expect(result.source).toBe("dom");
  });

  it("extracts text from button elements via DOM", async () => {
    const btn = document.createElement("button");
    btn.textContent = "Submit";

    const result = await extractElementText(btn, "btn-1");
    expect(result.text).toBe("Submit");
    expect(result.source).toBe("dom");
  });

  it("extracts text from input elements via DOM", async () => {
    const input = document.createElement("input");
    input.textContent = "";

    const result = await extractElementText(input, "input-1");
    expect(result.source).toBe("dom");
  });

  it("identifies canvas as a media element needing OCR", async () => {
    const canvas = document.createElement("canvas");
    const provider = createMockOCRProvider("Chart: 42%");

    const result = await extractElementText(canvas, "canvas-1", {
      ocrProvider: provider,
    });

    expect(result.source).toBe("ocr");
  });

  it("identifies img as a media element needing OCR", async () => {
    const img = document.createElement("img");
    const provider = createMockOCRProvider("alt text detected");

    const result = await extractElementText(img, "img-1", {
      ocrProvider: provider,
    });

    expect(result.source).toBe("ocr");
  });

  it("identifies video as a media element needing OCR", async () => {
    const video = document.createElement("video");

    const result = await extractElementText(video, "video-1");
    expect(result.source).toBe("ocr");
    expect(result.text).toBe("");
  });

  it("identifies svg as a media element needing OCR", async () => {
    const svg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as unknown as HTMLElement;

    const result = await extractElementText(svg, "svg-1");
    expect(result.source).toBe("ocr");
  });

  it("returns empty text for media elements without OCR provider", async () => {
    const canvas = document.createElement("canvas");

    const result = await extractElementText(canvas, "canvas-1");
    expect(result.text).toBe("");
    expect(result.source).toBe("ocr");
    expect(result.regions).toBeUndefined();
  });

  it("calls OCR provider with snapshot data when available", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 50;

    const provider = createMockOCRProvider("OCR result");

    const result = await extractElementText(canvas, "canvas-1", {
      ocrProvider: provider,
      maxSize: 256,
    });

    expect(result.source).toBe("ocr");
  });
});

// ---------------------------------------------------------------------------
// assertTextInElement
// ---------------------------------------------------------------------------

describe("assertTextInElement", () => {
  it("passes for exact text match (case insensitive)", async () => {
    const registry = createMockRegistry([
      { id: "btn-1", label: "Submit", textContent: "Submit Order" },
    ]);

    // Use id query to find the element, then assert expected text
    const result = await assertTextInElement(
      { id: "btn-1" },
      "Submit Order",
      registry,
    );

    expect(result.pass).toBe(true);
    expect(result.actualText).toBe("Submit Order");
    expect(result.expectedText).toBe("Submit Order");
    expect(result.matchType).toBe("dom");
    expect(result.confidence).toBe(1.0);
  });

  it("passes for case-insensitive match", async () => {
    const registry = createMockRegistry([
      { id: "btn-1", label: "Submit", textContent: "submit order" },
    ]);

    const result = await assertTextInElement(
      { id: "btn-1" },
      "Submit Order",
      registry,
      { caseSensitive: false },
    );

    expect(result.pass).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it("fails for case mismatch when caseSensitive is true", async () => {
    const registry = createMockRegistry([
      { id: "btn-1", label: "Submit", textContent: "submit order" },
    ]);

    const result = await assertTextInElement(
      { id: "btn-1" },
      "Submit Order",
      registry,
      { caseSensitive: true },
    );

    expect(result.pass).toBe(false);
    expect(result.confidence).toBeLessThan(1.0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("passes for fuzzy match above threshold", async () => {
    const registry = createMockRegistry([
      { id: "btn-1", label: "Submit", textContent: "Submitt Order" },
    ]);

    const result = await assertTextInElement(
      { id: "btn-1" },
      "Submit Order",
      registry,
      { fuzzyThreshold: 0.8 },
    );

    // "submitt order" vs "submit order" is very similar
    expect(result.pass).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("fails for fuzzy match below threshold", async () => {
    const registry = createMockRegistry([
      { id: "btn-1", label: "Submit", textContent: "Cancel" },
    ]);

    const result = await assertTextInElement(
      { id: "btn-1" },
      "Submit Order",
      registry,
      { fuzzyThreshold: 0.8 },
    );

    expect(result.pass).toBe(false);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it("returns error when element is not found", async () => {
    const registry = createMockRegistry([]);

    const result = await assertTextInElement(
      { id: "nonexistent" },
      "Hello",
      registry,
    );

    expect(result.pass).toBe(false);
    expect(result.error).toBe("Element not found");
    expect(result.confidence).toBe(0);
  });

  it("returns OCR error for media elements without provider", async () => {
    const registry = createMockRegistry([
      { id: "canvas-1", label: "chart", tagName: "canvas", textContent: "" },
    ]);

    const result = await assertTextInElement(
      { id: "canvas-1" },
      "Sales: 42%",
      registry,
    );

    expect(result.pass).toBe(false);
    expect(result.matchType).toBe("ocr");
    expect(result.error).toBe("No OCR provider configured for media element");
  });

  it("uses DOM textContent for standard elements, not OCR", async () => {
    const provider = createMockOCRProvider("OCR would say this");
    const registry = createMockRegistry([
      { id: "div-1", label: "content", textContent: "DOM text" },
    ]);

    const result = await assertTextInElement(
      { id: "div-1" },
      "DOM text",
      registry,
      { ocrProvider: provider },
    );

    expect(result.pass).toBe(true);
    expect(result.matchType).toBe("dom");
    expect(result.actualText).toBe("DOM text");
    // Provider should NOT have been called for a div
    expect(provider.extractText).not.toHaveBeenCalled();
  });

  it("handles exact match with confidence 1.0", async () => {
    const registry = createMockRegistry([
      { id: "h1-1", label: "title", textContent: "Welcome" },
    ]);

    const result = await assertTextInElement(
      { id: "h1-1" },
      "Welcome",
      registry,
      { caseSensitive: true },
    );

    expect(result.pass).toBe(true);
    expect(result.confidence).toBe(1.0);
  });

  it("handles empty expected text", async () => {
    const registry = createMockRegistry([
      { id: "div-1", label: "empty", textContent: "" },
    ]);

    const result = await assertTextInElement(
      { id: "div-1" },
      "",
      registry,
    );

    expect(result.pass).toBe(true);
    expect(result.actualText).toBe("");
    expect(result.confidence).toBe(1.0);
  });

  it("retries with timeout until text matches", async () => {
    const registry = createMockRegistry([
      { id: "loading-el", label: "loading", textContent: "Loading..." },
    ]);

    // After 150ms, change the element's text content
    const elements = registry.getAllElements();
    const el = elements[0].element;
    setTimeout(() => {
      el.textContent = "Done";
    }, 150);

    const result = await assertTextInElement(
      { id: "loading-el" },
      "Done",
      registry,
      { timeout: 2000 },
    );

    expect(result.pass).toBe(true);
    expect(result.actualText).toBe("Done");
  });

  it("returns failure when timeout expires without match", async () => {
    const registry = createMockRegistry([
      { id: "stuck-el", label: "stuck", textContent: "Loading..." },
    ]);

    const result = await assertTextInElement(
      { id: "stuck-el" },
      "Done",
      registry,
      { timeout: 200 },
    );

    expect(result.pass).toBe(false);
    expect(result.actualText).toBe("Loading...");
  });
});
