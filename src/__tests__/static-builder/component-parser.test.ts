import { describe, it, expect } from "vitest";
import { Project } from "ts-morph";
import { parseComponent } from "../../static-builder/parsing/component-parser";

function createSource(filename: string, content: string) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2, strict: true },
  });
  return project.createSourceFile(filename, content);
}

describe("parseComponent", () => {
  it("parses a function component by name", () => {
    const source = createSource(
      "Page.tsx",
      `
      export function Dashboard() {
        return <div role="main">Dashboard</div>;
      }
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("Dashboard");
    expect(parsed!.jsxRoots.length).toBe(1);
  });

  it("parses an arrow function component", () => {
    const source = createSource(
      "Page.tsx",
      `
      export const Dashboard = () => {
        return <div role="main">Dashboard</div>;
      };
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("Dashboard");
    expect(parsed!.jsxRoots.length).toBe(1);
  });

  it("finds default exported component when no name given", () => {
    const source = createSource(
      "Page.tsx",
      `
      export default function MyPage() {
        return <div role="main">Hello</div>;
      }
    `,
    );

    const parsed = parseComponent(source);

    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("MyPage");
  });

  it("extracts hook calls", () => {
    const source = createSource(
      "Page.tsx",
      `
      export function Dashboard() {
        const [open, setOpen] = useState(false);
        const data = useQuery();
        useEffect(() => {}, []);
        return <div>Dashboard</div>;
      }
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed!.hooks.length).toBe(3);
    expect(parsed!.hooks.map((h) => h.name).sort()).toEqual([
      "useEffect",
      "useQuery",
      "useState",
    ]);
  });

  it("extracts prop names from destructured params", () => {
    const source = createSource(
      "Page.tsx",
      `
      export function Dashboard({ activeTab, onNavigate, isOpen }: Props) {
        return <div>{activeTab}</div>;
      }
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed!.propNames).toEqual(
      expect.arrayContaining(["activeTab", "onNavigate", "isOpen"]),
    );
  });

  it("extracts prop names from arrow function params", () => {
    const source = createSource(
      "Page.tsx",
      `
      export const Dashboard = ({ title, count }: { title: string; count: number }) => {
        return <div>{title}: {count}</div>;
      };
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed!.propNames).toEqual(
      expect.arrayContaining(["title", "count"]),
    );
  });

  it("handles multiple return statements", () => {
    const source = createSource(
      "Page.tsx",
      `
      export function Dashboard({ loading }: Props) {
        if (loading) return <div role="status">Loading</div>;
        return <div role="main">Content</div>;
      }
    `,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed!.jsxRoots.length).toBe(2);
  });

  it("returns undefined for non-existent component", () => {
    const source = createSource(
      "Page.tsx",
      `export function Other() { return null; }`,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed).toBeUndefined();
  });

  it("includes file path", () => {
    const source = createSource(
      "Page.tsx",
      `export function Dashboard() { return <div>Hi</div>; }`,
    );

    const parsed = parseComponent(source, "Dashboard");

    expect(parsed!.filePath).toContain("Page.tsx");
  });
});
