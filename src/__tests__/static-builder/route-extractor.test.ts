import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { extractRoutes } from "../../static-builder/parsing/route-extractor";

/** Helper: create an in-memory project with a single source file. */
function createSource(filename: string, content: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2 /* JsxEmit.React */, strict: true },
  });
  return project.createSourceFile(filename, content);
}

describe("extractRoutes", () => {
  it("extracts simple switch cases", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "home":
            return <HomePage />;
          case "settings":
            return <SettingsPage />;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(2);
    expect(routes[0].caseValues).toEqual(["home"]);
    expect(routes[0].componentNames).toEqual(["HomePage"]);
    expect(routes[1].caseValues).toEqual(["settings"]);
    expect(routes[1].componentNames).toEqual(["SettingsPage"]);
  });

  it("handles fall-through cases", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "settings":
          case "settings-account":
          case "settings-ai":
            return <Settings />;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual([
      "settings",
      "settings-account",
      "settings-ai",
    ]);
    expect(routes[0].componentNames).toEqual(["Settings"]);
  });

  it("extracts fragment children as multiple components", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "dashboard":
            return (
              <>
                <PageRegistration id="dashboard" name="Dashboard" />
                <DashboardPage />
              </>
            );
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["dashboard"]);
    expect(routes[0].componentNames).toEqual([
      "PageRegistration",
      "DashboardPage",
    ]);
  });

  it("skips null and undefined returns", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "home":
            return <HomePage />;
          case "terminal":
            return null;
          case "empty":
            return undefined;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["home"]);
  });

  it("handles block-scoped returns", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "complex": {
            const extra = true;
            return <ComplexPage />;
          }
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["complex"]);
    expect(routes[0].componentNames).toEqual(["ComplexPage"]);
  });

  it("handles arrow function components", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      const TabContent = ({ activeTab }: { activeTab: string }) => {
        switch (activeTab) {
          case "home":
            return <HomePage />;
          default:
            return null;
        }
      };
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["home"]);
    expect(routes[0].componentNames).toEqual(["HomePage"]);
  });

  it("handles property access discriminant (props.activeTab)", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent(props: { activeTab: string }) {
        switch (props.activeTab) {
          case "home":
            return <HomePage />;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["home"]);
  });

  it("handles wrapped JSX elements", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "recap":
            return (
              <RunPageLayout>
                <RunRecapTab />
              </RunPageLayout>
            );
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(1);
    expect(routes[0].caseValues).toEqual(["recap"]);
    expect(routes[0].componentNames).toEqual(["RunPageLayout"]);
  });

  it("throws if function not found", () => {
    const source = createSource(
      "TabContent.tsx",
      `function Other() { return null; }`,
    );

    expect(() => extractRoutes(source, "TabContent", "activeTab")).toThrow(
      'Function "TabContent" not found',
    );
  });

  it("throws if switch not found", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        return <div>{activeTab}</div>;
      }
    `,
    );

    expect(() => extractRoutes(source, "TabContent", "activeTab")).toThrow(
      'No switch statement on "activeTab"',
    );
  });

  it("handles many cases (like the real runner)", () => {
    const cases = Array.from({ length: 50 }, (_, i) => {
      const name = `page-${i}`;
      const component = `Page${i}`;
      return `case "${name}": return <${component} />;`;
    }).join("\n          ");

    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          ${cases}
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(50);
    expect(routes[0].caseValues).toEqual(["page-0"]);
    expect(routes[0].componentNames).toEqual(["Page0"]);
    expect(routes[49].caseValues).toEqual(["page-49"]);
    expect(routes[49].componentNames).toEqual(["Page49"]);
  });

  it("preserves return source text", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "home":
            return <HomePage title="Welcome" />;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes[0].returnSource).toContain("HomePage");
    expect(routes[0].returnSource).toContain('title="Welcome"');
  });

  it("reports line numbers", () => {
    const source = createSource(
      "TabContent.tsx",
      `
function TabContent({ activeTab }: { activeTab: string }) {
  switch (activeTab) {
    case "home":
      return <HomePage />;
    case "settings":
      return <SettingsPage />;
    default:
      return null;
  }
}
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes[0].line).toBeGreaterThan(0);
    expect(routes[1].line).toBeGreaterThan(routes[0].line);
  });

  it("handles mixed fall-through and regular cases", () => {
    const source = createSource(
      "TabContent.tsx",
      `
      function TabContent({ activeTab }: { activeTab: string }) {
        switch (activeTab) {
          case "home":
            return <HomePage />;
          case "runs":
          case "history":
            return <HistoryTab />;
          case "settings":
            return <SettingsPage />;
          default:
            return null;
        }
      }
    `,
    );

    const routes = extractRoutes(source, "TabContent", "activeTab");

    expect(routes).toHaveLength(3);
    expect(routes[0].caseValues).toEqual(["home"]);
    expect(routes[1].caseValues).toEqual(["runs", "history"]);
    expect(routes[1].componentNames).toEqual(["HistoryTab"]);
    expect(routes[2].caseValues).toEqual(["settings"]);
  });
});
