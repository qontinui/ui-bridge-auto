import { describe, it, expect } from "vitest";
import type { RouteEntry } from "../../static-builder/parsing/route-extractor";
import type { ExtractedElement } from "../../static-builder/extraction/element-extractor";
import type { BranchEnumeration } from "../../static-builder/extraction/branch-enumerator";
import { generateStates } from "../../static-builder/generation/state-generator";

function makeElement(
  query: Record<string, unknown>,
  interactive = false,
): ExtractedElement {
  return { query: query as any, interactive, tagName: "div", line: 1 };
}

function makeRoute(id: string, componentName: string): RouteEntry {
  return {
    caseValues: [id],
    componentNames: [componentName],
    returnSource: "",
    line: 1,
  };
}

describe("generateStates", () => {
  it("generates a state per route with global + page elements", () => {
    const states = generateStates({
      routes: [
        makeRoute("home", "HomePage"),
        makeRoute("settings", "SettingsPage"),
      ],
      routeElements: new Map([
        ["home", [makeElement({ role: "main" })]],
        ["settings", [makeElement({ role: "form" })]],
      ]),
      globalElements: [makeElement({ role: "navigation" })],
      routeBranches: new Map(),
      appBranches: [],
    });

    expect(states.length).toBe(2);

    const home = states.find((s) => s.id === "tab-home");
    expect(home).toBeDefined();
    expect(home!.name).toBe("Home");
    // Should have global nav + page-specific elements
    expect(home!.requiredElements.some((e) => e.role === "navigation")).toBe(
      true,
    );
    expect(home!.requiredElements.some((e) => e.role === "main")).toBe(true);

    const settings = states.find((s) => s.id === "tab-settings");
    expect(settings).toBeDefined();
    expect(settings!.requiredElements.some((e) => e.role === "form")).toBe(
      true,
    );
  });

  it("generates AI-readable names from component names", () => {
    const states = generateStates({
      routes: [makeRoute("active", "ActiveDashboardPage")],
      routeElements: new Map([["active", [makeElement({ role: "main" })]]]),
      globalElements: [],
      routeBranches: new Map(),
      appBranches: [],
    });

    expect(states[0].name).toBe("Active Dashboard");
  });

  it("generates branch variant sub-states", () => {
    const enumeration: BranchEnumeration = {
      unconditionalElements: [],
      branchGroups: [
        {
          line: 10,
          variants: [
            {
              conditionLabel: "isToolkitOpen",
              elements: [makeElement({ role: "complementary" })],
              isDefault: false,
            },
          ],
        },
      ],
    };

    const states = generateStates({
      routes: [makeRoute("active", "ActivePage")],
      routeElements: new Map([["active", [makeElement({ role: "main" })]]]),
      globalElements: [],
      routeBranches: new Map([["active", enumeration]]),
      appBranches: [],
    });

    // Base state + variant state
    expect(states.length).toBe(2);
    const variant = states.find((s) => s.id.includes("--"));
    expect(variant).toBeDefined();
    expect(variant!.id).toBe("tab-active--toolkit-open");
    expect(variant!.name).toContain("Toolkit Open");
    expect(variant!.pathCost).toBe(1.5); // higher than base
  });

  it("generates app-level blocking states", () => {
    const states = generateStates({
      routes: [],
      routeElements: new Map(),
      globalElements: [makeElement({ role: "navigation" })],
      routeBranches: new Map(),
      appBranches: [
        {
          label: "login",
          elements: [makeElement({ id: "login-form" })],
          blocking: true,
        },
      ],
    });

    expect(states.length).toBe(1);
    const login = states[0];
    expect(login.id).toBe("app-login");
    expect(login.name).toBe("Login Screen");
    expect(login.blocking).toBe(true);
    expect(login.excludedElements).toBeDefined();
    expect(login.pathCost).toBe(10.0);
  });

  it("generates alias states for fall-through cases", () => {
    const states = generateStates({
      routes: [
        {
          caseValues: ["settings", "settings-account", "settings-ai"],
          componentNames: ["Settings"],
          returnSource: "",
          line: 1,
        },
      ],
      routeElements: new Map([["settings", [makeElement({ role: "form" })]]]),
      globalElements: [],
      routeBranches: new Map(),
      appBranches: [],
    });

    // Base + 2 aliases
    expect(states.length).toBe(3);
    expect(states.map((s) => s.id).sort()).toEqual([
      "tab-settings",
      "tab-settings-account",
      "tab-settings-ai",
    ]);
  });

  it("assigns group from routeGroups", () => {
    const states = generateStates({
      routes: [makeRoute("logs", "LogsTab")],
      routeElements: new Map([["logs", [makeElement({ role: "log" })]]]),
      globalElements: [],
      routeBranches: new Map(),
      appBranches: [],
      routeGroups: new Map([["logs", "monitoring"]]),
    });

    expect(states[0].group).toBe("monitoring");
  });

  it("caps landmark elements to avoid over-specification", () => {
    // Create many elements
    const elements = Array.from({ length: 20 }, (_, i) =>
      makeElement({ role: `role-${i}` }),
    );

    const states = generateStates({
      routes: [makeRoute("page", "PageComponent")],
      routeElements: new Map([["page", elements]]),
      globalElements: [],
      routeBranches: new Map(),
      appBranches: [],
    });

    // Should not include all 20 — capped at MAX_LANDMARKS (8) + global
    expect(states[0].requiredElements.length).toBeLessThanOrEqual(8);
  });
});
