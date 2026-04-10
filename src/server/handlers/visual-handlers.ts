/**
 * Visual endpoint handlers — highlights, text assertions, screenshot comparison,
 * and coordinate translation.
 */

import type { AutomationEngine } from "../../core/engine";
import type { ElementQuery } from "../../core/element-query";
import type { RegistryLike } from "../../state/state-detector";
import { ElementHighlightManager } from "../../visual/element-highlight";
import { extractElementText, assertTextInElement } from "../../visual/text-assertion";
import { CoordinateTranslator } from "../../visual/coordinate-translator";
import { ScreenshotAssertionManager } from "../../visual/screenshot-assertion";
import type {
  HighlightOptions,
  TextAssertionOptions,
  ScreenshotAssertionOptions,
  CoordinatePoint,
  CoordinateSpace,
  IOCRProvider,
} from "../../visual/types";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export interface VisualHandlersConfig {
  engine: AutomationEngine;
  registry: RegistryLike;
  highlightManager?: ElementHighlightManager;
  screenshotManager?: ScreenshotAssertionManager;
  ocrProvider?: IOCRProvider;
}

export function createVisualHandlers(config: VisualHandlersConfig) {
  const { engine, registry } = config;

  return {
    // === Highlights ===

    highlightElement: async (body: {
      elementId: string;
      options?: HighlightOptions;
    }): Promise<HandlerResponse<{ highlightId: string | null }>> => {
      try {
        if (!body.elementId) {
          return fail("Missing required field: elementId");
        }
        if (!config.highlightManager) {
          return fail("No highlight manager configured");
        }
        const id = config.highlightManager.highlightElement(
          body.elementId,
          registry,
          body.options,
        );
        return ok({ highlightId: id });
      } catch (err) {
        return fail(err);
      }
    },

    dismissHighlight: async (body: {
      highlightId: string;
    }): Promise<HandlerResponse<null>> => {
      try {
        if (!body.highlightId) {
          return fail("Missing required field: highlightId");
        }
        if (!config.highlightManager) {
          return fail("No highlight manager configured");
        }
        config.highlightManager.dismiss(body.highlightId);
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    dismissAllHighlights: async (): Promise<HandlerResponse<null>> => {
      try {
        if (!config.highlightManager) {
          return fail("No highlight manager configured");
        }
        config.highlightManager.dismissAll();
        return ok(null);
      } catch (err) {
        return fail(err);
      }
    },

    // === Text assertions ===

    assertText: async (body: {
      query: ElementQuery;
      expectedText: string;
      options?: TextAssertionOptions;
    }): Promise<HandlerResponse<ReturnType<typeof assertTextInElement> extends Promise<infer R> ? R : never>> => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        if (body.expectedText === undefined) {
          return fail("Missing required field: expectedText");
        }
        const opts = body.options ?? {};
        if (!opts.ocrProvider && config.ocrProvider) {
          opts.ocrProvider = config.ocrProvider;
        }
        const result = await assertTextInElement(
          body.query,
          body.expectedText,
          registry,
          opts,
        );
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    extractText: async (body: {
      query: ElementQuery;
      options?: { maxSize?: number };
    }): Promise<HandlerResponse<{ text: string; source: "dom" | "ocr" }>> => {
      try {
        if (!body.query) {
          return fail("Missing required field: query");
        }
        const elements = registry.getAllElements();
        const found = elements.find((el) => {
          const result = engine.findElement(body.query);
          return result && result.id === el.id;
        });
        if (!found) {
          return fail("Element not found");
        }
        const result = await extractElementText(
          found.element,
          found.id,
          {
            ocrProvider: config.ocrProvider,
            maxSize: body.options?.maxSize,
          },
        );
        return ok({ text: result.text, source: result.source });
      } catch (err) {
        return fail(err);
      }
    },

    // === Screenshot comparison ===

    captureBaseline: async (body: {
      elementId: string;
      key?: string;
    }): Promise<HandlerResponse<{ key: string; captured: boolean }>> => {
      try {
        if (!body.elementId) {
          return fail("Missing required field: elementId");
        }
        if (!config.screenshotManager) {
          return fail("No screenshot manager configured");
        }
        const elements = registry.getAllElements();
        const el = elements.find((e) => e.id === body.elementId);
        if (!el) {
          return fail(`Element not found: ${body.elementId}`);
        }
        const storageKey = body.key ?? `baseline-${body.elementId}`;
        const snapshot = await config.screenshotManager.captureBaseline(
          body.elementId,
          el.element,
          storageKey,
        );
        return ok({ key: storageKey, captured: snapshot !== null });
      } catch (err) {
        return fail(err);
      }
    },

    assertScreenshot: async (body: {
      elementId: string;
      options?: ScreenshotAssertionOptions;
    }): Promise<HandlerResponse<ReturnType<ScreenshotAssertionManager["assertMatchesBaseline"]> extends Promise<infer R> ? R : never>> => {
      try {
        if (!body.elementId) {
          return fail("Missing required field: elementId");
        }
        if (!config.screenshotManager) {
          return fail("No screenshot manager configured");
        }
        const elements = registry.getAllElements();
        const el = elements.find((e) => e.id === body.elementId);
        if (!el) {
          return fail(`Element not found: ${body.elementId}`);
        }
        const result = await config.screenshotManager.assertMatchesBaseline(
          body.elementId,
          el.element,
          body.options,
        );
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },

    // === Coordinate translation ===

    translateCoordinate: async (body: {
      point: CoordinatePoint;
      from: CoordinateSpace;
      to: CoordinateSpace;
      elementId?: string;
    }): Promise<HandlerResponse<CoordinatePoint>> => {
      try {
        if (!body.point) {
          return fail("Missing required field: point");
        }
        if (!body.from || !body.to) {
          return fail("Missing required fields: from, to");
        }

        const translator = new CoordinateTranslator();
        const { from, to, point } = body;

        // Resolve element if needed
        let element: HTMLElement | undefined;
        if (
          (from === "element" || to === "element") &&
          body.elementId
        ) {
          const elements = registry.getAllElements();
          const el = elements.find((e) => e.id === body.elementId);
          if (el) element = el.element;
        }

        let result: CoordinatePoint;

        if (from === "viewport" && to === "page") {
          result = translator.viewportToPage(point);
        } else if (from === "page" && to === "viewport") {
          result = translator.pageToViewport(point);
        } else if (from === "viewport" && to === "screen") {
          result = translator.viewportToScreen(point);
        } else if (from === "screen" && to === "viewport") {
          result = translator.screenToViewport(point);
        } else if (from === "element" && to === "viewport" && element) {
          result = translator.elementToViewport(point, element);
        } else if (from === "viewport" && to === "element" && element) {
          result = translator.viewportToElement(point, element);
        } else if (from === "element" && to === "page" && element) {
          result = translator.elementToPage(point, element);
        } else if (from === "page" && to === "element" && element) {
          result = translator.pageToElement(point, element);
        } else {
          return fail(
            `Unsupported translation: ${from} -> ${to}` +
              (from === "element" || to === "element"
                ? " (elementId required)"
                : ""),
          );
        }

        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
