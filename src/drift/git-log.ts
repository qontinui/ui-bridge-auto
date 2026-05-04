/**
 * Git-log helper for the drift-hypothesis engine.
 *
 * Pure parsing of `git log --since=... --name-only --format=...`. The
 * actual subprocess invocation is injected via the `RunGit` callback so
 * tests stub it without shelling out and consumers without a checkout
 * (CI, browser-side replay) get a clean "no git" path.
 *
 * No `Date.now()` calls. No imports of `child_process` from this module's
 * pure entry point — `defaultRunGit` is exported separately for Node
 * consumers who opt in.
 */

import type { GitCommitRef } from "./types";

// ---------------------------------------------------------------------------
// RunGit injection
// ---------------------------------------------------------------------------

/**
 * Runs `git` with the given args and resolves with stdout. Implementations
 * may shell out (Node), call a server endpoint, or return a fixture string
 * (tests).
 */
export type RunGit = (args: string[]) => Promise<string>;

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Tab-separated header line: `<sha>\t<isoTimestamp>\t<author>\t<subject>`.
 * Files follow the header on subsequent lines until a blank line or EOF.
 *
 * %x09 is a literal tab; %aI is the strict ISO-8601 author date; %an the
 * author name; %s the subject. We separate header fields with %x09 rather
 * than spaces so author names with spaces are not ambiguous.
 */
export const GIT_LOG_FORMAT = "%H%x09%aI%x09%an%x09%s";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch git commits whose author date is at or after `since` (epoch ms).
 *
 * The `since` argument is an ABSOLUTE epoch-ms timestamp, not a duration.
 * It's converted to ISO-8601 inside this function for the `--since=` flag,
 * which is the only place a wall-clock value enters the call. Tests pin
 * `since` to a fixed value to keep results stable.
 *
 * Output ordering: `timestamp` descending, with `sha` ascending as
 * tiebreaker. Each commit's `files` array is sorted ascending.
 *
 * Failure modes (returns empty array, does NOT throw):
 *  - `runGit` rejecting (no git, no checkout, etc.) — the caller decides
 *    whether the engine should still produce hypotheses without git.
 *
 * The `runGit` injection is the only way this module touches process state.
 * Pass `defaultRunGit` from a Node consumer; pass a stub from tests.
 */
export async function fetchGitLog(
  runGit: RunGit,
  since: number,
): Promise<GitCommitRef[]> {
  const sinceIso = new Date(since).toISOString();
  let stdout: string;
  try {
    stdout = await runGit([
      "log",
      `--since=${sinceIso}`,
      "--name-only",
      `--format=${GIT_LOG_FORMAT}`,
    ]);
  } catch {
    return [];
  }
  return parseGitLog(stdout);
}

/**
 * Parse raw `git log` output into deterministically ordered `GitCommitRef[]`.
 *
 * Exported separately for test fixtures that want to skip the `runGit`
 * injection layer.
 */
export function parseGitLog(stdout: string): GitCommitRef[] {
  // Split on \n only — \r is stripped per-line below to handle CRLF stdouts.
  const lines = stdout.split("\n");
  const commits: GitCommitRef[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    i += 1;
    if (raw === undefined) break;
    const line = raw.replace(/\r$/, "");
    if (line === "") continue;

    // Header line: <sha>\t<iso>\t<author>\t<subject>
    const parts = line.split("\t");
    if (parts.length < 4) {
      // Malformed header — skip until next blank line as defensive recovery.
      continue;
    }
    const sha = parts[0];
    const iso = parts[1];
    const author = parts[2];
    // Subject may itself contain a tab if the commit was crafted with one;
    // rejoin trailing parts to preserve the original message. (The format
    // uses %x09 separators; any tab inside %s is rare but possible.)
    const message = parts.slice(3).join("\t");

    if (!sha || !iso) continue;

    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) continue;

    // Read file lines until blank or EOF.
    const files: string[] = [];
    while (i < lines.length) {
      const fileRaw = lines[i];
      if (fileRaw === undefined) break;
      const fileLine = fileRaw.replace(/\r$/, "");
      if (fileLine === "") {
        i += 1;
        break;
      }
      // If the next line itself looks like a commit header (4+ tab parts
      // with a non-empty SHA-shaped first field), back out and let the
      // outer loop pick it up. Files don't contain tabs.
      if (looksLikeHeader(fileLine)) {
        break;
      }
      files.push(fileLine);
      i += 1;
    }

    files.sort();
    commits.push({
      sha,
      message,
      author,
      timestamp,
      files: dedupeSorted(files),
    });
  }

  commits.sort(byTimestampDescThenShaAsc);
  return commits;
}

// ---------------------------------------------------------------------------
// Default Node runner — opt-in. Do NOT call this from `fetchGitLog`.
// ---------------------------------------------------------------------------

/**
 * Default `RunGit` implementation backed by `child_process.execFile`.
 *
 * Node-only. Browser consumers and consumers who want to shell out via a
 * different mechanism (workspace-relative `git`, custom auth) provide
 * their own `RunGit`.
 *
 * Imports `node:child_process` lazily so this module stays bundleable for
 * non-Node environments — bundlers that tree-shake unused exports will
 * drop the import entirely if `defaultRunGit` is never called.
 */
export const defaultRunGit: RunGit = async (args) => {
  // Lazy require keeps `node:child_process` out of browser bundles.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = await import("node:child_process");
  return new Promise<string>((resolve, reject) => {
    cp.execFile("git", args, { maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.toString());
    });
  });
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function looksLikeHeader(line: string): boolean {
  // Header has at least 4 tab-separated fields. File paths never contain
  // a tab (git would have escaped it as a quoted path which we'd see as
  // the literal `\t` sequence, not a real tab). Use this as the cheap
  // discriminator for a malformed log without an explicit blank
  // separator.
  const tabCount = countChar(line, "\t");
  if (tabCount < 3) return false;
  const sha = line.split("\t")[0];
  // SHA is 40 hex chars (full) or 7+ (short). We always emit %H (full).
  return sha.length === 40 && /^[0-9a-f]+$/.test(sha);
}

function countChar(s: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === ch) n += 1;
  return n;
}

function dedupeSorted(arr: string[]): string[] {
  const out: string[] = [];
  for (const v of arr) {
    if (out.length === 0 || out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

function byTimestampDescThenShaAsc(a: GitCommitRef, b: GitCommitRef): number {
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
  if (a.sha < b.sha) return -1;
  if (a.sha > b.sha) return 1;
  return 0;
}
