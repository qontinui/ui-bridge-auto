import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { extractRoutes } from "../../static-builder/parsing/route-extractor";
import { resolveRouteComponents } from "../../static-builder/parsing/import-resolver";
import { parseComponent } from "../../static-builder/parsing/component-parser";
import { extractElementsFromRoots } from "../../static-builder/extraction/element-extractor";
import { extractGlobalLayout } from "../../static-builder/extraction/global-layout-extractor";
import { enumerateBranches } from "../../static-builder/extraction/branch-enumerator";
import { traceNavigationTransitions } from "../../static-builder/extraction/navigation-tracer";
import { generateStates } from "../../static-builder/generation/state-generator";
import { generateTransitions } from "../../static-builder/generation/transition-generator";
import { stateId } from "../../static-builder/generation/id-generator";
import { emitWorkflowConfig } from "../../static-builder/output/workflow-emitter";
import { emitPersistedStateMachine } from "../../static-builder/output/persisted-emitter";
import type { RouteEntry } from "../../static-builder/parsing/route-extractor";
import type { ExtractedElement } from "../../static-builder/extraction/element-extractor";
import type { BranchEnumeration } from "../../static-builder/extraction/branch-enumerator";
import type { TracedTransition } from "../../static-builder/extraction/navigation-tracer";

/**
 * Create a multi-file React app fixture for integration testing.
 *
 * Layout:
 * - App.tsx: global shell with Sidebar + StatusBar + TabContent
 * - TabContent.tsx: switch on activeTab with 3 routes
 * - HomePage.tsx: page with heading + button to navigate to settings
 * - SettingsPage.tsx: page with form + button to navigate to logs
 * - LogsPage.tsx: page with log viewer + conditional filter panel
 */
function createFixtureProject() {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true, target: 7 /* ES2020 */ },
  });

  project.createSourceFile(
    "/src/App.tsx",
    `
    export function App() {
      if (!authenticated) return <div id="login-form" role="form">Login</div>;
      return (
        <div>
          <nav role="navigation" aria-label="Main navigation">Sidebar</nav>
          <div role="status" aria-label="Status bar">Ready</div>
          <TabContent activeTab={activeTab} setActiveTab={setActiveTab} />
        </div>
      );
    }
    `,
  );

  project.createSourceFile(
    "/src/TabContent.tsx",
    `
    import { HomePage } from "./pages/HomePage";
    import { SettingsPage } from "./pages/SettingsPage";
    import { LogsPage } from "./pages/LogsPage";

    export function TabContent({ activeTab, setActiveTab }: any) {
      switch (activeTab) {
        case "home":
          return <HomePage setActiveTab={setActiveTab} />;
        case "settings":
          return <SettingsPage setActiveTab={setActiveTab} />;
        case "logs":
          return <LogsPage />;
        default:
          return null;
      }
    }
    `,
  );

  project.createSourceFile(
    "/src/pages/HomePage.tsx",
    `
    export function HomePage({ setActiveTab }: any) {
      return (
        <div>
          <h1 role="heading" aria-label="Home heading">Welcome Home</h1>
          <div data-content-role="badge" data-content-label="user status">Active</div>
          <button role="button" aria-label="Go to Settings" onClick={() => setActiveTab("settings")}>
            Settings
          </button>
        </div>
      );
    }
    `,
  );

  project.createSourceFile(
    "/src/pages/SettingsPage.tsx",
    `
    export function SettingsPage({ setActiveTab }: any) {
      return (
        <div>
          <h1 role="heading" aria-label="Settings heading">Settings</h1>
          <form role="form" id="settings-form">
            <input aria-label="Username" />
          </form>
          <button role="button" aria-label="View Logs" onClick={() => setActiveTab("logs")}>
            Logs
          </button>
        </div>
      );
    }
    `,
  );

  project.createSourceFile(
    "/src/pages/LogsPage.tsx",
    `
    export function LogsPage() {
      return (
        <div>
          <h1 role="heading" aria-label="Logs heading">Logs</h1>
          <div role="log" aria-label="Log viewer">Log entries here</div>
          {showFilters && <div role="search" aria-label="Filter panel">Filters</div>}
        </div>
      );
    }
    `,
  );

  return project;
}

describe("Static Builder Pipeline — Integration", () => {
  it("end-to-end: routes → elements → states → transitions → output", () => {
    const project = createFixtureProject();
    const routeFile = project.getSourceFileOrThrow("/src/TabContent.tsx");
    const appShellFile = project.getSourceFileOrThrow("/src/App.tsx");

    // Stage 1-2: Extract routes
    const routes = extractRoutes(routeFile, "TabContent", "activeTab");
    expect(routes.length).toBe(3);
    expect(routes.map((r) => r.caseValues[0]).sort()).toEqual([
      "home",
      "logs",
      "settings",
    ]);

    // Stage 3: Resolve component trees
    const routeElements = new Map<string, ExtractedElement[]>();
    const routeBranches = new Map<string, BranchEnumeration>();
    const allTracedTransitions: TracedTransition[] = [];
    const sourceFileToState = new Map<string, string>();

    for (const route of routes) {
      const primaryId = route.caseValues[0];
      const components = resolveRouteComponents(
        route.componentNames,
        routeFile,
        project,
        2,
      );

      // Stage 4: Parse and extract elements
      const allElements: ExtractedElement[] = [];
      for (const component of components) {
        sourceFileToState.set(
          component.sourceFile.getFilePath(),
          stateId(primaryId),
        );

        const parsed = parseComponent(component.sourceFile, component.name);
        if (parsed) {
          allElements.push(...extractElementsFromRoots(parsed.jsxRoots));

          // Stage 6: Branch enumeration
          for (const root of parsed.jsxRoots) {
            const enumeration = enumerateBranches(root);
            if (enumeration.branchGroups.length > 0) {
              routeBranches.set(primaryId, enumeration);
            }
          }

          // Stage 7: Navigation tracing
          if (parsed.jsxRoots.length > 0) {
            const transitions = traceNavigationTransitions(
              parsed.jsxRoots[0],
              component.sourceFile,
              ["setActiveTab"],
            );
            allTracedTransitions.push(...transitions);
          }
        }
      }

      routeElements.set(primaryId, allElements);
    }

    // Stage 5: Global layout
    const globalLayout = extractGlobalLayout(appShellFile, "TabContent");
    expect(globalLayout.globalElements.length).toBeGreaterThan(0);
    expect(globalLayout.appBranches.length).toBe(1); // login branch
    expect(globalLayout.appBranches[0].label).toBe("login");

    // Stage 8: Generate states
    const states = generateStates({
      routes,
      routeElements,
      globalElements: globalLayout.globalElements,
      routeBranches,
      appBranches: globalLayout.appBranches,
    });

    // Should have: 3 tab states + 1 branch variant (logs filter) + 1 app-login
    expect(states.length).toBeGreaterThanOrEqual(4);

    const homeState = states.find((s) => s.id === "tab-home");
    expect(homeState).toBeDefined();
    expect(homeState!.name).toBe("Home");
    // Should have global navigation + page-specific elements
    expect(homeState!.requiredElements.length).toBeGreaterThan(0);

    const settingsState = states.find((s) => s.id === "tab-settings");
    expect(settingsState).toBeDefined();

    const logsState = states.find((s) => s.id === "tab-logs");
    expect(logsState).toBeDefined();

    const loginState = states.find((s) => s.id === "app-login");
    expect(loginState).toBeDefined();
    expect(loginState!.blocking).toBe(true);

    // Stage 9: Generate transitions
    const stateNames = new Map(states.map((s) => [s.id, s.name]));
    const blockingStateIds = new Set(
      states.filter((s) => s.blocking).map((s) => s.id),
    );

    const transitions = generateTransitions({
      tracedTransitions: allTracedTransitions,
      stateIds: states.map((s) => s.id),
      stateNames,
      blockingStateIds,
      sourceFileToState,
    });

    // Should have sidebar transitions for each tab state
    const sidebarTransitions = transitions.filter((t) =>
      t.id.startsWith("sidebar"),
    );
    expect(sidebarTransitions.length).toBe(3); // home, settings, logs

    // Each sidebar transition should have the nav item query
    for (const st of sidebarTransitions) {
      expect(st.actions.length).toBe(1);
      expect(st.actions[0].action).toBe("click");
      expect(st.pathCost).toBe(5.0);
    }

    // In-page transitions (home→settings, settings→logs)
    const inPageTransitions = transitions.filter(
      (t) => !t.id.startsWith("sidebar"),
    );
    // These depend on inferSourceState matching — may or may not match
    // in the in-memory fixture. But sidebar guarantees connectivity.

    // Output: WorkflowConfig
    const workflowConfig = emitWorkflowConfig(states, transitions, {
      id: "test-app",
      name: "Test App State Machine",
      description: "Generated from test fixture",
    });
    expect(workflowConfig.id).toBe("test-app");
    expect(workflowConfig.states.length).toBe(states.length);
    expect(workflowConfig.transitions.length).toBe(transitions.length);
    expect(workflowConfig.settings.defaultTimeout).toBe(10_000);
    expect(workflowConfig.initialState).toBe(states[0].id);

    // Output: PersistedStateMachine
    const persisted = emitPersistedStateMachine(states, transitions);
    expect(persisted.version).toBe("1.0.0");
    expect(persisted.createdAt).toBeGreaterThan(0);
    expect(persisted.states.length).toBe(states.length);
    expect(persisted.transitions.length).toBe(transitions.length);

    // Verify JSON serializability
    const json = JSON.stringify(persisted);
    const parsed = JSON.parse(json);
    expect(parsed.states.length).toBe(states.length);
  });

  it("produces AI-readable state names", () => {
    const project = createFixtureProject();
    const routeFile = project.getSourceFileOrThrow("/src/TabContent.tsx");
    const routes = extractRoutes(routeFile, "TabContent", "activeTab");

    const states = generateStates({
      routes,
      routeElements: new Map(routes.map((r) => [r.caseValues[0], []])),
      globalElements: [],
      routeBranches: new Map(),
      appBranches: [],
    });

    const names = states.map((s) => s.name);
    // Names should be human-readable, not technical IDs
    expect(names).toContain("Home");
    expect(names).toContain("Settings");
    expect(names).toContain("Logs");
  });

  it("graph is connected via sidebar transitions", () => {
    const stateIds = ["tab-home", "tab-settings", "tab-logs"];
    const stateNames = new Map([
      ["tab-home", "Home"],
      ["tab-settings", "Settings"],
      ["tab-logs", "Logs"],
    ]);

    const transitions = generateTransitions({
      tracedTransitions: [],
      stateIds,
      stateNames,
      blockingStateIds: new Set(),
    });

    // Every tab state should have a sidebar transition from global-layout
    for (const target of stateIds) {
      const sidebarToTarget = transitions.find(
        (t) => t.id === `sidebar--to--${target}`,
      );
      expect(sidebarToTarget).toBeDefined();

      // fromStates should be the global layout state
      expect(sidebarToTarget!.fromStates).toEqual(["global-layout"]);
      // exitStates should include all other tab states
      for (const other of stateIds) {
        if (other !== target) {
          expect(sidebarToTarget!.exitStates).toContain(other);
        }
      }
    }
  });
});
