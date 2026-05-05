# ui-bridge-auto/scripts

## check-dts-completeness.js

Build post-check: walks `package.json#exports`, confirms every subpath's
declared `types` entry exists and is non-empty in `dist/`. Exits 1 on
the first missing or empty `.d.ts` / `.d.mts`.

```bash
node scripts/check-dts-completeness.js
```

Wired into `npm run build` after `tsup`. Catches the class of bug where
tsup announces dts files in its build log but they don't actually make
it to disk (see the ir-builder regression in 0.1.4). The npm-script half
of the Phase 3 Item 8 guard — the tsup-side half is `dts: { resolve: true }`
in `tsup.config.ts`.

If a subpath is intentionally runtime-only, drop its `types` entries
from `package.json#exports` rather than suppress the check.

## verify-published.js

Spot-checks that a version of `@qontinui/ui-bridge-auto` on the npm
registry is actually consumable. Runs in a fresh temp directory with NO
sibling-symlink / dev-link overlay — what gets tested is unambiguously
the registry artifact, not whatever happens to be in the local sibling.

### Usage

```bash
npm run verify-published                              # latest
node scripts/verify-published.js 0.1.4                # specific version
node scripts/verify-published.js 0.1.4 --keep         # leave temp dir for inspection
```

Exits 0 on success, non-zero on any failure (require() throws, missing
subpath export, type errors in the stub).

### What it does

1. `npm init -y` + `npm install @qontinui/ui-bridge-auto@<version> typescript@5`
   in a fresh temp directory.
2. `node -e "require('@qontinui/ui-bridge-auto/<subpath>')"` for each of
   the 9 subpath exports — confirms `package.json#exports` resolves to
   files that actually exist in the tarball.
3. `tsc --noEmit` against a generated stub that imports a representative
   symbol from each subpath — confirms `.d.ts`/`.d.mts` files are present
   and exporting the expected surface.
4. Prints a PASS/FAIL summary and exits.

The `tsconfig.json` it generates uses `moduleResolution: "node16"` so the
package.json `exports` field is honored (legacy `"node"` resolution
ignores `exports` and looks for `dist/types/index.d.ts` directly,
producing false negatives on subpath types).

### When to run it

After every `npm publish` of `@qontinui/ui-bridge-auto`, **and before**
claiming "consumers still resolve" in the publish AFTER.md. The
in-tree consumer spot-checks (`pnpm install` + `pnpm run typecheck` in
`qontinui-runner` / `qontinui-web/frontend`) are tautological under
`dev-link.ps1`'s symlink overlay — both consumers'
`node_modules/@qontinui/ui-bridge-auto` is a symlink to the local
sibling, so the typecheck never touches the published artifact.

For the corrected publish playbook see `../CLAUDE.md` → "Publishing".

### Maintaining the SUBPATHS list

`SUBPATHS` at the top of `verify-published.js` must stay in sync with
`package.json#exports`. When a new subpath is added or a representative
symbol is renamed, update this list.

If a subpath ships JS but not `.d.ts` (intentionally or not), mark it
`runtimeOnly: true` and link the followup that should remove the flag.
This is currently the case for `./ir-builder` (see comment in the file).
