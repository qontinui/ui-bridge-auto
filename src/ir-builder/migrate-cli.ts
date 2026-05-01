#!/usr/bin/env node
/**
 * Phase A3 — Codemod CLI: legacy `*.spec.uibridge.json` -> per-page IR layout.
 *
 * Wraps the inverse projection (`projectLegacyToIR`) and the forward
 * projection (`projectIRToBundledPage`) to migrate a legacy bundled-page spec
 * into the new per-page directory layout:
 *
 *   <pages-dir>/<page-id>/state-machine.derived.json   (the IR document)
 *   <pages-dir>/<page-id>/spec.uibridge.json           (regenerated projection)
 *   <pages-dir>/<page-id>/notes.md                     (empty starter)
 *
 * Modes:
 *   - Single-file: `migrate-uibridge-spec <input.spec.uibridge.json> --out <pages-dir>`
 *   - Batch:       `migrate-uibridge-spec --root <repo-path> [--apply]`
 *
 * Dry-run is the DEFAULT. `--apply` is required to write files. The
 * `--preserve-legacy` flag (default true) keeps the legacy file in place;
 * Phase A3 never deletes legacy files (Phase A4 / per-app cutover handles
 * legacy removal).
 *
 * Page id derivation: relative path -> segments -> drop `(group)` segments
 * -> drop `src/app` prefix -> strip basename's `.spec.uibridge.json` -> join
 * with dashes -> fall back to basename if empty. (Yes, the dashed result is
 * a bit ugly for deeply-nested web specs; the plan acknowledges this as the
 * documented rule.)
 *
 * Worked example:
 *   `qontinui-web/frontend/src/app/(app)/settings/ai/ai-settings.spec.uibridge.json`
 *   -> page id `settings-ai-ai-settings`
 *
 * Per-app pages-dir mapping for batch mode:
 *   - `qontinui-runner/src/specs/*.spec.uibridge.json`
 *       -> `qontinui-runner/specs/pages/<id>/`
 *   - `qontinui-web/frontend/.../<name>.spec.uibridge.json`
 *       -> `qontinui-web/frontend/specs/pages/<id>/`
 *   - `qontinui-mobile/specs/*.spec.uibridge.json`
 *       -> `qontinui-mobile/specs/pages/<id>/`
 *   - `qontinui-supervisor/frontend/src/specs/*.spec.uibridge.json`
 *       -> `qontinui-supervisor/frontend/specs/pages/<id>/`
 *
 * Idempotent: re-running compares existing files byte-for-byte and skips
 * unchanged writes.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  projectIRToBundledPage,
  projectLegacyToIR,
  type IRDocument,
  type LegacySpec,
} from "@qontinui/shared-types/ui-bridge-ir";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  /** Positional argument: input legacy spec path (single-file mode). */
  input?: string;
  /** `--out=<pages-dir>` for single-file mode. */
  out?: string;
  /** `--root=<repo-path>` for batch mode. */
  root?: string;
  /** `--apply` flag. Without it, the CLI runs as a dry-run. */
  apply: boolean;
  /** `--preserve-legacy` (default true). Phase A3 always preserves. */
  preserveLegacy: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    apply: false,
    preserveLegacy: true,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "--apply") {
      out.apply = true;
      continue;
    }
    if (arg === "--preserve-legacy") {
      out.preserveLegacy = true;
      continue;
    }
    if (arg === "--no-preserve-legacy") {
      out.preserveLegacy = false;
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) continue;
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      switch (key) {
        case "out":
          out.out = val;
          break;
        case "root":
          out.root = val;
          break;
      }
      continue;
    }
    // Positional argument (only the first is honored).
    if (out.input === undefined) {
      out.input = arg;
    }
  }
  return out;
}

function printHelp(write: (s: string) => void = (s) => process.stderr.write(s)): void {
  write(
    [
      "migrate-uibridge-spec — codemod legacy *.spec.uibridge.json files to the IR layout",
      "",
      "Single-file mode:",
      "  migrate-uibridge-spec <input.spec.uibridge.json> --out <pages-dir> [--apply]",
      "",
      "Batch mode:",
      "  migrate-uibridge-spec --root <repo-path> [--apply]",
      "",
      "Flags:",
      "  --apply              Required to write files. Default is dry-run.",
      "  --preserve-legacy    Keep the legacy file in place (default true).",
      "  --no-preserve-legacy (Reserved; not used in Phase A3 — legacy is always preserved.)",
      "  -h, --help           Show this help",
      "",
      "Output (per page):",
      "  <pages-dir>/<page-id>/state-machine.derived.json",
      "  <pages-dir>/<page-id>/spec.uibridge.json",
      "  <pages-dir>/<page-id>/notes.md",
      "",
      "Page id derivation (web specs):",
      "  relative path -> segments -> drop `(group)` segments",
      "  -> drop `src/app` prefix -> strip basename's `.spec.uibridge.json`",
      "  -> join with dashes -> fall back to basename if empty.",
      "  Example: src/app/(app)/settings/ai/ai-settings.spec.uibridge.json",
      "        -> page id `settings-ai-ai-settings`",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const SPEC_SUFFIX = ".spec.uibridge.json";

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Strip the `.spec.uibridge.json` suffix from a basename.
 * Returns the input unchanged if the suffix isn't present.
 */
function stripSpecSuffix(name: string): string {
  if (name.endsWith(SPEC_SUFFIX)) {
    return name.slice(0, -SPEC_SUFFIX.length);
  }
  return name;
}

/**
 * Single-file mode page id: strip the `.spec.uibridge.json` suffix from the
 * input path's basename. (Co-located web specs use `derivePageIdFromWebPath`
 * via batch mode; in single-file mode the user already passed `--out` so we
 * just need a sensible directory name.)
 */
export function derivePageIdFromBasename(inputPath: string): string {
  return stripSpecSuffix(basename(inputPath));
}

/**
 * Web-spec page id derivation. Splits the path relative to
 * `qontinui-web/frontend/`, drops the `src/app/` prefix, drops any `(...)`
 * route group segments, strips the basename's `.spec.uibridge.json` suffix,
 * and joins with dashes. Falls back to the basename if the result is empty.
 *
 * @param relativeFromFrontendRoot Path relative to `qontinui-web/frontend/`.
 *   May use either forward or backslashes.
 */
export function derivePageIdFromWebPath(relativeFromFrontendRoot: string): string {
  const norm = normalizeSlashes(relativeFromFrontendRoot);
  const parts = norm.split("/").filter((p) => p.length > 0);

  // Drop a leading `src/app/` if present (any other prefix is kept).
  let i = 0;
  if (parts[i] === "src") i++;
  if (parts[i] === "app") i++;
  const trimmed = parts.slice(i);

  // Drop `(group)` route segments.
  const filtered = trimmed.filter((p) => !(p.startsWith("(") && p.endsWith(")")));

  if (filtered.length === 0) {
    return stripSpecSuffix(basename(norm));
  }

  // Strip the basename's spec suffix in place.
  const last = filtered[filtered.length - 1];
  filtered[filtered.length - 1] = stripSpecSuffix(last);

  // If the now-last segment is empty (basename was exactly the suffix), drop it.
  if (filtered[filtered.length - 1].length === 0) {
    filtered.pop();
  }

  if (filtered.length === 0) {
    return stripSpecSuffix(basename(norm));
  }

  return filtered.join("-");
}

/**
 * Maps a legacy spec path (absolute, normalized) to the per-app pages
 * directory + page id, per the Phase A3 plan. Returns `null` if the path
 * doesn't match any known per-app pattern; the batch driver will skip such
 * paths with a warning.
 */
export interface SpecRouting {
  /** Absolute path to the per-app pages directory (e.g. `.../specs/pages`). */
  pagesDir: string;
  /** Page id (directory name under `pagesDir`). */
  pageId: string;
}

export function routeSpecPath(absoluteSpecPath: string, repoRoot: string): SpecRouting | null {
  const repoRootNorm = normalizeSlashes(repoRoot).replace(/\/$/, "");
  const norm = normalizeSlashes(absoluteSpecPath);
  if (!norm.startsWith(repoRootNorm + "/")) return null;
  const rel = norm.slice(repoRootNorm.length + 1);
  const parts = rel.split("/");
  if (parts.length < 2) return null;

  const app = parts[0];

  // qontinui-web/frontend/...
  if (app === "qontinui-web" && parts[1] === "frontend") {
    const fromFrontend = parts.slice(2).join("/");
    const id = derivePageIdFromWebPath(fromFrontend);
    return {
      pagesDir: join(repoRoot, "qontinui-web", "frontend", "specs", "pages"),
      pageId: id,
    };
  }

  // qontinui-runner/src/specs/...
  if (app === "qontinui-runner") {
    return {
      pagesDir: join(repoRoot, "qontinui-runner", "specs", "pages"),
      pageId: stripSpecSuffix(basename(norm)),
    };
  }

  // qontinui-mobile/specs/...
  if (app === "qontinui-mobile") {
    return {
      pagesDir: join(repoRoot, "qontinui-mobile", "specs", "pages"),
      pageId: stripSpecSuffix(basename(norm)),
    };
  }

  // qontinui-supervisor/frontend/src/specs/...
  if (app === "qontinui-supervisor" && parts[1] === "frontend") {
    return {
      pagesDir: join(repoRoot, "qontinui-supervisor", "frontend", "specs", "pages"),
      pageId: stripSpecSuffix(basename(norm)),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// File walking (batch mode)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  "target",
  "target-agent",
  "target-pool",
  "dist",
  ".git",
]);

export function findLegacySpecs(rootDir: string): string[] {
  const out: string[] = [];
  walk(rootDir, out);
  return out.sort();
}

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(SPEC_SUFFIX)) {
      out.push(normalizeSlashes(full));
    }
  }
}

// ---------------------------------------------------------------------------
// Migration core
// ---------------------------------------------------------------------------

export interface MigrationOutcome {
  inputPath: string;
  pageId: string;
  pageDir: string;
  /** Files that would be (or were) written. */
  written: string[];
  /** Files that already matched on-disk content (idempotent skip). */
  skipped: string[];
  warnings: string[];
  error?: string;
}

interface PageOutputs {
  ir: string;
  spec: string;
  notes: string;
}

function buildPageOutputs(legacy: LegacySpec, pageId: string): PageOutputs {
  const ir: IRDocument = projectLegacyToIR(legacy, { docId: pageId });
  const irText = JSON.stringify(ir, null, 2) + "\n";

  const regenerated = projectIRToBundledPage(ir);
  const specText = JSON.stringify(regenerated, null, 2) + "\n";

  const titleName = ir.name && ir.name.length > 0 ? ir.name : pageId;
  const notesText = `# ${titleName}\n\n_(notes)_\n`;

  return { ir: irText, spec: specText, notes: notesText };
}

/**
 * Compare a candidate write against the existing file byte-for-byte. Returns
 * `true` if the existing file matches and the write can be skipped.
 */
function fileMatches(path: string, content: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const existing = readFileSync(path, "utf8");
    return existing === content;
  } catch {
    return false;
  }
}

function migrateOne(
  inputPath: string,
  pagesDir: string,
  pageId: string,
  apply: boolean,
): MigrationOutcome {
  const outcome: MigrationOutcome = {
    inputPath,
    pageId,
    pageDir: join(pagesDir, pageId),
    written: [],
    skipped: [],
    warnings: [],
  };

  let legacy: LegacySpec;
  try {
    const raw = readFileSync(inputPath, "utf8");
    legacy = JSON.parse(raw) as LegacySpec;
  } catch (err) {
    outcome.error = `failed to read/parse ${inputPath}: ${err instanceof Error ? err.message : String(err)}`;
    return outcome;
  }

  let outputs: PageOutputs;
  try {
    outputs = buildPageOutputs(legacy, pageId);
  } catch (err) {
    outcome.error = `projection failed for ${inputPath}: ${err instanceof Error ? err.message : String(err)}`;
    return outcome;
  }

  const irPath = join(outcome.pageDir, "state-machine.derived.json");
  const specPath = join(outcome.pageDir, "spec.uibridge.json");
  const notesPath = join(outcome.pageDir, "notes.md");

  const targets: Array<[string, string]> = [
    [irPath, outputs.ir],
    [specPath, outputs.spec],
    [notesPath, outputs.notes],
  ];

  for (const [path, content] of targets) {
    if (fileMatches(path, content)) {
      outcome.skipped.push(path);
      continue;
    }
    outcome.written.push(path);
  }

  if (apply && outcome.written.length > 0) {
    try {
      mkdirSync(outcome.pageDir, { recursive: true });
      for (const [path, content] of targets) {
        if (fileMatches(path, content)) continue;
        // Special case: don't clobber a non-empty hand-edited `notes.md`.
        if (path === notesPath && existsSync(path)) {
          try {
            const existing = readFileSync(path, "utf8");
            if (existing.length > 0 && existing !== outputs.notes) {
              outcome.warnings.push(
                `notes.md already exists and is non-empty; preserving hand-authored content`,
              );
              // Move it from `written` to `skipped` for accurate reporting.
              outcome.written = outcome.written.filter((w) => w !== path);
              outcome.skipped.push(path);
              continue;
            }
          } catch {
            /* fall through and overwrite */
          }
        }
        writeFileSync(path, content, "utf8");
      }
    } catch (err) {
      outcome.error = `write failed for ${outcome.pageDir}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function defaultIO(): CliIO {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

function reportOutcome(outcome: MigrationOutcome, apply: boolean, io: CliIO): void {
  const verb = apply ? "wrote" : "would write";
  const skipVerb = apply ? "skipped" : "would skip";
  if (outcome.error !== undefined) {
    io.stderr(`[migrate] ERROR ${outcome.inputPath}: ${outcome.error}\n`);
    return;
  }
  io.stdout(
    `[migrate] ${outcome.inputPath} -> ${outcome.pageDir} ` +
      `(${verb} ${outcome.written.length}, ${skipVerb} ${outcome.skipped.length})\n`,
  );
  for (const w of outcome.warnings) {
    io.stderr(`[migrate]   warn: ${w}\n`);
  }
}

export function runMigrateCli(argv: string[] = process.argv.slice(2), io: CliIO = defaultIO()): number {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp(io.stderr);
    return 0;
  }

  // Validate mode selection.
  const isSingle = args.input !== undefined;
  const isBatch = args.root !== undefined;
  if (isSingle === isBatch) {
    io.stderr(
      `migrate-uibridge-spec: provide EITHER an input file (single-file mode) OR --root (batch mode)\n\n`,
    );
    printHelp(io.stderr);
    return 2;
  }

  if (isSingle) {
    return runSingleFile(args, io);
  }
  return runBatch(args, io);
}

function runSingleFile(args: ParsedArgs, io: CliIO): number {
  if (args.input === undefined) return 2;
  if (args.out === undefined) {
    io.stderr(`migrate-uibridge-spec: --out=<pages-dir> is required in single-file mode\n\n`);
    printHelp(io.stderr);
    return 2;
  }

  const inputAbs = isAbsolute(args.input) ? args.input : resolve(process.cwd(), args.input);
  if (!existsSync(inputAbs)) {
    io.stderr(`migrate-uibridge-spec: input not found: ${inputAbs}\n`);
    return 1;
  }

  const pagesDirAbs = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
  const pageId = derivePageIdFromBasename(inputAbs);

  const outcome = migrateOne(inputAbs, pagesDirAbs, pageId, args.apply);
  reportOutcome(outcome, args.apply, io);

  if (outcome.error !== undefined) return 1;
  if (!args.apply) {
    io.stdout(
      `[migrate] dry-run complete; re-run with --apply to write ${outcome.written.length} file(s)\n`,
    );
  }
  return 0;
}

function runBatch(args: ParsedArgs, io: CliIO): number {
  if (args.root === undefined) return 2;
  const repoRoot = isAbsolute(args.root) ? args.root : resolve(process.cwd(), args.root);
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
    io.stderr(`migrate-uibridge-spec: --root is not a directory: ${repoRoot}\n`);
    return 1;
  }

  const specs = findLegacySpecs(repoRoot);
  if (specs.length === 0) {
    io.stdout(`[migrate] no legacy specs found under ${repoRoot}\n`);
    return 0;
  }

  let migrated = 0;
  let warnings = 0;
  let errors = 0;

  for (const spec of specs) {
    const routing = routeSpecPath(spec, repoRoot);
    if (routing === null) {
      io.stderr(
        `[migrate] WARN no per-app routing for ${spec}; skipping (relative path: ${relative(repoRoot, spec)})\n`,
      );
      warnings++;
      continue;
    }
    const outcome = migrateOne(spec, routing.pagesDir, routing.pageId, args.apply);
    reportOutcome(outcome, args.apply, io);
    if (outcome.error !== undefined) {
      errors++;
    } else {
      migrated++;
      warnings += outcome.warnings.length;
    }
  }

  io.stdout(`[migrate] migrated: ${migrated}, warnings: ${warnings}, errors: ${errors}\n`);
  if (!args.apply) {
    io.stdout(`[migrate] dry-run complete; re-run with --apply to write files\n`);
  }
  return errors > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Script bootstrap
// ---------------------------------------------------------------------------

// Run only when invoked as a script, not when imported.
const isMainModule =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof require !== "undefined" && require.main === (module as any);
if (isMainModule) {
  process.exit(runMigrateCli());
}

// Suppress unused-import warnings — `sep` reserved for future cross-platform fixes.
void sep;
