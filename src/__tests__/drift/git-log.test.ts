/**
 * Unit tests for the git-log helper.
 *
 * The helper takes an injected `RunGit` callback so tests stub the
 * subprocess layer entirely. We feed canned `git log --name-only` output
 * and assert the parsed `GitCommitRef[]` shape and ordering.
 */

import { describe, it, expect, vi } from "vitest";

import { fetchGitLog, parseGitLog, type RunGit } from "../../drift/git-log";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Two commits, second is older. Tab-separated header followed by file paths.
// The parser must order them newest-first.
const TWO_COMMITS_STDOUT = [
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\t2026-01-15T12:00:00Z\tAlice\tfix submit-form click handler",
  "src/forms/submit-form.tsx",
  "src/forms/submit-form.test.tsx",
  "",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\t2026-01-10T08:30:00Z\tBob\tinitial submit form",
  "src/forms/submit-form.tsx",
  "",
].join("\n");

const ONE_COMMIT_NO_TRAILING_BLANK = [
  "cccccccccccccccccccccccccccccccccccccccc\t2026-02-01T00:00:00Z\tCarol\tno trailing blank",
  "src/a.ts",
  "src/b.ts",
].join("\n");

const COMMIT_WITH_NO_FILES = [
  "dddddddddddddddddddddddddddddddddddddddd\t2026-03-01T00:00:00Z\tDan\tmerge commit",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseGitLog", () => {
  it("parses two commits and orders them newest-first", () => {
    const commits = parseGitLog(TWO_COMMITS_STDOUT);

    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("a".repeat(40));
    expect(commits[0].author).toBe("Alice");
    expect(commits[0].message).toBe("fix submit-form click handler");
    expect(commits[0].files).toEqual([
      "src/forms/submit-form.test.tsx",
      "src/forms/submit-form.tsx",
    ]);
    expect(commits[0].timestamp).toBe(Date.parse("2026-01-15T12:00:00Z"));

    expect(commits[1].sha).toBe("b".repeat(40));
    expect(commits[1].author).toBe("Bob");
    expect(commits[1].timestamp).toBe(Date.parse("2026-01-10T08:30:00Z"));
  });

  it("handles a stdout with no trailing blank line", () => {
    const commits = parseGitLog(ONE_COMMIT_NO_TRAILING_BLANK);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("handles a commit with zero files", () => {
    const commits = parseGitLog(COMMIT_WITH_NO_FILES);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual([]);
  });

  it("returns an empty array on empty stdout", () => {
    expect(parseGitLog("")).toEqual([]);
  });

  it("dedupes file paths within a single commit", () => {
    const stdout = [
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\t2026-04-01T00:00:00Z\tErin\tdupe files",
      "src/x.ts",
      "src/x.ts",
      "src/y.ts",
      "",
    ].join("\n");
    const commits = parseGitLog(stdout);
    expect(commits[0].files).toEqual(["src/x.ts", "src/y.ts"]);
  });

  it("breaks ties on equal timestamps by sha ascending", () => {
    const stdout = [
      "ffffffffffffffffffffffffffffffffffffffff\t2026-05-01T00:00:00Z\tFred\tsame ts (later sha)",
      "src/z.ts",
      "",
      "1111111111111111111111111111111111111111\t2026-05-01T00:00:00Z\tGina\tsame ts (earlier sha)",
      "src/y.ts",
      "",
    ].join("\n");
    const commits = parseGitLog(stdout);
    expect(commits.map((c) => c.sha)).toEqual([
      "1".repeat(40),
      "f".repeat(40),
    ]);
  });
});

describe("fetchGitLog", () => {
  it("invokes runGit with the expected args and parses the result", async () => {
    const runGit: RunGit = vi.fn(async () => TWO_COMMITS_STDOUT);
    const since = Date.parse("2026-01-01T00:00:00Z");

    const commits = await fetchGitLog(runGit, since);

    expect(runGit).toHaveBeenCalledTimes(1);
    const args = (
      runGit as unknown as { mock: { calls: Array<[string[]]> } }
    ).mock.calls[0][0];
    expect(args[0]).toBe("log");
    expect(args[1]).toBe("--since=2026-01-01T00:00:00.000Z");
    expect(args[2]).toBe("--name-only");
    expect(args[3]).toMatch(/^--format=/);

    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe("a".repeat(40));
  });

  it("returns an empty array when runGit rejects (no git, no checkout)", async () => {
    const runGit: RunGit = async () => {
      throw new Error("ENOENT: git not found");
    };
    const commits = await fetchGitLog(runGit, 0);
    expect(commits).toEqual([]);
  });

  it("converts since (epoch ms) to a strict ISO-8601 string for --since=", async () => {
    let receivedArgs: string[] = [];
    const runGit: RunGit = async (args) => {
      receivedArgs = args;
      return "";
    };
    await fetchGitLog(runGit, Date.parse("2026-04-15T10:30:45.500Z"));
    expect(receivedArgs[1]).toBe("--since=2026-04-15T10:30:45.500Z");
  });
});
