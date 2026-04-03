/**
 * Import resolver — follows component imports recursively to build
 * the full component tree for a route.
 *
 * Handles:
 * - Named imports: `import { Foo } from "./Foo"`
 * - Default imports: `import Foo from "./Foo"`
 * - Lazy imports: `const Foo = lazy(() => import("./Foo"))`
 * - Re-exports and barrel files
 * - Path aliases resolved by ts-morph via tsconfig paths
 */

import {
  type SourceFile,
  type Project,
  SyntaxKind,
  type ImportDeclaration,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved component with its source file and export name. */
export interface ResolvedComponent {
  /** The component name as used in JSX. */
  name: string;
  /** The source file containing the component definition. */
  sourceFile: SourceFile;
  /** Child components referenced in this component's JSX (resolved recursively). */
  children: ResolvedComponent[];
  /** Depth in the component tree (0 = route-level). */
  depth: number;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a component name to its source file and recursively resolve
 * child components up to maxDepth.
 *
 * @param componentName - The component name (e.g., "ActiveDashboardPage").
 * @param sourceFile - The file where the component is imported/used.
 * @param project - The ts-morph project for module resolution.
 * @param maxDepth - Maximum recursion depth.
 * @param currentDepth - Current recursion depth (internal).
 * @param visited - Set of visited file paths to prevent cycles (internal).
 */
export function resolveComponent(
  componentName: string,
  sourceFile: SourceFile,
  project: Project,
  maxDepth: number,
  currentDepth: number = 0,
  visited: Set<string> = new Set(),
): ResolvedComponent | undefined {
  if (currentDepth > maxDepth) return undefined;

  // Find the import for this component
  const resolvedFile = resolveImport(componentName, sourceFile, project);
  if (!resolvedFile) return undefined;

  const filePath = resolvedFile.getFilePath();
  if (visited.has(filePath)) return undefined; // cycle prevention
  visited.add(filePath);

  // Find child component references in the resolved file's JSX
  const children: ResolvedComponent[] = [];
  if (currentDepth < maxDepth) {
    const childNames = extractChildComponentNames(resolvedFile);
    for (const childName of childNames) {
      const child = resolveComponent(
        childName,
        resolvedFile,
        project,
        maxDepth,
        currentDepth + 1,
        visited,
      );
      if (child) children.push(child);
    }
  }

  return {
    name: componentName,
    sourceFile: resolvedFile,
    children,
    depth: currentDepth,
  };
}

/**
 * Resolve all components from a route entry's component names.
 */
export function resolveRouteComponents(
  componentNames: string[],
  sourceFile: SourceFile,
  project: Project,
  maxDepth: number,
): ResolvedComponent[] {
  const visited = new Set<string>();
  const result: ResolvedComponent[] = [];

  for (const name of componentNames) {
    const resolved = resolveComponent(
      name,
      sourceFile,
      project,
      maxDepth,
      0,
      visited,
    );
    if (resolved) result.push(resolved);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Resolve an import to its source file.
 * Handles regular imports and lazy() dynamic imports.
 */
function resolveImport(
  componentName: string,
  sourceFile: SourceFile,
  project: Project,
): SourceFile | undefined {
  // Try regular import declarations first
  const resolved = resolveRegularImport(componentName, sourceFile);
  if (resolved) return resolved;

  // Try lazy() dynamic import
  return resolveLazyImport(componentName, sourceFile, project);
}

/**
 * Resolve a regular import (named or default).
 */
function resolveRegularImport(
  componentName: string,
  sourceFile: SourceFile,
): SourceFile | undefined {
  const imports = sourceFile.getImportDeclarations();

  for (const imp of imports) {
    if (importsName(imp, componentName)) {
      return resolveImportDeclaration(imp);
    }
  }

  return undefined;
}

/**
 * Check if an import declaration imports a specific name.
 */
function importsName(imp: ImportDeclaration, name: string): boolean {
  // Default import: import Foo from "..."
  const defaultImport = imp.getDefaultImport();
  if (defaultImport && defaultImport.getText() === name) return true;

  // Named imports: import { Foo } from "..." or import { Bar as Foo } from "..."
  const namedImports = imp.getNamedImports();
  for (const named of namedImports) {
    const alias = named.getAliasNode();
    if (alias && alias.getText() === name) return true;
    if (!alias && named.getName() === name) return true;
  }

  return false;
}

/**
 * Resolve an import declaration to its target source file.
 */
function resolveImportDeclaration(
  imp: ImportDeclaration,
): SourceFile | undefined {
  try {
    const moduleSpecifier = imp.getModuleSpecifierSourceFile();
    return moduleSpecifier ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a lazy() dynamic import.
 *
 * Handles common patterns:
 * - `lazy(() => import("./Foo"))`
 * - `lazy(() => import("./Foo").then(m => ({ default: m.Foo })))`
 * - `lazy(() => import("@/components/Foo"))`
 */
function resolveLazyImport(
  componentName: string,
  sourceFile: SourceFile,
  project: Project,
): SourceFile | undefined {
  const varDecl = sourceFile.getVariableDeclaration(componentName);
  if (!varDecl) return undefined;

  const initializer = varDecl.getInitializer();
  if (!initializer) return undefined;

  // Look for a call to lazy() or React.lazy()
  if (initializer.getKind() !== SyntaxKind.CallExpression) return undefined;

  const callText = initializer.getText();
  if (!callText.includes("lazy")) return undefined;

  // Extract the module specifier string from the dynamic import() call.
  // Handles both `import("path")` and `import("path").then(...)`.
  const moduleSpecifier = extractDynamicImportPath(initializer);
  if (!moduleSpecifier) return undefined;

  return resolveModulePath(moduleSpecifier, sourceFile, project);
}

/**
 * Extract the module path string from a dynamic import expression.
 * Searches for `import("...")` inside the expression tree.
 */
function extractDynamicImportPath(node: {
  getDescendantsOfKind: (kind: any) => any[];
}): string | undefined {
  // Find all call expressions and look for import()
  const calls = node.getDescendantsOfKind(SyntaxKind.CallExpression);

  for (const call of calls) {
    const expr = call.getExpression();
    if (expr.getKind() === SyntaxKind.ImportKeyword) {
      const args = call.getArguments();
      if (args.length > 0) {
        const argText = args[0].getText();
        // Strip quotes from string literal
        if (/^['"]/.test(argText)) {
          return argText.slice(1, -1);
        }
      }
    }
  }

  return undefined;
}

/**
 * Resolve a module path string to a source file.
 *
 * Uses two strategies:
 * 1. TypeScript's module resolution via a temporary import (handles path aliases,
 *    baseUrl, paths config in tsconfig.json)
 * 2. Manual path construction as fallback (handles relative paths when TS
 *    resolution isn't available)
 */
function resolveModulePath(
  modulePath: string,
  fromFile: SourceFile,
  project: Project,
): SourceFile | undefined {
  // Strategy 1: Use TypeScript module resolution via the compiler.
  // Create a temporary import and let ts-morph resolve it using the project's tsconfig.
  const resolved = resolveViaCompiler(modulePath, fromFile, project);
  if (resolved) return resolved;

  // Strategy 2: Manual path resolution as fallback
  return resolveManually(modulePath, fromFile, project);
}

/**
 * Resolve using the TypeScript compiler's module resolution.
 * This handles path aliases (@/..., ~/...), baseUrl, and paths from tsconfig.
 *
 * Uses a temporary scratch file (not the original) to avoid invalidating
 * existing AST nodes.
 */
function resolveViaCompiler(
  modulePath: string,
  fromFile: SourceFile,
  project: Project,
): SourceFile | undefined {
  // Create a temporary file in the same directory to inherit the same
  // module resolution context (same relative path base, same tsconfig paths)
  const dir = fromFile.getDirectoryPath();
  const tempPath = `${dir}/__resolve_temp_${Date.now()}.ts`;

  try {
    const tempFile = project.createSourceFile(
      tempPath,
      `import __temp from "${modulePath}";`,
    );

    const tempImport = tempFile.getImportDeclarations()[0];
    const resolved = tempImport?.getModuleSpecifierSourceFile() ?? undefined;

    // Clean up temp file
    tempFile.delete();

    if (resolved) {
      return resolved;
    }
  } catch {
    // Clean up on error
    try {
      const tempFile = project.getSourceFile(tempPath);
      tempFile?.delete();
    } catch {
      // Ignore cleanup errors
    }
  }

  return undefined;
}

/**
 * Manual path resolution fallback.
 * Tries common file extensions relative to the importing file's directory.
 */
function resolveManually(
  modulePath: string,
  fromFile: SourceFile,
  project: Project,
): SourceFile | undefined {
  // Only works for relative paths
  if (!modulePath.startsWith(".")) return undefined;

  const extensions = [
    "",
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    "/index.tsx",
    "/index.ts",
  ];
  const dir = fromFile.getDirectoryPath();

  for (const ext of extensions) {
    const fullPath = `${dir}/${modulePath}${ext}`.replace(/\\/g, "/");
    const existing = project.getSourceFile(fullPath);
    if (existing) return existing;

    try {
      return project.addSourceFileAtPath(fullPath);
    } catch {
      // File doesn't exist, try next extension
    }
  }

  return undefined;
}

/**
 * Extract component names referenced in a file's JSX return statements.
 * Only finds top-level component references (PascalCase tags).
 */
function extractChildComponentNames(sourceFile: SourceFile): string[] {
  const names = new Set<string>();

  // Find JSX self-closing elements: <Component />
  const selfClosing = sourceFile.getDescendantsOfKind(
    SyntaxKind.JsxSelfClosingElement,
  );
  for (const el of selfClosing) {
    const tagName = el.getTagNameNode().getText();
    if (isComponentName(tagName)) names.add(tagName);
  }

  // Find JSX opening elements: <Component>...</Component>
  const opening = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement);
  for (const el of opening) {
    const tagName = el.getTagNameNode().getText();
    if (isComponentName(tagName)) names.add(tagName);
  }

  // Filter out the component itself (avoid self-references)
  // and common non-component names
  const exported = getExportedFunctionNames(sourceFile);
  for (const name of exported) {
    names.delete(name);
  }

  return Array.from(names);
}

/** Check if a tag name is a React component (PascalCase). */
function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) && !name.includes(".");
}

/** Get exported function/component names from a source file. */
function getExportedFunctionNames(sourceFile: SourceFile): string[] {
  const names: string[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name && fn.isExported()) names.push(name);
  }

  for (const varStmt of sourceFile.getVariableStatements()) {
    if (varStmt.isExported()) {
      for (const decl of varStmt.getDeclarations()) {
        names.push(decl.getName());
      }
    }
  }

  return names;
}
