/**
 * Public surface for the drift-hypothesis engine (Section 7).
 *
 * Phase 1: additive only — does NOT modify the element-query API. Phase 2
 * lifts the query return shape in parallel.
 */

export * from "./types";
export { fetchGitLog, parseGitLog, defaultRunGit, type RunGit } from "./git-log";
export { buildDriftHypotheses } from "./hypothesis";
