/**
 * Node-only drift surface — `@qontinui/ui-bridge-auto/drift/node`.
 *
 * The browser-safe drift entry point is `@qontinui/ui-bridge-auto/drift`;
 * import from that subpath whenever possible. Node consumers that need to
 * shell out to `git` for the drift-hypothesis engine import `defaultRunGit`
 * from this dedicated subpath, which physically isolates `node:child_process`
 * from the browser bundle so build-time guards (qontinui-web's
 * `check-browser-safe-imports`) can assert the `./drift` subpath has zero
 * Node-only references.
 */

export { defaultRunGit } from "./git-log-node";
