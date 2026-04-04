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
  it("separates global and route elements into non-overlapping states", () => {
    const navElement = makeElement({ role: "navigation" });
    const states = generateStates({
      routes: [
        makeRoute("home", "HomePage"),
        makeRoute("settings", "SettingsPage"),
      ],
      routeElements: new Map([
        ["home", [navElement, makeElement({ role: "main" })]],
        ["settings", [navElement, makeElement({ role: "form" })]],
      ]),
      routeBranches: new Map(),
      appBranches: [],
    });

    // 3 states: shared nav (all-routes) + home + settings
    expect(states.length).toBe(3);

    // The navigation element appears in both routes → co-occurrence grouper
    // extracts it into its own state (shared or global-layout)
    const navState = states.find(
      (s) =>
        s.requiredElements.some((e) => e.role === "navigation"),
    );
    expect(navState).toBeDefined();
    expect(navState!.requiredElements).toHaveLength(1);

    const home = states.find((s) => s.id === "tab-home");
    expect(home).toBeDefined();
    expect(home!.name).toBe("Home");
    expect(home!.requiredElements.some((e) => e.role === "main")).toBe(true);
    // Navigation element extracted into its own state, not in route state
    expect(home!.requiredElements.some((e) => e.role === "navigation")).toBe(false);

    const settings = states.find((s) => s.id === "tab-settings");
    expect(settings).toBeDefined();
    expect(settings!.requiredElements.some((e) => e.role === "form")).toBe(true);
    expect(settings!.requiredElements.some((e) => e.role === "navigation")).toBe(false);
  });

  it("generates no global state when there are no global elements", () => {
    const states = generateStates({
      routes: [makeRoute("active", "ActiveDashboardPage")],
      routeElements: new Map([["active", [makeElement({ role: "main" })]]]),
      routeBranches: new Map(),
      appBranches: [],
    });

    expect(states.length).toBe(1);
    expect(states[0].id).toBe("tab-active");
    expect(states[0].name).toBe("Active Dashboard");
    expect(states.find((s) => s.id === "global-layout")).toBeUndefined();
  });

  it("generates AI-readable names from component names", () => {
    const states = generateStates({
      routes: [makeRoute("active", "ActiveDashboardPage")],
      routeElements: new Map([["active", [makeElement({ role: "main" })]]]),
      routeBranches: new Map(),
      appBranches: [],
    });

    expect(states[0].name).toBe("Active Dashboard");
  });

  it("generates branch variant sub-states with non-overlapping elements", () => {
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
      routeBranches: new Map([["active", enumeration]]),
      appBranches: [],
    });

    // Base state + variant state
    expect(states.length).toBe(2);
    const variant = states.find((s) => s.id.includes("--"));
    expect(variant).toBeDefined();
    expect(variant!.id).toBe("tab-active--toolkit-open");
    expect(variant!.name).toContain("Toolkit Open");
    expect(variant!.pathCost).toBe(1.5);
    // Variant elements are separate from base state elements
    expect(variant!.requiredElements.some((e) => e.role === "complementary")).toBe(true);
    expect(variant!.requiredElements.some((e) => e.role === "main")).toBe(false);
  });

  it("generates app-level blocking states", () => {
    const states = generateStates({
      routes: [],
      routeElements: new Map(),
      routeBranches: new Map(),
      appBranches: [
        {
          label: "login",
          elements: [makeElement({ id: "login-form" })],
          blocking: true,
        },
      ],
    });

    // Only the app-level state (no routes to generate tab states)
    const login = states.find((s) => s.id === "app-login");
    expect(login).toBeDefined();
    expect(login!.name).toBe("Login Screen");
    expect(login!.blocking).toBe(true);
    expect(login!.pathCost).toBe(10.0);
  });

  it("collapses fall-through cases into the primary state", () => {
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
      routeBranches: new Map(),
      appBranches: [],
    });

    // Only the primary state — aliases are collapsed (same page, same elements)
    expect(states.length).toBe(1);
    expect(states[0].id).toBe("tab-settings");
  });

  it("assigns group from routeGroups", () => {
    const states = generateStates({
      routes: [makeRoute("logs", "LogsTab")],
      routeElements: new Map([["logs", [makeElement({ role: "log" })]]]),
      routeBranches: new Map(),
      appBranches: [],
      routeGroups: new Map([["logs", "monitoring"]]),
    });

    const logsState = states.find((s) => s.id === "tab-logs");
    expect(logsState!.group).toBe("monitoring");
  });

  it("caps landmark elements to avoid over-specification", () => {
    const elements = Array.from({ length: 20 }, (_, i) =>
      makeElement({ role: `role-${i}` }),
    );

    const states = generateStates({
      routes: [makeRoute("page", "PageComponent")],
      routeElements: new Map([["page", elements]]),
      routeBranches: new Map(),
      appBranches: [],
    });

    const pageState = states.find((s) => s.id === "tab-page");
    expect(pageState!.requiredElements.length).toBeLessThanOrEqual(8);
  });

  it("groups shared elements into their own state", () => {
    // Element appears in home AND settings but NOT in terminal
    const sharedElement = makeElement({ role: "aside" });
    const states = generateStates({
      routes: [
        makeRoute("home", "HomePage"),
        makeRoute("settings", "SettingsPage"),
        makeRoute("terminal", "TerminalPage"),
      ],
      routeElements: new Map([
        ["home", [makeElement({ role: "main" }), sharedElement]],
        ["settings", [makeElement({ role: "form" }), sharedElement]],
        ["terminal", [makeElement({ role: "log" })]],
      ]),
      routeBranches: new Map(),
      appBranches: [],
    });

    // 3 route states + 1 shared state
    const shared = states.find((s) => s.id.startsWith("shared-"));
    expect(shared).toBeDefined();
    expect(shared!.requiredElements.some((e) => e.role === "aside")).toBe(true);

    // Route states don't contain the shared element
    const home = states.find((s) => s.id === "tab-home");
    expect(home!.requiredElements.some((e) => e.role === "aside")).toBe(false);
  });

  it("ensures no element appears in more than one state", () => {
    const navElement = makeElement({ role: "navigation" });
    const states = generateStates({
      routes: [
        makeRoute("home", "HomePage"),
        makeRoute("settings", "SettingsPage"),
      ],
      routeElements: new Map([
        ["home", [navElement, makeElement({ role: "main" })]],
        ["settings", [navElement, makeElement({ role: "form" })]],
      ]),
      routeBranches: new Map(),
      appBranches: [],
    });

    // Collect all elements across all states (excluding app states)
    const allElements = states
      .filter((s) => !s.id.startsWith("app-"))
      .flatMap((s) => s.requiredElements.map((e) => JSON.stringify(e)));

    // No duplicates — each element in exactly one state
    const uniqueElements = new Set(allElements);
    expect(allElements.length).toBe(uniqueElements.size);
  });
});
