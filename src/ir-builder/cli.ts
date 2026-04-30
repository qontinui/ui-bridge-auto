#!/usr/bin/env node
/**
 * Standalone CLI for building IR documents.
 *
 * Use case: Next.js / Webpack / Metro projects (any non-Vite build) that want
 * the same IR emission as the Vite plugin. Wire as a `prebuild` script:
 *
 * ```json
 * // package.json
 * {
 *   "scripts": {
 *     "build-ir": "ui-bridge-build-ir --document-id=app --document-name='App State Machine'",
 *     "prebuild": "npm run build-ir",
 *     "predev": "npm run build-ir"
 *   }
 * }
 * ```
 *
 * Per decision #8 (locked): Next.js gets the build-step path first. A
 * Turbopack-native plugin can layer on top later without changing this CLI's
 * contract — both paths emit byte-identical output via `writeProjectIR`.
 *
 * Args:
 * - `--document-id=<string>`     (required) IR document id
 * - `--document-name=<string>`   (required) IR document name
 * - `--description=<string>`     (optional) IR description
 * - `--out=<path>`               (optional) output path; default `src/state-machine.derived.json`
 * - `--include=<glob>`           (optional, repeatable) include pattern; default `src/**\/*.tsx`
 * - `--project-root=<path>`      (optional) project root; default `process.cwd()`
 * - `--tsconfig=<path>`          (optional) tsconfig.json relative to project root
 *
 * Exits non-zero on extractor errors (e.g., duplicate IDs).
 */

import { writeProjectIR } from "./build-project-ir";

interface ParsedArgs {
  documentId?: string;
  documentName?: string;
  description?: string;
  outFile?: string;
  include?: string[];
  projectRoot?: string;
  tsconfigPath?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    const eq = arg.indexOf("=");
    if (!arg.startsWith("--") || eq === -1) continue;
    const key = arg.slice(2, eq);
    const val = arg.slice(eq + 1);
    switch (key) {
      case "document-id":
        out.documentId = val;
        break;
      case "document-name":
        out.documentName = val;
        break;
      case "description":
        out.description = val;
        break;
      case "out":
        out.outFile = val;
        break;
      case "include":
        out.include = out.include ?? [];
        out.include.push(val);
        break;
      case "project-root":
        out.projectRoot = val;
        break;
      case "tsconfig":
        out.tsconfigPath = val;
        break;
    }
  }
  return out;
}

function printHelp(): void {
  process.stderr.write(
    [
      "ui-bridge-build-ir — emit a UI Bridge IR document",
      "",
      "Required:",
      "  --document-id=<string>     IR document id",
      "  --document-name=<string>   IR document name",
      "",
      "Optional:",
      "  --description=<string>",
      "  --out=<path>               default: src/state-machine.derived.json",
      "  --include=<glob>           repeatable; default: src/**/*.tsx",
      "  --project-root=<path>      default: cwd",
      "  --tsconfig=<path>",
      "",
    ].join("\n"),
  );
}

export function runCli(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  if (!args.documentId || !args.documentName) {
    process.stderr.write(
      "ui-bridge-build-ir: --document-id and --document-name are required\n\n",
    );
    printHelp();
    return 2;
  }

  try {
    const result = writeProjectIR({
      documentId: args.documentId,
      documentName: args.documentName,
      description: args.description,
      outFile: args.outFile,
      include: args.include,
      projectRoot: args.projectRoot,
      tsconfigPath: args.tsconfigPath,
    });
    process.stdout.write(
      `[ui-bridge-ir] wrote ${result.outFile} (${result.scannedFiles.length} files scanned, ${result.warnings.length} warning(s))\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `[ui-bridge-ir] build failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }
}

// Run only when invoked as a script, not when imported.
const isMainModule =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof require !== "undefined" && require.main === (module as any);
if (isMainModule) {
  process.exit(runCli());
}
