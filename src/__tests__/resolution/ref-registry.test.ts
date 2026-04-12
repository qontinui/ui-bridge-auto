import { describe, it, expect, beforeEach } from "vitest";
import { RefRegistry } from "../../resolution/ref-registry";
import { RefInvalidatedError } from "../../resolution/types";
import type { AutomationElement } from "../../types/element";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockRegistry: MockRegistry;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  mockRegistry = new MockRegistry();
});

/** Create a minimal AutomationElement from a QueryableElement. */
function toAutomationElement(
  qe: ReturnType<typeof createButton>,
  stableId: string,
): AutomationElement {
  return {
    id: qe.id,
    stableId,
    type: (qe.type ?? "generic") as AutomationElement["type"],
    label: qe.label ?? "",
    state: {
      visible: true,
      enabled: true,
      focused: false,
      textContent: qe.element.textContent?.trim() ?? "",
      rect: { x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0 },
      computedStyles: {
        display: "block",
        visibility: "visible",
        opacity: "1",
        pointerEvents: "auto",
        color: "rgb(0,0,0)",
        backgroundColor: "rgb(255,255,255)",
        fontSize: "14px",
        fontWeight: "400",
      },
    },
    aliases: [],
    depth: 1,
  };
}

// ---------------------------------------------------------------------------
// assignRef
// ---------------------------------------------------------------------------

describe("RefRegistry.assignRef", () => {
  it("generates a unique refId per call", () => {
    const registry = new RefRegistry();
    const btn = createButton("A");
    mockRegistry.addElement(btn);

    const ae = toAutomationElement(btn, "button-a-root");
    const ts = Date.now();

    const ref1 = registry.assignRef(ae, btn.element, ts);
    const ref2 = registry.assignRef(ae, btn.element, ts);

    expect(ref1).not.toBe(ref2);
    expect(ref1).toMatch(/^ref-\d+-0$/);
    expect(ref2).toMatch(/^ref-\d+-1$/);
  });

  it("increments size for each assigned ref", () => {
    const registry = new RefRegistry();
    const btn = createButton("A");
    const ae = toAutomationElement(btn, "button-a-root");

    expect(registry.size).toBe(0);
    registry.assignRef(ae, btn.element, Date.now());
    expect(registry.size).toBe(1);
    registry.assignRef(ae, btn.element, Date.now());
    expect(registry.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resolve — exact ID match
// ---------------------------------------------------------------------------

describe("RefRegistry.resolve — exact ID", () => {
  it("resolves via exact registry ID when element keeps its ID", () => {
    const registry = new RefRegistry();
    const btn = createButton("Login");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-login-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    const result = registry.resolve(refId, mockRegistry.getAllElements());

    expect(result.resolvedVia).toBe("exact");
    expect(result.elementId).toBe(btn.id);
    expect(result.element).toBe(btn.element);
  });
});

// ---------------------------------------------------------------------------
// resolve — stableId match
// ---------------------------------------------------------------------------

describe("RefRegistry.resolve — stableId", () => {
  it("resolves via stableId when registry ID changes", () => {
    const registry = new RefRegistry();
    const btn = createButton("Login");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-login-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    // Simulate the element getting a new registry ID but same DOM element.
    mockRegistry.removeElement(btn.id);
    const sameBtn = {
      ...btn,
      id: "new-id-999",
    };
    mockRegistry.addElement(sameBtn);

    const result = registry.resolve(refId, mockRegistry.getAllElements());

    expect(result.resolvedVia).toBe("stableId");
    expect(result.elementId).toBe("new-id-999");
  });
});

// ---------------------------------------------------------------------------
// resolve — fingerprint match
// ---------------------------------------------------------------------------

describe("RefRegistry.resolve — fingerprint", () => {
  it("resolves via fingerprint when both ID and stableId change", () => {
    const registry = new RefRegistry();

    // Create original button.
    const btn = createButton("Submit");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-submit-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    // Remove original, create a new button with same tag/role/text but different ID.
    mockRegistry.removeElement(btn.id);
    // The original DOM element is still in the document, so create a fresh
    // element with the same text so generateStableId returns something different
    // (different landmark context after removal).
    const newBtn = createButton("Submit", {
      id: "brand-new-id",
      attributes: { "data-testid": "unique-submit-btn" },
    });
    mockRegistry.addElement(newBtn);

    const result = registry.resolve(refId, mockRegistry.getAllElements());

    expect(result.resolvedVia).toBe("fingerprint");
    expect(result.elementId).toBe("brand-new-id");
  });
});

// ---------------------------------------------------------------------------
// resolve — errors
// ---------------------------------------------------------------------------

describe("RefRegistry.resolve — errors", () => {
  it("throws not-found when no element matches", () => {
    const registry = new RefRegistry();
    const btn = createButton("Gone");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-gone-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    // Remove the element entirely.
    mockRegistry.removeElement(btn.id);
    btn.element.remove();

    expect(() => registry.resolve(refId, mockRegistry.getAllElements())).toThrow(
      RefInvalidatedError,
    );
    try {
      registry.resolve(refId, mockRegistry.getAllElements());
    } catch (e) {
      expect(e).toBeInstanceOf(RefInvalidatedError);
      expect((e as RefInvalidatedError).reason).toBe("not-found");
    }
  });

  it("throws ambiguous when multiple elements match fingerprint", () => {
    const registry = new RefRegistry();

    const btn1 = createButton("Action");
    mockRegistry.addElement(btn1);
    const ae = toAutomationElement(btn1, "button-action-root");
    const refId = registry.assignRef(ae, btn1.element, Date.now());

    // Remove original, add two identical buttons.
    mockRegistry.removeElement(btn1.id);
    const dup1 = createButton("Action", {
      id: "dup-1",
      attributes: { "data-testid": "dup-action-1" },
    });
    const dup2 = createButton("Action", {
      id: "dup-2",
      attributes: { "data-testid": "dup-action-2" },
    });
    mockRegistry.addElement(dup1);
    mockRegistry.addElement(dup2);

    expect(() => registry.resolve(refId, mockRegistry.getAllElements())).toThrow(
      RefInvalidatedError,
    );
    try {
      registry.resolve(refId, mockRegistry.getAllElements());
    } catch (e) {
      expect((e as RefInvalidatedError).reason).toBe("ambiguous");
    }
  });

  it("throws stale-snapshot when ref exceeds maxAgeMs", () => {
    const registry = new RefRegistry({ maxAgeMs: 100 });
    const btn = createButton("Old");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-old-root");

    // Assign with a timestamp far in the past.
    const refId = registry.assignRef(ae, btn.element, Date.now() - 200);

    expect(() => registry.resolve(refId, mockRegistry.getAllElements())).toThrow(
      RefInvalidatedError,
    );
    try {
      registry.resolve(refId, mockRegistry.getAllElements());
    } catch (e) {
      expect((e as RefInvalidatedError).reason).toBe("stale-snapshot");
    }
  });

  it("throws not-found for unknown refId", () => {
    const registry = new RefRegistry();
    expect(() => registry.resolve("ref-999-0", [])).toThrow(RefInvalidatedError);
  });
});

// ---------------------------------------------------------------------------
// DOM mutation resilience
// ---------------------------------------------------------------------------

describe("RefRegistry.resolve — DOM mutations", () => {
  it("survives sibling addition between snapshot and resolve", () => {
    const registry = new RefRegistry();
    const btn = createButton("Save");
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-save-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    // Add a sibling element (changes siblingIndex context).
    const sibling = createButton("Cancel");
    mockRegistry.addElement(sibling);
    // Move sibling before the button in DOM.
    btn.element.parentElement?.insertBefore(sibling.element, btn.element);

    const result = registry.resolve(refId, mockRegistry.getAllElements());
    expect(result.element).toBe(btn.element);
  });

  it("survives text content change when stableId still matches", () => {
    const registry = new RefRegistry();
    const btn = createMockElement({
      tagName: "button",
      textContent: "Save Draft",
      type: "button",
      label: "Save Draft",
    });
    mockRegistry.addElement(btn);
    const ae = toAutomationElement(btn, "button-save-draft-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    // Mutate text slightly — stableId is based on DOM content at resolve time
    // but exact ID still matches, so it resolves via Pass 1.
    btn.element.textContent = "Save Draft (modified)";

    const result = registry.resolve(refId, mockRegistry.getAllElements());
    expect(result.resolvedVia).toBe("exact");
  });
});

// ---------------------------------------------------------------------------
// invalidate / has / clear
// ---------------------------------------------------------------------------

describe("RefRegistry utility methods", () => {
  it("invalidate removes a ref", () => {
    const registry = new RefRegistry();
    const btn = createButton("X");
    const ae = toAutomationElement(btn, "button-x-root");
    const refId = registry.assignRef(ae, btn.element, Date.now());

    expect(registry.has(refId)).toBe(true);
    registry.invalidate(refId);
    expect(registry.has(refId)).toBe(false);
  });

  it("clear removes all refs and resets counter", () => {
    const registry = new RefRegistry();
    const btn = createButton("Y");
    const ae = toAutomationElement(btn, "button-y-root");
    registry.assignRef(ae, btn.element, Date.now());
    registry.assignRef(ae, btn.element, Date.now());

    expect(registry.size).toBe(2);
    registry.clear();
    expect(registry.size).toBe(0);

    // Counter resets — next ref starts at sequence 0.
    const refId = registry.assignRef(ae, btn.element, 1000);
    expect(refId).toBe("ref-1000-0");
  });
});
