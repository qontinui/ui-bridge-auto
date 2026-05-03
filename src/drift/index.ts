/**
 * Public surface for the drift-hypothesis engine (Section 7).
 *
 * Phase 1: additive only — does NOT modify the element-query API. Phase 2
 * lifts the query return shape in parallel.
 *
 * Browser-safe surface: `compareSpecToRuntime`, `DriftReport`, `DriftEntry`,
 * `RuntimeSnapshot`, `fetchGitLog`, `parseGitLog`, and `buildDriftHypotheses`
 * are pure / type-only and safe to bundle for browsers.
 *
 * The Node-only `defaultRunGit` (lazily imports `node:child_process`) is
 * still re-exported here for backward compatibility with Node consumers
 * (e.g. the runner). Bundlers that tree-shake unused ESM exports (Webpack 5,
 * esbuild, Rollup) MUST drop the import when callers only reference the
 * pure exports above. Browser callers MUST NOT import `defaultRunGit`.
 */

export * from "./types";
export {
  fetchGitLog,
  parseGitLog,
  defaultRunGit,
  type RunGit,
} from "./git-log";
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
