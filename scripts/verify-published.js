#!/usr/bin/env node
// verify-published.js -- Spot-check the freshly-published @qontinui/ui-bridge-auto.
//
// Validates that a version on the npm registry is actually consumable. Runs
// in a fresh temp directory with NO sibling-symlink / dev-link overlay, so
// what gets tested is unambiguously the registry artifact — not whatever
// happens to be in the local sibling.
//
// Why this exists: the previous post-publish "consumer spot-check" (run
// `pnpm install` + `tsc --noEmit` in qontinui-runner / qontinui-web) was
// tautological. Both consumers' node_modules/@qontinui/* are symlinked to
// local sibling directories by qontinui-claude-config/scripts/dev-link.ps1,
// so the typecheck never touched the published artifact. See
// _dev-notes-main/consumer-spot-check-against-published-npm/ for full context.
//
// Usage:
//   npm run verify-published                             # latest
//   node scripts/verify-published.js 0.1.4
//   node scripts/verify-published.js 0.1.4 --keep        # leave temp dir for inspection
//
// Exits 0 on success, non-zero on failure.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const PKG = "@qontinui/ui-bridge-auto";

// Subpath exports to validate. Must stay in sync with package.json `exports`.
//
//   kind: "type"        → `import type { X } from '...'`
//   kind: "namespace"   → `import * as X from '...'` (used for the root
//                         barrel to avoid name collisions, since it
//                         re-exports everything from the subpaths)
//   kind: "value"       → `import { X } from '...'`
//
//   runtimeOnly: true   → check `require()` works but skip the typecheck
//                         stub. Use sparingly — see the comment on each
//                         entry below for the followup that should remove
//                         the flag.
const SUBPATHS = [
    { path: ".",            alias:  "RootBarrel",              kind: "namespace" },
    { path: "./types",      symbol: "AutomationElement",       kind: "type"      },
    { path: "./drift",      symbol: "compareSpecToRuntime",    kind: "value"     },
    { path: "./drift/node", symbol: "defaultRunGit",           kind: "value"     },
    { path: "./regression", symbol: "generateRegressionSuite", kind: "value"     },
    { path: "./diagnosis",  symbol: "diagnose",                kind: "value"     },
    { path: "./visual",     symbol: "checkDesignTokens",       kind: "value"     },
    { path: "./runtime",    symbol: "findFirst",               kind: "value"     },
    // ./ir-builder ships JS only — `dist/ir-builder/index.d.{ts,mts}` is
    // missing from 0.1.4 (likely tsup's dts resolver silently dropping
    // output because of the `ts-morph` external). Verified at runtime;
    // skipped from the typecheck stub. Drop `runtimeOnly` once a future
    // ui-bridge-auto release ships `./ir-builder` .d.ts files.
    { path: "./ir-builder", symbol: "buildIR",                 kind: "value", runtimeOnly: true },
];

function importTarget(p) {
    return p === "." ? PKG : `${PKG}/${p.replace(/^\.\//, "")}`;
}

function run(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, {
        stdio: opts.captureOutput ? "pipe" : "inherit",
        cwd: opts.cwd,
        shell: process.platform === "win32",
        encoding: "utf8",
    });
    if (result.error) throw result.error;
    return result;
}

function main() {
    const args = process.argv.slice(2);
    const keep = args.includes("--keep");
    const version = args.find((a) => !a.startsWith("--")) ?? "latest";

    const tempDir = path.join(
        os.tmpdir(),
        `ui-bridge-auto-verify-${crypto.randomBytes(4).toString("hex")}`,
    );
    fs.mkdirSync(tempDir, { recursive: true });
    console.log(`Temp workspace: ${tempDir}`);

    const failures = [];

    try {
        // 1. Init + install -----------------------------------------------
        console.log(`\n[1/4] npm init + install ${PKG}@${version} + typescript`);
        let r = run("npm", ["init", "-y", "--silent"], { cwd: tempDir });
        if (r.status !== 0) throw new Error(`npm init failed (exit ${r.status})`);

        r = run(
            "npm",
            ["install", "--silent", "--no-audit", "--no-fund", `${PKG}@${version}`, "typescript@5"],
            { cwd: tempDir },
        );
        if (r.status !== 0) throw new Error(`npm install failed (exit ${r.status})`);

        const installedPkg = JSON.parse(
            fs.readFileSync(path.join(tempDir, "node_modules", PKG, "package.json"), "utf8"),
        );
        console.log(`Installed: ${PKG}@${installedPkg.version}`);

        // 2. require() each subpath in node -------------------------------
        console.log(`\n[2/4] node require() for each subpath export`);
        for (const s of SUBPATHS) {
            const target = importTarget(s.path);
            r = run("node", ["-e", `require('${target}')`], {
                cwd: tempDir,
                captureOutput: true,
            });
            if (r.status === 0) {
                console.log(`  ok   ${target}`);
            } else {
                console.log(`  FAIL ${target}`);
                const out = (r.stderr || r.stdout || "").trim();
                if (out) out.split("\n").forEach((line) => console.log(`       ${line}`));
                failures.push(`require('${target}')`);
            }
        }

        // 3. tsc --noEmit on a generated stub -----------------------------
        const typecheckSubpaths = SUBPATHS.filter((s) => !s.runtimeOnly);
        console.log(
            `\n[3/4] tsc --noEmit on a stub importing ${typecheckSubpaths.length}/${SUBPATHS.length} subpaths` +
                (typecheckSubpaths.length < SUBPATHS.length ? " (rest runtime-only)" : ""),
        );
        const stubLines = ["// Auto-generated by verify-published.js"];
        for (const s of typecheckSubpaths) {
            const target = importTarget(s.path);
            if (s.kind === "type") {
                stubLines.push(`import type { ${s.symbol} } from '${target}';`);
            } else if (s.kind === "namespace") {
                stubLines.push(`import * as ${s.alias} from '${target}';`);
            } else {
                stubLines.push(`import { ${s.symbol} } from '${target}';`);
            }
        }
        const refList = typecheckSubpaths
            .map((s) => {
                if (s.kind === "type")      return `null /* ${s.symbol} */`;
                if (s.kind === "namespace") return s.alias;
                return s.symbol;
            })
            .join(", ");
        stubLines.push(`void [${refList}];`);
        fs.writeFileSync(path.join(tempDir, "stub.ts"), stubLines.join("\n"));

        // moduleResolution must be node16/nodenext/bundler to honor subpath
        // exports — `node` (the legacy default) ignores the package.json
        // `exports` field and looks for `dist/types/index.d.ts` directly.
        const tsconfig = {
            compilerOptions: {
                target: "ES2020",
                module: "Node16",
                moduleResolution: "node16",
                esModuleInterop: true,
                skipLibCheck: true,
                strict: true,
                noEmit: true,
            },
            include: ["stub.ts"],
        };
        fs.writeFileSync(
            path.join(tempDir, "tsconfig.json"),
            JSON.stringify(tsconfig, null, 2),
        );

        r = run("npx", ["--no-install", "tsc", "--noEmit"], { cwd: tempDir });
        if (r.status === 0) {
            console.log("  tsc clean");
        } else {
            console.log("  tsc reported errors");
            failures.push("tsc --noEmit");
        }

        // 4. Summary ------------------------------------------------------
        console.log(`\n[4/4] Summary`);
        if (failures.length === 0) {
            console.log(`PASS  ${PKG}@${installedPkg.version} verified clean (subpath loads + typecheck)`);
        } else {
            console.log(`FAIL  ${PKG}@${installedPkg.version} has ${failures.length} issue(s):`);
            failures.forEach((f) => console.log(`  - ${f}`));
        }
    } finally {
        if (keep) {
            console.log(`\nLeaving temp workspace at: ${tempDir}`);
        } else {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    process.exit(failures.length === 0 ? 0 : 1);
}

main();
