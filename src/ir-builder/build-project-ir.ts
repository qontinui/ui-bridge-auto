/**
 * Project-level IR build — framework-agnostic.
 *
 * The Vite plugin and the Next.js / standalone CLI path both delegate here.
 * Keeping the project-scan + extract + emit logic in one place ensures the
 * two build paths produce byte-identical output for the same input.
 */

import { readdirSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { Project, type SourceFile } from "ts-morph";

import { extractIRDeclarations, type ExtractedDeclaration } from "./extractor";
import {
  buildIRDocumentWithWarnings,
  serializeIRDocument,
  type IRBuildWarning,
} from "./ir-emitter";
import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for {@link buildProjectIR} / {@link writeProjectIR}. Mirrors the
 * subset of {@link IRBuilderPluginOptions} that has nothing to do with the
 * Vite plugin lifecycle.
 */
export interface BuildProjectIROptions {
  /** Project root directory. Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Glob-like patterns to scan, relative to project root. Default: `["src/**\/*.tsx"]`. */
  include?: string[];
  /** IR document id (page or app-wide). */
  documentId: string;
  /** IR document name. */
  documentName: string;
  /** Optional document description. */
  description?: string;
  /** Optional tsconfig.json path (relative to projectRoot). */
  tsconfigPath?: string;
  /** Plugin/builder version reported in IR provenance. Defaults to `"0.1.0"`. */
  builderVersion?: string;
  /** Optional warning sink. Always also logged to stderr. */
  onWarning?: (warning: IRBuildWarning) => void;
  /**
   * If provided, this Project instance is reused (incremental rebuilds in
   * Vite). Internal callers pass it; CLI / Next.js callers omit it.
   */
  reuseProject?: Project;
  /**
   * Set of file paths already added to `reuseProject`. The build mutates this
   * set to track adds/removes across calls.
   */
  knownPaths?: Set<string>;
}

export interface BuildProjectIRResult {
  document: IRDocument;
  warnings: IRBuildWarning[];
  /** Files actually scanned this run. */
  scannedFiles: string[];
}

export interface WriteProjectIRResult {
  /** Absolute path the IR would be written to. */
  outFile: string;
  /**
   * `true` when the IR document had no states and no transitions, in which
   * case the file is NOT created or overwritten. Callers wanting to surface
   * the skip in their own logs should branch on this.
   */
  skipped: boolean;
  warnings: IRBuildWarning[];
  scannedFiles: string[];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const DEFAULT_BUILDER_VERSION = "0.1.0";

/**
 * Walk the project, extract every `<State>` / `<TransitionTo>` declaration,
 * and produce an `IRDocument`. Pure function — does not write to disk.
 */
export function buildProjectIR(opts: BuildProjectIROptions): BuildProjectIRResult {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const include = opts.include ?? ["src/**/*.tsx"];
  const builderVersion = opts.builderVersion ?? DEFAULT_BUILDER_VERSION;

  const project = opts.reuseProject ?? createProject(projectRoot, opts.tsconfigPath);
  const knownPaths = opts.knownPaths ?? new Set<string>();
  const matched = scanProjectFiles(projectRoot, include);

  // Add new files; remove dropped ones.
  for (const path of matched) {
    if (knownPaths.has(path)) continue;
    if (project.getSourceFile(path)) {
      knownPaths.add(path);
      continue;
    }
    project.addSourceFileAtPathIfExists(path);
    knownPaths.add(path);
  }
  const matchedSet = new Set(matched);
  for (const path of [...knownPaths]) {
    if (!matchedSet.has(path)) {
      const sf = project.getSourceFile(path);
      if (sf) project.removeSourceFile(sf);
      knownPaths.delete(path);
    }
  }

  // Refresh + extract.
  const declarations: ExtractedDeclaration[] = [];
  for (const path of matched) {
    const sf: SourceFile | undefined = project.getSourceFile(path);
    if (!sf) continue;
    sf.refreshFromFileSystemSync();
    declarations.push(...extractIRDeclarations(sf));
  }

  const warnings: IRBuildWarning[] = [];
  const { document } = buildIRDocumentWithWarnings({
    id: opts.documentId,
    name: opts.documentName,
    description: opts.description,
    declarations,
    pluginVersion: builderVersion,
    warnings,
  });

  for (const w of warnings) {
    console.warn(
      `[ui-bridge-ir] ${w.file}:${w.line} (${w.kind}${w.id ? ` "${w.id}"` : ""}) ${w.message}`,
    );
    opts.onWarning?.(w);
  }

  relativizeProvenance(document, projectRoot);

  return { document, warnings, scannedFiles: matched };
}

/**
 * Build the IR for a project and write it to disk. Returns the absolute
 * output path plus a `skipped` flag (`true` when the IR was empty and the
 * file was therefore NOT written).
 */
export function writeProjectIR(
  opts: BuildProjectIROptions & { outFile?: string },
): WriteProjectIRResult {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const outFile = opts.outFile ?? "src/state-machine.derived.json";
  const result = buildProjectIR(opts);
  const outAbsolute = resolveAbsolute(projectRoot, outFile);
  const skipped = !emitIRToFile(result.document, outAbsolute);
  return {
    outFile: outAbsolute,
    skipped,
    warnings: result.warnings,
    scannedFiles: result.scannedFiles,
  };
}

/**
 * Write an IR document to `outAbsolute`, or skip if the document has no
 * states AND no transitions. Returns `true` when the file was written,
 * `false` when emission was skipped because the IR was empty.
 *
 * Skip is intentional: an empty `state-machine.derived.json` is pure noise
 * — it appears in `git status`, requires manual cleanup, and conveys no
 * authoring intent. Letting the previously-existing file remain untouched
 * (when there is one) is also intentional: never destroy a prior real IR
 * with an empty emit; the operator should explicitly remove states from
 * source to get the empty-and-then-deleted path, which would need a
 * different signal.
 *
 * Used by `writeProjectIR` (CLI / Next.js path) and by the Vite + Metro
 * plugins so all three emission paths share identical skip semantics.
 */
export function emitIRToFile(doc: IRDocument, outAbsolute: string): boolean {
  if (doc.states.length === 0 && doc.transitions.length === 0) {
    console.warn(
      `[ui-bridge-ir] skipping emit — IR for "${doc.id}" has no states and no transitions (nothing extracted from sources). ` +
        `Path: ${outAbsolute}`,
    );
    return false;
  }
  mkdirSync(dirname(outAbsolute), { recursive: true });
  writeFileSync(outAbsolute, serializeIRDocument(doc), "utf8");
  return true;
}

// ---------------------------------------------------------------------------
// Internals (re-used by vite-plugin via re-export)
// ---------------------------------------------------------------------------

export function createProject(projectRoot: string, tsconfigPath?: string): Project {
  if (tsconfigPath) {
    return new Project({
      tsConfigFilePath: resolveAbsolute(projectRoot, tsconfigPath),
      skipAddingFilesFromTsConfig: true,
    });
  }
  return new Project({
    useInMemoryFileSystem: false,
    compilerOptions: {
      jsx: 2,
      target: 99,
      allowJs: true,
    },
  });
}

export function scanProjectFiles(projectRoot: string, include: string[]): string[] {
  const found = new Set<string>();
  for (const pattern of include) {
    if (!pattern.includes("*")) {
      const path = resolveAbsolute(projectRoot, pattern);
      if (existsSync(path) && statSync(path).isFile()) {
        found.add(normalize(path));
      }
      continue;
    }

    const m = pattern.match(/^(.*?)(\*\*\/\*\.\w+|\*\.\w+)$/);
    if (!m) continue;
    const baseRel = m[1].replace(/\/$/, "");
    const tail = m[2];
    const baseAbsolute = resolveAbsolute(projectRoot, baseRel);
    const recursive = tail.startsWith("**/");
    const ext = tail.slice(tail.lastIndexOf("."));

    if (!existsSync(baseAbsolute)) continue;
    walkDirectory(baseAbsolute, ext, recursive, found);
  }
  return [...found].sort();
}

function walkDirectory(
  dir: string,
  ext: string,
  recursive: boolean,
  out: Set<string>,
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = `${dir}${sep}${entry.name}`;
    if (entry.isDirectory()) {
      if (!recursive) continue;
      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".")) continue;
      walkDirectory(full, ext, recursive, out);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      out.add(normalize(full));
    }
  }
}

export function resolveAbsolute(projectRoot: string, relative: string): string {
  if (isAbsolute(relative)) return normalize(relative);
  return normalize(resolve(projectRoot, relative));
}

export function normalize(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Rewrite absolute file paths in provenance to project-relative
 * forward-slash paths. Makes IR output portable across machines.
 */
export function relativizeProvenance(
  doc: { states: Array<{ provenance?: { file?: string } }>; transitions: Array<{ provenance?: { file?: string } }> },
  projectRoot: string,
): void {
  const root = normalize(projectRoot).replace(/\/$/, "") + "/";
  const fix = (entry: { provenance?: { file?: string } }) => {
    const file = entry.provenance?.file;
    if (!file) return;
    const norm = normalize(file);
    if (norm.startsWith(root)) {
      entry.provenance!.file = norm.slice(root.length);
    } else {
      entry.provenance!.file = norm;
    }
  };
  for (const s of doc.states) fix(s);
  for (const t of doc.transitions) fix(t);
}
