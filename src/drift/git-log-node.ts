/**
 * Node-only `RunGit` default for the drift-hypothesis engine.
 *
 * Physically separated from `git-log.ts` so the `./drift` subpath has zero
 * `node:child_process` references — the strong guarantee the qontinui-web
 * `check-browser-safe-imports` CI script asserts. Browsers must not import
 * this module; Node consumers import it explicitly via the dedicated
 * `@qontinui/ui-bridge-auto/drift/node` subpath.
 */

import type { RunGit } from "./git-log";

/**
 * Default `RunGit` implementation backed by `child_process.execFile`.
 *
 * Lazily loads `node:child_process` so that bundlers which transitively
 * resolve this file (despite the subpath split, e.g. when a Node consumer
 * passes `defaultRunGit` through a re-export chain) still keep the actual
 * import dynamic. The subpath split is the primary guard; the lazy import
 * is belt-and-braces.
 */
export const defaultRunGit: RunGit = async (args) => {
  const cp = await import("node:child_process");
  return new Promise<string>((resolve, reject) => {
    cp.execFile("git", args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
};
