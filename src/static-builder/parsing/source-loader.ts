/**
 * Source loader — creates a ts-morph Project from a project's tsconfig
 * and provides access to source files for analysis.
 */

import { Project, type SourceFile } from "ts-morph";
import type { BuilderConfig } from "../config";
import { resolveConfig } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadedProject {
  /** The ts-morph project instance. */
  project: Project;
  /** The route file source. */
  routeFile: SourceFile;
  /** The app shell file source (if configured). */
  appShellFile: SourceFile | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Join path segments with forward slashes.
 * Handles trailing/leading slash dedup without requiring Node's path module.
 */
function joinPath(base: string, relative: string): string {
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedRelative = relative.replace(/\\/g, "/").replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load a TypeScript project and resolve the key source files.
 *
 * Uses the project's tsconfig.json for module resolution, path aliases,
 * and compiler options. The route file and optional app shell file are
 * loaded and ready for AST analysis.
 */
export function loadProject(config: BuilderConfig): LoadedProject {
  const resolved = resolveConfig(config);
  const tsconfigPath = joinPath(config.projectRoot, resolved.tsconfigPath);

  const project = new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: true,
  });

  const routeFilePath = joinPath(config.projectRoot, config.routeFile);
  const routeFile = project.addSourceFileAtPath(routeFilePath);

  let appShellFile: SourceFile | undefined;
  if (config.appShellFile) {
    const appShellPath = joinPath(config.projectRoot, config.appShellFile);
    appShellFile = project.addSourceFileAtPath(appShellPath);
  }

  return { project, routeFile, appShellFile };
}
