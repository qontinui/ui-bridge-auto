import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ElementHighlightManager,
  ACTION_HIGHLIGHT_COLORS,
  _resetStyleInjection,
} from "../../visual/element-highlight";
import type { RegistryLike } from "../../state/state-detector";
import type { QueryableElement } from "../../core/element-query";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockRegistry(
  elements: Array<{
    id: string;
    rect?: { x: number; y: number; width: number; height: number };
  }>,
): RegistryLike {
  const queryable: QueryableElement[] = elements.map((el) => ({
    id: el.id,
    type: "button",
    label: el.id,
    element: document.createElement("button"),
    getState: () => ({
      visible: true,
      enabled: true,
      focused: false,
      textContent: el.id,
      rect: el.rect,
      computedStyles: {},
    }),
  }));

  return {
    getAllElements: () => queryable,
    on: () => () => {},
  };
}

function getHighlightDivs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll("[data-highlight-id]"),
  ) as HTMLElement[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ElementHighlightManager", () => {
  let manager: ElementHighlightManager;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    document.head.innerHTML = "";
    _resetStyleInjection();
    manager = new ElementHighlightManager();
  });

  afterEach(() => {
    manager.dismissAll();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // highlight()
  // -----------------------------------------------------------------------

  describe("highlight", () => {
    it("creates an overlay div in document.body", () => {
      manager.highlight({ x: 10, y: 20, width: 100, height: 50 });

      const divs = getHighlightDivs();
      expect(divs).toHaveLength(1);
    });

    it("returns a unique highlight ID", () => {
      const id1 = manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      const id2 = manager.highlight({ x: 100, y: 100, width: 50, height: 50 });

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^hl-\d+$/);
    });

    it("positions the overlay at the region coordinates", () => {
      manager.highlight({ x: 42, y: 99, width: 200, height: 60 });

      const div = getHighlightDivs()[0];
      expect(div.style.left).toBe("42px");
      expect(div.style.top).toBe("99px");
      expect(div.style.width).toBe("200px");
      expect(div.style.height).toBe("60px");
    });

    it("applies border color and thickness from options", () => {
      manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { color: "#ff0000", thickness: 5 },
      );

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#ff0000");
      expect(div.style.borderWidth).toBe("5px");
    });

    it("uses default options when none specified", () => {
      manager.highlight({ x: 0, y: 0, width: 100, height: 50 });

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#00c800");
      expect(div.style.borderWidth).toBe("3px");
    });

    it("auto-dismisses after duration", () => {
      manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { duration: 500 },
      );

      expect(getHighlightDivs()).toHaveLength(1);

      vi.advanceTimersByTime(500);

      expect(getHighlightDivs()).toHaveLength(0);
      expect(manager.getActive()).toHaveLength(0);
    });

    it("supports multiple simultaneous highlights", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      manager.highlight({ x: 100, y: 0, width: 50, height: 50 });
      manager.highlight({ x: 200, y: 0, width: 50, height: 50 });

      expect(getHighlightDivs()).toHaveLength(3);
      expect(manager.getActive()).toHaveLength(3);
    });

    it("applies flash animation class when flash is true", () => {
      manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { flash: true, flashInterval: 300 },
      );

      const div = getHighlightDivs()[0];
      expect(div.className).toContain("--flash");
      expect(div.style.getPropertyValue("--hl-flash-interval")).toBe("300ms");
    });

    it("does not apply flash class when flash is false", () => {
      manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { flash: false },
      );

      const div = getHighlightDivs()[0];
      expect(div.className).not.toContain("--flash");
    });

    it("creates a label element when label is specified", () => {
      manager.highlight(
        { x: 50, y: 100, width: 200, height: 40 },
        { label: "Submit Button" },
      );

      const labels = document.querySelectorAll(
        ".ui-bridge-auto-highlight__label",
      );
      expect(labels).toHaveLength(1);
      expect(labels[0].textContent).toBe("Submit Button");
    });

    it("does not create a label when label is empty", () => {
      manager.highlight({ x: 0, y: 0, width: 100, height: 50 });

      const labels = document.querySelectorAll(
        ".ui-bridge-auto-highlight__label",
      );
      expect(labels).toHaveLength(0);
    });

    it("injects CSS styles on first call", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });

      const styles = document.head.querySelectorAll("style");
      expect(styles.length).toBeGreaterThanOrEqual(1);
      expect(styles[0].textContent).toContain("ui-bridge-auto-highlight");
    });

    it("injects styles only once across multiple calls", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      manager.highlight({ x: 100, y: 0, width: 50, height: 50 });

      const styles = document.head.querySelectorAll("style");
      expect(styles).toHaveLength(1);
    });

    it("sets opacity CSS variable", () => {
      manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { opacity: 0.5 },
      );

      const div = getHighlightDivs()[0];
      expect(div.style.getPropertyValue("--hl-opacity")).toBe("0.5");
    });
  });

  // -----------------------------------------------------------------------
  // dismiss()
  // -----------------------------------------------------------------------

  describe("dismiss", () => {
    it("removes the overlay from DOM", () => {
      const id = manager.highlight({ x: 0, y: 0, width: 100, height: 50 });
      expect(getHighlightDivs()).toHaveLength(1);

      manager.dismiss(id);
      expect(getHighlightDivs()).toHaveLength(0);
    });

    it("removes the label element too", () => {
      const id = manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { label: "Test" },
      );

      expect(
        document.querySelectorAll(".ui-bridge-auto-highlight__label"),
      ).toHaveLength(1);

      manager.dismiss(id);

      expect(
        document.querySelectorAll(".ui-bridge-auto-highlight__label"),
      ).toHaveLength(0);
    });

    it("is a no-op for unknown IDs", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      manager.dismiss("nonexistent");
      expect(getHighlightDivs()).toHaveLength(1);
    });

    it("clears the auto-dismiss timer", () => {
      const id = manager.highlight(
        { x: 0, y: 0, width: 100, height: 50 },
        { duration: 1000 },
      );

      manager.dismiss(id);

      // Advancing past the original duration should not cause errors
      vi.advanceTimersByTime(1500);
      expect(manager.getActive()).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // dismissAll()
  // -----------------------------------------------------------------------

  describe("dismissAll", () => {
    it("removes all active highlights", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      manager.highlight({ x: 100, y: 0, width: 50, height: 50 });
      manager.highlight(
        { x: 200, y: 0, width: 50, height: 50 },
        { label: "Third" },
      );

      expect(getHighlightDivs()).toHaveLength(3);

      manager.dismissAll();

      expect(getHighlightDivs()).toHaveLength(0);
      expect(manager.getActive()).toHaveLength(0);
      expect(
        document.querySelectorAll(".ui-bridge-auto-highlight__label"),
      ).toHaveLength(0);
    });

    it("is a no-op when no highlights are active", () => {
      expect(() => manager.dismissAll()).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // getActive()
  // -----------------------------------------------------------------------

  describe("getActive", () => {
    it("returns snapshot of active highlights", () => {
      manager.highlight({ x: 0, y: 0, width: 50, height: 50 });
      manager.highlight({ x: 100, y: 0, width: 50, height: 50 });

      const active = manager.getActive();
      expect(active).toHaveLength(2);
      expect(active[0].id).toMatch(/^hl-/);
      expect(active[0].region).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });

    it("returns empty array when no highlights", () => {
      expect(manager.getActive()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // highlightElement()
  // -----------------------------------------------------------------------

  describe("highlightElement", () => {
    it("looks up element rect from registry and highlights it", () => {
      const registry = createMockRegistry([
        { id: "btn-1", rect: { x: 50, y: 100, width: 200, height: 40 } },
      ]);

      const id = manager.highlightElement("btn-1", registry);
      expect(id).not.toBeNull();

      const div = getHighlightDivs()[0];
      expect(div.style.left).toBe("50px");
      expect(div.style.top).toBe("100px");
      expect(div.style.width).toBe("200px");
      expect(div.style.height).toBe("40px");
    });

    it("returns null for unknown element ID", () => {
      const registry = createMockRegistry([]);
      const id = manager.highlightElement("nonexistent", registry);
      expect(id).toBeNull();
    });

    it("returns null when element has no rect", () => {
      const registry = createMockRegistry([{ id: "btn-1" }]);
      const id = manager.highlightElement("btn-1", registry);
      expect(id).toBeNull();
    });

    it("stores elementId on the highlight", () => {
      const registry = createMockRegistry([
        { id: "btn-1", rect: { x: 0, y: 0, width: 100, height: 50 } },
      ]);

      manager.highlightElement("btn-1", registry);
      const active = manager.getActive();
      expect(active[0].elementId).toBe("btn-1");
    });

    it("passes options through to highlight()", () => {
      const registry = createMockRegistry([
        { id: "btn-1", rect: { x: 0, y: 0, width: 100, height: 50 } },
      ]);

      manager.highlightElement("btn-1", registry, {
        color: "#ff0000",
        thickness: 5,
      });

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#ff0000");
      expect(div.style.borderWidth).toBe("5px");
    });
  });

  // -----------------------------------------------------------------------
  // highlightAction()
  // -----------------------------------------------------------------------

  describe("highlightAction", () => {
    it("selects green for click actions", () => {
      const registry = createMockRegistry([
        { id: "btn-1", rect: { x: 0, y: 0, width: 100, height: 50 } },
      ]);

      manager.highlightAction("btn-1", "click", registry);

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#00c800");
    });

    it("selects blue for type actions", () => {
      const registry = createMockRegistry([
        { id: "input-1", rect: { x: 0, y: 0, width: 200, height: 30 } },
      ]);

      manager.highlightAction("input-1", "type", registry);

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#0064ff");
    });

    it("selects orange for scroll actions", () => {
      const registry = createMockRegistry([
        { id: "panel-1", rect: { x: 0, y: 0, width: 400, height: 300 } },
      ]);

      manager.highlightAction("panel-1", "scroll", registry);

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#ff8c00");
    });

    it("selects purple for toggle actions", () => {
      const registry = createMockRegistry([
        { id: "cb-1", rect: { x: 0, y: 0, width: 20, height: 20 } },
      ]);

      manager.highlightAction("cb-1", "toggle", registry);

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#b400b4");
    });

    it("selects teal for focus actions", () => {
      const registry = createMockRegistry([
        { id: "input-1", rect: { x: 0, y: 0, width: 200, height: 30 } },
      ]);

      manager.highlightAction("input-1", "focus", registry);

      const div = getHighlightDivs()[0];
      expect(div.dataset.highlightColor).toBe("#00b4b4");
    });

    it("returns null for unknown elements", () => {
      const registry = createMockRegistry([]);
      const id = manager.highlightAction("nonexistent", "click", registry);
      expect(id).toBeNull();
    });

    it("allows overriding non-color options", () => {
      const registry = createMockRegistry([
        { id: "btn-1", rect: { x: 0, y: 0, width: 100, height: 50 } },
      ]);

      manager.highlightAction("btn-1", "click", registry, {
        thickness: 8,
        flash: true,
      });

      const div = getHighlightDivs()[0];
      // Color should still be the action color, not overridden
      expect(div.dataset.highlightColor).toBe("#00c800");
      expect(div.style.borderWidth).toBe("8px");
      expect(div.className).toContain("--flash");
    });
  });

  // -----------------------------------------------------------------------
  // ACTION_HIGHLIGHT_COLORS
  // -----------------------------------------------------------------------

  describe("ACTION_HIGHLIGHT_COLORS", () => {
    it("maps all ActionType values", () => {
      const allActions: string[] = [
        "click", "doubleClick", "rightClick", "middleClick",
        "type", "clear", "select", "check", "uncheck", "toggle",
        "focus", "blur", "hover", "scrollIntoView", "scroll",
        "sendKeys", "drag", "submit", "reset", "setValue",
        "mouseDown", "mouseUp", "keyDown", "keyUp",
      ];

      for (const action of allActions) {
        expect(ACTION_HIGHLIGHT_COLORS).toHaveProperty(action);
        expect(
          ACTION_HIGHLIGHT_COLORS[action as keyof typeof ACTION_HIGHLIGHT_COLORS],
        ).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });
  });
});
