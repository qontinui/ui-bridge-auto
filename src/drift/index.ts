/**
 * Public surface for the drift-hypothesis engine (Section 7).
 *
 * Browser-safe by construction: this subpath has zero `node:child_process`
 * references. `compareSpecToRuntime`, `DriftReport`, `DriftEntry`,
 * `RuntimeSnapshot`, `fetchGitLog`, `parseGitLog`, and `buildDriftHypotheses`
 * are pure / type-only and bundle cleanly for any environment.
 *
 * Node consumers that need to shell out to `git` import `defaultRunGit` from
 * the dedicated `@qontinui/ui-bridge-auto/drift/node` subpath instead. The
 * physical split lets build-time guards (qontinui-web's
 * `check-browser-safe-imports`) assert this subpath stays Node-free without
 * relying on tree-shaking.
 */

export * from "./types";
export { fetchGitLog, parseGitLog, type RunGit } from "./git-log";
export { buildDriftHypotheses } from "./hypothesis";

// Spec-vs-runtime drift comparator. Lives in `ir-builder/drift.ts` because
// it consumes the IR document type, but it is part of the drift surface and
// is re-exported here so consumers have a single drift entry point. Pure
// function — only type-only imports from `@qontinui/shared-types`.
export type {
  DriftEntry,
  DriftReport,
  RuntimeSnapshot,
} from "../ir-builder/drift";
export { compareSpecToRuntime } from "../ir-builder/drift";
