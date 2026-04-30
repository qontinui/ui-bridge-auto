/**
 * Vite plugin — wires the IR extractor + emitter into the build / watch
 * lifecycle. The plugin runs at Node level (not inside the SWC transform),
 * matches `<State>` / `<TransitionTo>` declarations across the project, and
 * writes a deterministic IR JSON file.
 *
 * The plugin owns a long-lived ts-morph `Project` so hot-update rebuilds are
 * incremental — only the changed file is re-added to the project; the rest
 * stay cached.
 *
 * Decisions respected:
 * - Vite type imports are kept structural (see {@link VitePluginLike}) so
 *   ui-bridge-auto does not gain a runtime dep on Vite.
 * - All extraction goes through ts-morph (decision #3, locked).
 * - Output is deterministic — no timestamps, sorted keys, byte-stable.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Project } from "ts-morph";

import {
  buildProjectIR,
  createProject,
  resolveAbsolute,
} from "./build-project-ir";
import { serializeIRDocument } from "./ir-emitter";
import type { IRBuildWarning } from "./ir-emitter";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Options for {@link uiBridgeIRPlugin}. */
export interface IRBuilderPluginOptions {
  /** Glob-like patterns to scan, relative to project root. Default: src globs for tsx files. */
  include?: string[];
  /** Output IR file path, relative to project root. Default: `"src/state-machine.derived.json"`. */
  outFile?: string;
  /** IR document id (page or app-wide). */
  documentId: string;
  /** IR document name. */
  documentName: string;
  /** Optional document description. */
  description?: string;
  /**
   * Project root directory. Defaults to `process.cwd()`. Provided primarily
   * for tests; in production Vite consumers can omit this.
   */
  projectRoot?: string;
  /**
   * Optional tsconfig.json path (relative to projectRoot). When set, the
   * project is loaded with module resolution / path aliases from tsconfig.
   * When omitted, files are loaded with default ts-morph compiler options.
   */
  tsconfigPath?: string;
  /**
   * Plugin version reported in IR provenance. Defaults to ui-bridge-auto's
   * package version.
   */
  pluginVersion?: string;
  /**
   * If set, build warnings are forwarded here in addition to being logged
   * to stderr. Useful in tests.
   */
  onWarning?: (warning: IRBuildWarning) => void;
  /**
   * Hot-update debounce in ms. Default 50. Set to 0 to disable.
   */
  debounceMs?: number;
}

/**
 * Structural Vite plugin shape — kept in-house so ui-bridge-auto does not
 * pull `vite` as a dependency. Vite's `Plugin` type is structurally
 * compatible: a `name` plus optional `buildStart`, `handleHotUpdate`, and
 * `closeBundle` is enough.
 */
export interface VitePluginLike {
  name: string;
  buildStart?: () => void | Promise<void>;
  handleHotUpdate?: (ctx: { file: string }) => void | Promise<void>;
  closeBundle?: () => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

/**
 * Create a Vite plugin that emits an IR JSON file describing every `<State>`
 * and `<TransitionTo>` declaration in the project.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from 'vite';
 * import { uiBridgeIRPlugin } from '@qontinui/ui-bridge-auto';
 *
 * export default defineConfig({
 *   plugins: [
 *     uiBridgeIRPlugin({
 *       documentId: 'app',
 *       documentName: 'App State Machine',
 *     }),
 *   ],
 * });
 * ```
 */
export function uiBridgeIRPlugin(opts: IRBuilderPluginOptions): VitePluginLike {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const outFile = opts.outFile ?? "src/state-machine.derived.json";
  const debounceMs = opts.debounceMs ?? 50;

  // Long-lived project — re-used across hot updates.
  let project: Project | undefined;
  const knownPaths = new Set<string>();
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const ensureProject = (): Project => {
    if (project) return project;
    project = createProject(projectRoot, opts.tsconfigPath);
    return project;
  };

  const emit = (): void => {
    try {
      const proj = ensureProject();
      const result = buildProjectIR({
        ...opts,
        projectRoot,
        reuseProject: proj,
        knownPaths,
        builderVersion: opts.pluginVersion,
      });
      const outAbsolute = resolveAbsolute(projectRoot, outFile);
      mkdirSync(dirname(outAbsolute), { recursive: true });
      writeFileSync(outAbsolute, serializeIRDocument(result.document), "utf8");
    } catch (err) {
      console.error(
        `[ui-bridge-ir] IR build failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  };

  const scheduleEmit = (): void => {
    if (debounceMs <= 0) {
      emit();
      return;
    }
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      try {
        emit();
      } catch {
        // Already logged.
      }
    }, debounceMs);
  };

  return {
    name: "ui-bridge-ir-builder",
    async buildStart(): Promise<void> {
      emit();
    },
    async handleHotUpdate(ctx: { file: string }): Promise<void> {
      if (!ctx.file || !ctx.file.endsWith(".tsx")) return;
      const proj = ensureProject();
      const sf = proj.getSourceFile(ctx.file);
      if (sf) {
        try {
          sf.refreshFromFileSystemSync();
        } catch {
          // File may have been removed — emit() will reconcile.
        }
      }
      scheduleEmit();
    },
    async closeBundle(): Promise<void> {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
        emit();
      }
    },
  };
}
