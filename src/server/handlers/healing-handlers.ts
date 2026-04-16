/**
 * Healing and discovery endpoint handlers.
 */

import type { RegistryLike } from "../../state/state-detector";
import { ElementRelocator } from "../../healing/element-relocator";
import { generateStableId } from "../../discovery/stable-id";
import type { HandlerResponse } from "../handler-types";
import { ok, fail } from "../handler-types";

export function createHealingHandlers(registry: RegistryLike) {
  const relocator = new ElementRelocator(registry);

  return {
    relocateElement: async (body: {
      previousId: string;
    }): Promise<
      HandlerResponse<{
        found: boolean;
        elementId: string | null;
        matchType: string | null;
        confidence: number;
      }>
    > => {
      try {
        if (!body.previousId) {
          return fail("Missing required field: previousId");
        }
        // Try direct lookup first
        const elements = registry.getAllElements();
        const direct = elements.find((el) => el.id === body.previousId);
        if (direct) {
          return ok({
            found: true,
            elementId: direct.id,
            matchType: "direct",
            confidence: 1.0,
          });
        }

        // Try alternative matching
        const alt = relocator.findAlternative({ id: body.previousId });
        if (alt) {
          return ok({
            found: true,
            elementId: alt.element.id,
            matchType: alt.matchType,
            confidence: alt.confidence,
          });
        }

        return ok({
          found: false,
          elementId: null,
          matchType: null,
          confidence: 0,
        });
      } catch (err) {
        return fail(err);
      }
    },

    generateStableIds: async (): Promise<
      HandlerResponse<Array<{ elementId: string; stableId: string }>>
    > => {
      try {
        const elements = registry.getAllElements();
        // Track ids issued so far so generateStableId can disambiguate
        // collisions with a DOM-path hash instead of a positional index.
        const issued = new Set<string>();
        const result = elements.map((el) => {
          const stableId = generateStableId(el.element, issued);
          issued.add(stableId);
          return { elementId: el.id, stableId };
        });
        return ok(result);
      } catch (err) {
        return fail(err);
      }
    },
  };
}
