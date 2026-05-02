/**
 * Metro plugin / prebuild path — wires the IR extractor + emitter into
 * Metro's lifecycle so React Native (Expo) projects get the same byte-stable
 * IR emission as the Vite plugin.
 *
 * Per Section 4 (UI Bridge Redesign): Metro's transformer API is per-file
 * and Babel-centric — wrong shape for project-wide IR emission. Instead, we
 * expose a `withUIBridgeIR(metroConfig, opts)` function that:
 *
 *   1. Triggers an initial emit synchronously when called from
 *      `metro.config.js` (so `npm run start` or `expo start` always sees
 *      fresh IR before bundling begins).
 *   2. Sets up a Node `fs.watch` (recursive) on the include directories.
 *      On change, the plugin debounces and re-emits — same long-lived
 *      ts-morph Project as the Vite plugin's incremental path.
 *   3. Returns the Metro config unchanged. We don't touch transformer or
 *      resolver — IR emission is a side effect attached to the config
 *      lifecycle, not a build step.
 *
 * Decisions respected:
 * - Composes with `buildProjectIR` — the plugin does NOT re-implement the
 *   ts-morph traversal. Same source as Vite plugin and CLI.
 * - Pure Node — no chokidar or babel-plugin authoring. `fs.watch` is enough
 *   for the spike; if we ever need cross-platform reliability we can swap
 *   it for chokidar later without changing the public contract.
 * - Metro config types are kept structural (see {@link MetroConfigLike}) so
 *   ui-bridge-auto does not gain a runtime dep on `metro` or `expo`.
 *
 * @example
 * ```js
 * // metro.config.js
 * const { getDefaultConfig } = require('expo/metro-config');
 * const { withUIBridgeIR } = require('@qontinui/ui-bridge-auto/dist/ir-builder/metro-plugin.cjs');
 *
 * const config = getDefaultConfig(__dirname);
 * module.exports = withUIBridgeIR(config, {
 *   documentId: 'section4-spike',
 *   documentName: 'Section 4 Spike',
 *   include: ['app/(tabs)/settings.tsx'],
 *   outFile: 'specs/pages/section4-spike/state-machine.derived.json',
 * });
 * ```
 */

import { mkdirSync, writeFileSync, watch as fsWatch, type FSWatcher, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { Project } from "ts-morph";

import {
  buildProjectIR,
  createProject,
  resolveAbsolute,
  normalize,
} from "./build-project-ir";
import { serializeIRDocument } from "./ir-emitter";
import type { IRBuildWarning } from "./ir-emitter";
import type { IRBuilderPluginOptions } from "./vite-plugin";

// Re-export so consumers get a single import point for both the Vite and
// Metro plugins.
export type { IRBuilderPluginOptions } from "./vite-plugin";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Structural Metro config shape. Kept in-house so ui-bridge-auto does not
 * pull `metro` or `expo` as a dependency. We don't touch the contents — we
 * just need a shape to thread through.
 */
export type MetroConfigLike = Record<string, unknown>;

/**
 * Options for {@link withUIBridgeIR}. Same as {@link IRBuilderPluginOptions}
 * with one Metro-specific knob — `watch` — to opt in to the long-lived
 * file-watcher loop.
 */
export interface MetroIRPluginOptions extends IRBuilderPluginOptions {
  /**
   * Set up an `fs.watch` for the include directories and re-emit on change.
   * Default `true` (Metro is long-running by nature; the cost is one
   * watcher per include root).
   *
   * Set to `false` for one-shot prebuild use — though the standalone CLI
   * (`ui-bridge-build-ir`) is the cleaner path for that case.
   */
  watch?: boolean;
}

/**
 * Handle returned by {@link createMetroIRWatcher} for callers that need to
 * tear down the watcher (e.g. tests). The Metro config flow does not need
 * this — `withUIBridgeIR` discards it.
 */
export interface MetroIRWatcherHandle {
  /** Force an immediate re-emit, bypassing the debounce. */
  emitNow(): void;
  /** Stop watching and release file handles. Idempotent. */
  close(): void;
}

// ---------------------------------------------------------------------------
// Plugin implementation
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 50;

/**
 * Build the long-lived emit + watch state. Used internally by
 * {@link withUIBridgeIR}; exported separately for tests and for callers
 * that want the watcher without the Metro-config wrapper.
 */
export function createMetroIRWatcher(
  opts: MetroIRPluginOptions,
): MetroIRWatcherHandle {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const outFile = opts.outFile ?? "src/state-machine.derived.json";
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const include = opts.include ?? ["src/**/*.tsx"];
  const watchEnabled = opts.watch ?? true;

  // Long-lived project — re-used across re-emits, identical to the Vite
  // plugin's strategy.
  let project: Project | undefined;
  const knownPaths = new Set<string>();
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const watchers: FSWatcher[] = [];
  let closed = false;

  const ensureProject = (): Project => {
    if (project) return project;
    project = createProject(projectRoot, opts.tsconfigPath);
    return project;
  };

  const emit = (): void => {
    if (closed) return;
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
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ui-bridge-ir:metro] IR build failed: ${message}`);
      throw err;
    }
  };

  const scheduleEmit = (): void => {
    if (closed) return;
    if (debounceMs <= 0) {
      try {
        emit();
      } catch {
        // Already logged; do not crash Metro.
      }
      return;
    }
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      try {
        emit();
      } catch {
        // Already logged; do not crash Metro.
      }
    }, debounceMs);
  };

  // Initial emit. Throw on first emit so misconfiguration surfaces fast;
  // subsequent emits swallow errors so a transient mistake during dev
  // doesn't bring down Metro.
  emit();

  // Forward IRBuildWarning notifications, kept distinct from emit errors.
  // (No-op if the caller didn't supply onWarning — buildProjectIR already
  // logs to stderr.)
  void (opts.onWarning satisfies ((w: IRBuildWarning) => void) | undefined);

  if (watchEnabled) {
    // Watch the unique base directories implied by the include patterns.
    // `fs.watch` with `recursive: true` is supported on Windows and macOS;
    // on Linux it fell back to per-directory watches in older Node, but as
    // of Node 20 (which this project requires) it is supported there too.
    const watchRoots = computeWatchRoots(projectRoot, include);
    for (const root of watchRoots) {
      try {
        const watcher = fsWatch(
          root,
          { recursive: true, persistent: true },
          (_event: string, filename: string | Buffer | null) => {
            if (!filename) {
              scheduleEmit();
              return;
            }
            const name = typeof filename === "string" ? filename : filename.toString();
            if (!name.endsWith(".tsx")) return;
            // Refresh the affected source file in the long-lived project so
            // the next buildProjectIR sees current contents — same trick the
            // Vite plugin uses in handleHotUpdate.
            const absolute = normalize(join(root, name));
            const proj = project;
            if (proj) {
              const sf = proj.getSourceFile(absolute);
              if (sf) {
                try {
                  sf.refreshFromFileSystemSync();
                } catch {
                  // File may have been deleted — buildProjectIR will reconcile.
                }
              }
            }
            scheduleEmit();
          },
        );
        watcher.on("error", (err) => {
          console.error(
            `[ui-bridge-ir:metro] file watcher error in ${root}: ${err.message}`,
          );
        });
        watchers.push(watcher);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(
          `[ui-bridge-ir:metro] could not watch ${root}: ${message} — IR will not auto-rebuild on change`,
        );
      }
    }
  }

  return {
    emitNow(): void {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      emit();
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // Best effort.
        }
      }
      watchers.length = 0;
    },
  };
}

/**
 * Wrap a Metro config so IR emission runs as a side effect of Metro's
 * lifecycle. Returns the original config unchanged — IR emission is purely
 * a side effect.
 *
 * Errors during the initial emit propagate (so misconfiguration surfaces
 * fast at Metro startup). Errors during incremental re-emits are logged
 * but do not crash Metro.
 */
export function withUIBridgeIR<T extends MetroConfigLike>(
  metroConfig: T,
  opts: MetroIRPluginOptions,
): T {
  // The handle's lifetime matches the Node process running Metro. Metro
  // does not give us a clean shutdown hook, so we lean on the OS to clean
  // up file watchers when Metro exits.
  createMetroIRWatcher(opts);
  return metroConfig;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Compute the set of unique directory roots to watch from a list of
 * include globs. We strip everything from the first wildcard onward and
 * de-duplicate the result.
 *
 * If a pattern is a literal file path, we watch its parent directory —
 * Node's recursive watcher needs a directory.
 */
function computeWatchRoots(projectRoot: string, include: string[]): string[] {
  const roots = new Set<string>();
  for (const pattern of include) {
    let baseRel: string;
    if (pattern.includes("*")) {
      const idx = pattern.indexOf("*");
      baseRel = pattern.slice(0, idx).replace(/\/$/, "");
      if (baseRel === "") baseRel = ".";
    } else {
      // Literal file — watch its parent directory.
      const lastSep = Math.max(pattern.lastIndexOf("/"), pattern.lastIndexOf(sep));
      baseRel = lastSep >= 0 ? pattern.slice(0, lastSep) : ".";
      if (baseRel === "") baseRel = ".";
    }
    const absolute = resolveAbsolute(projectRoot, baseRel);
    try {
      if (statSync(absolute).isDirectory()) {
        roots.add(absolute);
      }
    } catch {
      // Directory does not exist yet — skip; emit() will surface the
      // problem during build.
    }
  }
  return [...roots];
}
