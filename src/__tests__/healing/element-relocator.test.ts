import { describe, it, expect, beforeEach } from "vitest";
import { ElementRelocator } from "../../healing/element-relocator";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createInput,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";
import { computeFingerprint } from "../../discovery/element-fingerprint";

let registry: MockRegistry;
let relocator: ElementRelocator;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  registry = new MockRegistry();
  relocator = new ElementRelocator(registry);
});

describe("ElementRelocator", () => {
  describe("relocate", () => {
    it("finds an element by fingerprint", () => {
      const btn = createButton("Submit");
      registry.addElement(btn);

      // Compute the fingerprint from the button's element
      const fp = computeFingerprint(btn.element);

      const found = relocator.relocate(fp);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(btn.id);
    });

    it("returns null when no fingerprint match", () => {
      const btn = createButton("Submit");
      registry.addElement(btn);

      // Create a fingerprint that won't match
      const fp = {
        tagName: "input",
        role: "textbox",
        textHash: "abc123",
        ariaLabel: "",
        depth: 0,
        siblingIndex: 0,
        parentTag: "body",
      };

      const found = relocator.relocate(fp);
      expect(found).toBeNull();
    });
  });

  describe("relocateById", () => {
    it("finds element by ID directly", () => {
      const btn = createButton("OK", { id: "btn-ok" });
      registry.addElement(btn);

      const found = relocator.relocateById("btn-ok");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("btn-ok");
    });

    it("falls back to fingerprint when ID not found", () => {
      const btn = createButton("Submit");
      registry.addElement(btn);

      const fp = computeFingerprint(btn.element);

      // Look for a different ID, but provide the fingerprint
      const found = relocator.relocateById("old-id", fp);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(btn.id);
    });

    it("returns null when no ID and no fingerprint", () => {
      const found = relocator.relocateById("missing-id");
      expect(found).toBeNull();
    });
  });

  describe("findAlternative", () => {
    it("finds by ARIA label", () => {
      const btn = createMockElement({
        id: "btn-1",
        type: "button",
        tagName: "button",
        attributes: { "aria-label": "Close dialog" },
      });
      registry.addElement(btn);

      const result = relocator.findAlternative({
        ariaLabel: "Close dialog",
      });
      expect(result).not.toBeNull();
      expect(result!.matchType).toBe("ariaLabel");
      expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("finds by fuzzy text", () => {
      const btn = createButton("Submit Form");
      registry.addElement(btn);

      const result = relocator.findAlternative({
        text: "Submit Frm",
      });
      expect(result).not.toBeNull();
      expect(result!.matchType).toBe("fuzzyText");
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it("finds by role when only one candidate", () => {
      const btn = createButton("OK");
      registry.addElement(btn);

      const result = relocator.findAlternative({ role: "button" });
      expect(result).not.toBeNull();
      expect(result!.matchType).toBe("role+position");
    });

    it("returns null when no match found", () => {
      const result = relocator.findAlternative({
        role: "nonexistent-role",
      });
      expect(result).toBeNull();
    });
  });
});
