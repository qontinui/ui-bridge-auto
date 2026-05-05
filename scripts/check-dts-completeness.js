#!/usr/bin/env node
// check-dts-completeness.js -- Local build post-check.
//
// Walks `package.json#exports`, finds every subpath's declared `types`
// entry under `import` and `require`, and confirms each file exists and
// is non-empty in `dist/`. Fails loud (exit 1) on the first missing or
// empty .d.ts.
//
// Wired into `npm run build` after `tsup`. The npm-script-half of the
// Phase 3 Item 8 guard — the tsup-side half is `dts: { resolve: true }`
// in `tsup.config.ts`, which makes type-resolution failures surface as
// build errors instead of silently dropping output.
//
// Why this exists: tsup announces dts files in its build log even when
// they don't make it to disk (see ui-bridge-auto-ir-builder-dts-missing
// session). The single-file `dist/index.d.ts` size check we had before
// only protected the root barrel; subpath dts regressions could ship
// silently and only surface via `npm run verify-published` against the
// published tarball. This catches the same class of bug at build time.
//
// Exits 0 on success, 1 on first missing/empty file.

const fs = require("node:fs");
const path = require("node:path");

const PKG_ROOT = path.resolve(__dirname, "..");
const DIST_ROOT = path.join(PKG_ROOT, "dist");

function collectTypePaths(exportsField) {
    const paths = [];
    for (const [subpath, value] of Object.entries(exportsField)) {
        if (!value || typeof value !== "object") continue;
        for (const conditional of ["import", "require"]) {
            const types = value[conditional]?.types;
            if (typeof types === "string") {
                paths.push({ subpath, conditional, types });
            }
        }
    }
    return paths;
}

function main() {
    const pkg = JSON.parse(
        fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"),
    );
    if (!pkg.exports) {
        console.error("package.json has no `exports` field — nothing to check.");
        process.exit(1);
    }

    const entries = collectTypePaths(pkg.exports);
    if (entries.length === 0) {
        console.error("No `types` entries found under `exports.*.{import,require}`.");
        process.exit(1);
    }

    const failures = [];
    for (const { subpath, conditional, types } of entries) {
        const abs = path.join(PKG_ROOT, types);
        let stat;
        try {
            stat = fs.statSync(abs);
        } catch (err) {
            failures.push(`MISSING  ${subpath} (${conditional}.types): ${types}`);
            continue;
        }
        if (!stat.isFile()) {
            failures.push(`NOT-FILE ${subpath} (${conditional}.types): ${types}`);
        } else if (stat.size === 0) {
            failures.push(`EMPTY    ${subpath} (${conditional}.types): ${types}`);
        }
    }

    if (failures.length === 0) {
        console.log(
            `dts-completeness: OK  (${entries.length} type entries verified across ${
                new Set(entries.map((e) => e.subpath)).size
            } subpaths)`,
        );
        process.exit(0);
    }

    console.error(`dts-completeness: FAIL  ${failures.length} issue(s):`);
    failures.forEach((f) => console.error(`  ${f}`));
    console.error(
        `\nDist root: ${DIST_ROOT}\n` +
            `If a subpath is intentionally runtime-only, remove its \`types\` entries from\n` +
            `package.json#exports — don't suppress this check.`,
    );
    process.exit(1);
}

main();
