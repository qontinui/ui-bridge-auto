import { describe, it, expect } from "vitest";
import {
  enhanceWithClient,
  createMockClient,
} from "../../static-builder/enhancement/ai-analyzer";
import type { UncertainItem } from "../../static-builder/pipeline";

function makeItem(
  type: UncertainItem["type"],
  description: string,
  line: number = 1,
): UncertainItem {
  return { type, sourceFile: "/src/Test.tsx", line, description };
}

describe("AI Analyzer", () => {
  describe("enhanceWithClient", () => {
    it("returns empty result for empty items", async () => {
      const client = createMockClient(async () => "");
      const result = await enhanceWithClient([], client);

      expect(result.dynamicNavigations).toHaveLength(0);
      expect(result.inferredElements).toHaveLength(0);
      expect(result.improvedLabels).toHaveLength(0);
      expect(result.unresolved).toHaveLength(0);
    });

    it("resolves dynamic navigation targets", async () => {
      const client = createMockClient(async (_system, user) => {
        if (user.includes("dynamic navigation")) {
          return JSON.stringify({
            possibleTargets: ["settings", "dashboard"],
            confidence: 0.9,
            reasoning: "Variable is set from a switch on user role",
          });
        }
        return "{}";
      });

      const items: UncertainItem[] = [
        makeItem("dynamic-navigation", 'setActiveTab(targetTab) — variable target'),
      ];

      const result = await enhanceWithClient(items, client, {
        knownRouteIds: ["home", "settings", "dashboard"],
      });

      expect(result.dynamicNavigations).toHaveLength(1);
      expect(result.dynamicNavigations[0].possibleTargets).toEqual([
        "settings",
        "dashboard",
      ]);
      expect(result.dynamicNavigations[0].confidence).toBe(0.9);
      expect(result.unresolved).toHaveLength(0);
    });

    it("resolves unknown component elements", async () => {
      const client = createMockClient(async (_system, user) => {
        if (user.includes("React component likely renders")) {
          return JSON.stringify({
            inferredElements: [
              { role: "heading", text: "Error Monitor" },
              { role: "button", ariaLabel: "Refresh" },
              { role: "log", ariaLabel: "Error log" },
            ],
            confidence: 0.7,
            reasoning: "ErrorMonitorTab likely shows error logs with controls",
          });
        }
        return "{}";
      });

      const items: UncertainItem[] = [
        makeItem(
          "unknown-component",
          'Could not resolve component "ErrorMonitorTab" for route "error-monitor"',
        ),
      ];

      const result = await enhanceWithClient(items, client);

      expect(result.inferredElements).toHaveLength(1);
      expect(result.inferredElements[0].inferredElements).toHaveLength(3);
      expect(result.inferredElements[0].inferredElements[0].role).toBe("heading");
      expect(result.inferredElements[0].confidence).toBe(0.7);
    });

    it("improves complex condition labels", async () => {
      const client = createMockClient(async (_system, user) => {
        if (user.includes("condition expressions")) {
          return JSON.stringify({
            labels: [
              {
                original: "execution?.config?.loaded && !execution.isRunning",
                improved: "Config Loaded Idle",
              },
              {
                original: "selectedRuns.size > 0",
                improved: "Runs Selected",
              },
            ],
          });
        }
        return "{}";
      });

      const items: UncertainItem[] = [
        makeItem(
          "complex-condition",
          "execution?.config?.loaded && !execution.isRunning",
        ),
        makeItem("complex-condition", "selectedRuns.size > 0"),
      ];

      const result = await enhanceWithClient(items, client);

      expect(result.improvedLabels).toHaveLength(2);
      expect(result.improvedLabels[0].improvedLabel).toBe("Config Loaded Idle");
      expect(result.improvedLabels[1].improvedLabel).toBe("Runs Selected");
    });

    it("handles AI response in markdown code fence", async () => {
      const client = createMockClient(async () => {
        return '```json\n{"possibleTargets": ["logs"], "confidence": 0.8, "reasoning": "test"}\n```';
      });

      const items: UncertainItem[] = [
        makeItem("dynamic-navigation", "dynamic target"),
      ];

      const result = await enhanceWithClient(items, client);
      expect(result.dynamicNavigations).toHaveLength(1);
      expect(result.dynamicNavigations[0].possibleTargets).toEqual(["logs"]);
    });

    it("handles AI call failure gracefully", async () => {
      const client = createMockClient(async () => {
        throw new Error("API rate limit exceeded");
      });

      const items: UncertainItem[] = [
        makeItem("dynamic-navigation", "test"),
        makeItem("unknown-component", "test"),
      ];

      const result = await enhanceWithClient(items, client);

      // All items should remain unresolved
      expect(result.unresolved).toHaveLength(2);
      expect(result.dynamicNavigations).toHaveLength(0);
      expect(result.inferredElements).toHaveLength(0);
    });

    it("handles malformed AI response gracefully", async () => {
      const client = createMockClient(async () => {
        return "This is not valid JSON at all";
      });

      const items: UncertainItem[] = [
        makeItem("dynamic-navigation", "test"),
      ];

      const result = await enhanceWithClient(items, client);
      expect(result.unresolved).toHaveLength(1);
    });

    it("filters invalid elements from AI response", async () => {
      const client = createMockClient(async () => {
        return JSON.stringify({
          inferredElements: [
            { role: "button", ariaLabel: "Valid" },
            {}, // no identifying fields — should be filtered
            { text: "Also valid" },
          ],
          confidence: 0.5,
          reasoning: "test",
        });
      });

      const items: UncertainItem[] = [
        makeItem("unknown-component", "test component"),
      ];

      const result = await enhanceWithClient(items, client);
      expect(result.inferredElements).toHaveLength(1);
      expect(result.inferredElements[0].inferredElements).toHaveLength(2);
    });

    it("processes mixed item types in one call", async () => {
      const client = createMockClient(async (_system, user) => {
        if (user.includes("dynamic navigation")) {
          return JSON.stringify({
            possibleTargets: ["settings"],
            confidence: 0.8,
            reasoning: "test",
          });
        }
        if (user.includes("React component")) {
          return JSON.stringify({
            inferredElements: [{ role: "form" }],
            confidence: 0.6,
            reasoning: "test",
          });
        }
        if (user.includes("condition expressions")) {
          return JSON.stringify({
            labels: [{ original: "isOpen", improved: "Panel Open" }],
          });
        }
        return "{}";
      });

      const items: UncertainItem[] = [
        makeItem("dynamic-navigation", "dynamic nav"),
        makeItem("unknown-component", "unknown comp"),
        makeItem("complex-condition", "isOpen"),
      ];

      const result = await enhanceWithClient(items, client);

      expect(result.dynamicNavigations).toHaveLength(1);
      expect(result.inferredElements).toHaveLength(1);
      expect(result.improvedLabels).toHaveLength(1);
      // All three types resolved
      expect(result.unresolved).toHaveLength(0);
    });
  });
});
