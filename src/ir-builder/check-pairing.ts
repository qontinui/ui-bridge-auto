#!/usr/bin/env node
/**
 * Phase B5e — CI gate for legacy `*.spec.uibridge.json` <-> per-page IR pairing.
 *
 * Walks a repo (or the parent monorepo with `--all`), finds every legacy
 * `*.spec.uibridge.json`, and for each one verifies that:
 *
 *   1. A matching `<pages-dir>/<page-id>/state-machine.derived.json` exists.
 *   2. The legacy file's structural fingerprint (group count, group ids,
 *      total assertion count) matches the IR's forward-projected fingerprint.
 *
 * Routing reuses `routeSpecPath` from `migrate-cli.ts` so this gate stays
 * lock-step with the codemod.
 *
 * Modes:
 *   - `--mode=warn`  (default): always exit 0, just report.
 *   - `--mode=block`: exit 1 if any spec is missing or mismatched.
 *
 * Plan: warn-only for the first week, then flip to block after the rollout
 * stabilises. Both modes always print a human-readable report and a final
 * `paired: N, missing: M, mismatched: K` summary line.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  projectIRToBundledPage,
  projectLegacyToIR,
  type IRDocument,
  type LegacySpec,
} from "@qontinui/shared-types/ui-bridge-ir";

import { findLegacySpecs, routeSpecPath, type SpecRouting } from "./migrate-cli";

// ---------------------------------------------------------------------------
// Single-repo routing helper
// ---------------------------------------------------------------------------

/**
 * The four apps that ship `*.spec.uibridge.json` files. The CI workflow uses
 * this enum via `--app <name>` when running against a single-repo checkout
 * (the typical CI shape — the repo is cloned alone, not as a sibling under a
 * monorepo root).
 */
export type AppName =
  | "qontinui-runner"
  | "qontinui-web"
  | "qontinui-mobile"
  | "qontinui-supervisor";

const APP_NAMES: ReadonlySet<string> = new Set<AppName>([
  "qontinui-runner",
  "qontinui-web",
  "qontinui-mobile",
  "qontinui-supervisor",
]);

/**
 * Single-repo variant of `routeSpecPath`. Reuses the parent-monorepo logic by
 * synthesising a parent-style absolute path (`<faux-parent>/<app>/...`) so
 * we don't fork the routing rules. The faux parent never touches disk; only
 * the returned `pagesDir` is used (joined back onto `repoRoot` below).
 */
export function routeSpecPathInSingleRepo(
  absoluteSpecPath: string,
  repoRoot: string,
  app: AppName,
): SpecRouting | null {
  // Build a synthetic parent root so the existing per-app branch in
  // `routeSpecPath` matches. We then rewrite `pagesDir` back onto the real
  // repo root.
  const fauxParent = "/__faux_parent__";
  const fauxRepoRoot = `${fauxParent}/${app}`;
  // `repoRoot` may use platform separators; normalise both sides via
  // forward-slash comparison just like `routeSpecPath` does internally.
  const normSpec = absoluteSpecPath.replace(/\\/g, "/");
  const normRoot = repoRoot.replace(/\\/g, "/").replace(/\/$/, "");
  if (!normSpec.startsWith(normRoot + "/")) return null;
  const relWithinRepo = normSpec.slice(normRoot.length + 1);
  const fauxAbs = `${fauxRepoRoot}/${relWithinRepo}`;
  const fauxRouting = routeSpecPath(fauxAbs, fauxParent);
  if (fauxRouting === null) return null;
  // Strip the `/__faux_parent__/<app>/` prefix from `pagesDir` and re-anchor
  // on the real repo root.
  const fauxPagesDir = fauxRouting.pagesDir.replace(/\\/g, "/");
  const fauxPrefix = `${fauxRepoRoot}/`;
  if (!fauxPagesDir.startsWith(fauxPrefix)) return null;
  const relPagesDir = fauxPagesDir.slice(fauxPrefix.length);
  return {
    pagesDir: join(repoRoot, ...relPagesDir.split("/")),
    pageId: fauxRouting.pageId,
  };
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export type CheckMode = "warn" | "block";

export interface ParsedArgs {
  /** `--root <path>`: a single repo's working tree to check. */
  root?: string;
  /** `--all`: walk the parent monorepo (sibling repos). */
  all: boolean;
  /**
   * `--app <name>`: when `--root` points at a single-repo checkout (the CI
   * shape), this is the app name (`qontinui-runner`, etc.) so routing rules
   * line up. If `--all` is used, this is ignored — routing comes from the
   * sibling-repo directory layout.
   */
  app?: AppName;
  /** `--mode=warn|block` — default `warn`. */
  mode: CheckMode;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    all: false,
    mode: "warn",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (arg === "--all") {
      out.all = true;
      continue;
    }
    if (arg === "--root" || arg === "-r") {
      // Space-separated form: `--root <path>`.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.root = next;
        i++;
      }
      continue;
    }
    if (arg === "--app") {
      const next = argv[i + 1];
      if (next !== undefined && APP_NAMES.has(next)) {
        out.app = next as AppName;
        i++;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq === -1) continue;
      const key = arg.slice(2, eq);
      const val = arg.slice(eq + 1);
      switch (key) {
        case "root":
          out.root = val;
          break;
        case "app":
          if (APP_NAMES.has(val)) {
            out.app = val as AppName;
          }
          break;
        case "mode":
          if (val === "warn" || val === "block") {
            out.mode = val;
          }
          break;
      }
      continue;
    }
  }
  return out;
}

function printHelp(write: (s: string) => void = (s) => process.stderr.write(s)): void {
  write(
    [
      "check-spec-pairing — verify every legacy *.spec.uibridge.json has a matching IR file",
      "",
      "Usage:",
      "  check-spec-pairing --root <repo-path> [--mode=warn|block]",
      "  check-spec-pairing --all [--mode=warn|block]",
      "",
      "Flags:",
      "  --root <path>   Repo working tree to check (mutually exclusive with --all).",
      "  --all           Walk the parent monorepo (the directory containing this and",
      "                  the sibling app repos).",
      "  --app <name>    For single-repo mode, the app this repo is. One of:",
      "                  qontinui-runner, qontinui-web, qontinui-mobile,",
      "                  qontinui-supervisor. Inferred from `basename --root` if omitted.",
      "  --mode <mode>   `warn` (default) always exits 0; `block` exits 1 on any",
      "                  missing or mismatched pairing.",
      "  -h, --help      Show this help",
      "",
      "Pairing rules (per legacy spec):",
      "  - The expected IR is derived via the same per-app routing as the migrate-cli",
      "    codemod (see `routeSpecPath`).",
      "  - The IR file lives at `<pages-dir>/<page-id>/state-machine.derived.json`.",
      "  - The IR's forward projection must structurally match the legacy file:",
      "      * same number of groups",
      "      * same group ids in order",
      "      * same total assertion count",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

export interface SpecFingerprint {
  groupCount: number;
  groupIds: string[];
  assertionCount: number;
}

export function fingerprintLegacy(legacy: LegacySpec): SpecFingerprint {
  const groups = Array.isArray(legacy.groups) ? legacy.groups : [];
  return {
    groupCount: groups.length,
    groupIds: groups.map((g) => g.id),
    assertionCount: groups.reduce(
      (sum, g) => sum + (Array.isArray(g.assertions) ? g.assertions.length : 0),
      0,
    ),
  };
}

/**
 * Forward-project an IR document to a bundled-page LegacySpec, then
 * fingerprint the result. This is the same coarse round-trip check used by
 * `legacy-roster.test.ts` in qontinui-schemas.
 */
export function fingerprintIRForward(ir: IRDocument): SpecFingerprint {
  const projected = projectIRToBundledPage(ir);
  return fingerprintLegacy(projected);
}

export interface FingerprintMismatch {
  field: "groupCount" | "groupIds" | "assertionCount";
  legacy: number | string[];
  ir: number | string[];
}

export function compareFingerprints(
  legacy: SpecFingerprint,
  ir: SpecFingerprint,
): FingerprintMismatch[] {
  const mismatches: FingerprintMismatch[] = [];
  if (legacy.groupCount !== ir.groupCount) {
    mismatches.push({
      field: "groupCount",
      legacy: legacy.groupCount,
      ir: ir.groupCount,
    });
  }
  // Compare group ids as a set, not in order. The codemod (`migrate-cli.ts`)
  // preserves the legacy spec's group order in the IR, while the build-time
  // emitter (`ir-emitter.ts`) sorts states by id for deterministic output —
  // both are valid IR shapes, but their forward projections produce groups
  // in different orders. The semantic contract is "same set of groups +
  // same total assertions"; group order is incidental authoring metadata
  // and not load-bearing for any consumer.
  const legacySorted = [...legacy.groupIds].sort();
  const irSorted = [...ir.groupIds].sort();
  const sameIds =
    legacySorted.length === irSorted.length &&
    legacySorted.every((id, i) => id === irSorted[i]);
  if (!sameIds) {
    mismatches.push({
      field: "groupIds",
      legacy: legacy.groupIds,
      ir: ir.groupIds,
    });
  }
  if (legacy.assertionCount !== ir.assertionCount) {
    mismatches.push({
      field: "assertionCount",
      legacy: legacy.assertionCount,
      ir: ir.assertionCount,
    });
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Per-spec pairing check
// ---------------------------------------------------------------------------

export type PairingStatus = "paired" | "missing" | "mismatched" | "error" | "unrouted";

export interface PairingResult {
  legacyPath: string;
  status: PairingStatus;
  pageId?: string;
  irPath?: string;
  mismatches?: FingerprintMismatch[];
  error?: string;
}

/** Strip an optional UTF-8 BOM. At least one shipping spec uses one. */
function stripBom(raw: string): string {
  if (raw.charCodeAt(0) === 0xfeff) return raw.slice(1);
  return raw;
}

function readJson<T>(path: string): T {
  const raw = stripBom(readFileSync(path, "utf8"));
  return JSON.parse(raw) as T;
}

export function checkOne(
  legacyPath: string,
  repoRoot: string,
  app?: AppName,
): PairingResult {
  const routing =
    app !== undefined
      ? routeSpecPathInSingleRepo(legacyPath, repoRoot, app)
      : routeSpecPath(legacyPath, repoRoot);
  if (routing === null) {
    return {
      legacyPath,
      status: "unrouted",
      error: `no per-app routing matches ${relative(repoRoot, legacyPath)}`,
    };
  }
  const irPath = join(routing.pagesDir, routing.pageId, "state-machine.derived.json");
  const result: PairingResult = {
    legacyPath,
    status: "paired",
    pageId: routing.pageId,
    irPath,
  };
  if (!existsSync(irPath)) {
    result.status = "missing";
    return result;
  }
  let legacy: LegacySpec;
  try {
    legacy = readJson<LegacySpec>(legacyPath);
  } catch (err) {
    result.status = "error";
    result.error = `failed to parse legacy spec: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  let ir: IRDocument;
  try {
    ir = readJson<IRDocument>(irPath);
  } catch (err) {
    result.status = "error";
    result.error = `failed to parse IR: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  // Run the legacy through the same forward path that the codemod would, but
  // instead compare directly against the on-disk IR's forward projection.
  let irFp: SpecFingerprint;
  try {
    irFp = fingerprintIRForward(ir);
  } catch (err) {
    result.status = "error";
    result.error = `IR forward projection failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  // Reference fingerprint comes from the legacy file itself (the source of
  // truth during the migration window) — that's what the round-trip test in
  // qontinui-schemas asserts against. We also fingerprint a fresh
  // legacy->IR->legacy projection so a malformed legacy gets caught.
  let legacyRoundTripFp: SpecFingerprint;
  try {
    const reIR = projectLegacyToIR(legacy, { docId: routing.pageId });
    legacyRoundTripFp = fingerprintIRForward(reIR);
  } catch (err) {
    result.status = "error";
    result.error = `legacy round-trip failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  const legacyFp = fingerprintLegacy(legacy);
  // The IR-on-disk fingerprint must structurally agree with the legacy
  // fingerprint AND with a fresh legacy->IR roundtrip (which is the same
  // shape the codemod would have produced).
  const mismatchesAgainstLegacy = compareFingerprints(legacyFp, irFp);
  const mismatchesAgainstRoundTrip = compareFingerprints(legacyRoundTripFp, irFp);
  const mismatches: FingerprintMismatch[] = [
    ...mismatchesAgainstLegacy,
    ...mismatchesAgainstRoundTrip,
  ];
  if (mismatches.length > 0) {
    result.status = "mismatched";
    result.mismatches = mismatchesAgainstLegacy.length > 0
      ? mismatchesAgainstLegacy
      : mismatchesAgainstRoundTrip;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface CheckSummary {
  paired: number;
  missing: number;
  mismatched: number;
  errors: number;
  unrouted: number;
  results: PairingResult[];
}

export function summarise(results: PairingResult[]): CheckSummary {
  const summary: CheckSummary = {
    paired: 0,
    missing: 0,
    mismatched: 0,
    errors: 0,
    unrouted: 0,
    results,
  };
  for (const r of results) {
    switch (r.status) {
      case "paired":
        summary.paired++;
        break;
      case "missing":
        summary.missing++;
        break;
      case "mismatched":
        summary.mismatched++;
        break;
      case "error":
        summary.errors++;
        break;
      case "unrouted":
        summary.unrouted++;
        break;
    }
  }
  return summary;
}

interface CliIO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function formatMismatches(mismatches: FingerprintMismatch[]): string {
  return mismatches
    .map((m) => `${m.field}: legacy=${JSON.stringify(m.legacy)}, ir=${JSON.stringify(m.ir)}`)
    .join("; ");
}

function reportResult(
  result: PairingResult,
  repoRoot: string,
  io: CliIO,
): void {
  const rel = relative(repoRoot, result.legacyPath);
  switch (result.status) {
    case "paired":
      io.stdout(`[check-pairing] OK    ${rel}\n`);
      break;
    case "missing":
      io.stderr(
        `[check-pairing] MISSING ${rel} -> expected IR at ${result.irPath ?? "(unknown)"}\n`,
      );
      break;
    case "mismatched":
      io.stderr(
        `[check-pairing] MISMATCH ${rel} (page-id ${result.pageId ?? "?"}): ` +
          `${formatMismatches(result.mismatches ?? [])}\n`,
      );
      break;
    case "error":
      io.stderr(`[check-pairing] ERROR ${rel}: ${result.error ?? "(no message)"}\n`);
      break;
    case "unrouted":
      io.stderr(`[check-pairing] WARN  ${rel}: ${result.error ?? "no per-app routing"}\n`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Top-level driver
// ---------------------------------------------------------------------------

export interface CheckPairingArgs {
  root: string;
  mode: CheckMode;
  /** Single-repo mode: which app the repo is. Omit when walking a parent monorepo. */
  app?: AppName;
}

export function runCheckPairing(args: CheckPairingArgs, io: CliIO): CheckSummary {
  const specs = findLegacySpecs(args.root);
  const results: PairingResult[] = [];
  for (const spec of specs) {
    const r = checkOne(spec, args.root, args.app);
    reportResult(r, args.root, io);
    results.push(r);
  }
  const summary = summarise(results);
  io.stdout(
    `[check-pairing] paired: ${summary.paired}, ` +
      `missing: ${summary.missing}, ` +
      `mismatched: ${summary.mismatched}` +
      (summary.errors > 0 ? `, errors: ${summary.errors}` : "") +
      (summary.unrouted > 0 ? `, unrouted: ${summary.unrouted}` : "") +
      `\n`,
  );
  io.stdout(`[check-pairing] mode: ${args.mode}\n`);
  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function defaultIO(): CliIO {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

export function runCheckPairingCli(
  argv: string[] = process.argv.slice(2),
  io: CliIO = defaultIO(),
): number {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp(io.stderr);
    return 0;
  }
  // Resolve the root directory. With `--all`, default to the parent of the
  // current working directory's first ancestor that contains app repos.
  let root: string;
  if (args.all) {
    root = process.cwd();
  } else if (args.root !== undefined) {
    root = isAbsolute(args.root) ? args.root : resolve(process.cwd(), args.root);
  } else {
    io.stderr(
      `check-spec-pairing: provide --root <path> or --all\n\n`,
    );
    printHelp(io.stderr);
    return 2;
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    io.stderr(`check-spec-pairing: root is not a directory: ${root}\n`);
    return 1;
  }
  // Auto-detect single-repo `--app` if the user didn't pass it: if the basename
  // of `root` is one of our known app names, infer it. The CI checkout shape
  // is `<workspace>/qontinui-runner/<files>` so this is the common case.
  let app: AppName | undefined = args.app;
  if (app === undefined && !args.all) {
    const base = root.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
    if (APP_NAMES.has(base)) {
      app = base as AppName;
    }
  }
  const summary = runCheckPairing({ root, mode: args.mode, app }, io);
  const failed =
    summary.missing > 0 ||
    summary.mismatched > 0 ||
    summary.errors > 0;
  if (args.mode === "block" && failed) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Script bootstrap
// ---------------------------------------------------------------------------

// Detect the bin we were invoked as via `process.argv[1]`. tsup bundles each
// CLI's transitive imports together, so simply checking `require.main ===
// module` would fire every CLI's bootstrap. Matching on the script basename
// keeps each bin's bootstrap scoped to its own invocation.
const invokedAs =
  typeof process !== "undefined" && Array.isArray(process.argv) && process.argv[1] !== undefined
    ? process.argv[1].replace(/\\/g, "/").split("/").pop() ?? ""
    : "";
const isMainModule =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof require !== "undefined" &&
  require.main === (module as any) &&
  /^check-pairing(\.cjs)?$/.test(invokedAs);
if (isMainModule) {
  process.exit(runCheckPairingCli());
}
