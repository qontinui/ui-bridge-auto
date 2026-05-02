# @qontinui/ui-bridge-auto

DOM-based model-based automation library for the UI Bridge SDK.

This package is both a library (consumed at runtime by `qontinui-runner`) and a
toolbox of CLI utilities (used by spec-pairing CI in the consumer repos).

## Installation

```bash
npm install @qontinui/ui-bridge-auto
```

## CLI usage (no install)

The package ships three CLI bins. They can be invoked via `npx` without a local
install — useful in CI workflows that just need the tooling:

```bash
# Build the IR bundle for a page tree
npx @qontinui/ui-bridge-auto ui-bridge-build-ir --root .

# Codemod a legacy spec into the new IR shape
npx @qontinui/ui-bridge-auto migrate-uibridge-spec <path>

# Check that every page has both a legacy spec and an IR companion (used in
# spec-pairing.yml across the qontinui-runner / web / mobile / supervisor repos)
npx @qontinui/ui-bridge-auto check-spec-pairing --root .
```

Each consumer's `.github/workflows/spec-pairing.yml` invokes
`check-spec-pairing` via `npx` so the tooling does not require a sibling-repo
clone in CI.

## Releasing

Releases are tag-triggered. Pushing a tag matching `v*` to GitHub fires the
`.github/workflows/publish.yml` workflow, which runs `npm ci`, `npm run build`,
and `npm publish --access public` against `https://registry.npmjs.org` using
the `NPM_TOKEN` org secret.

To cut a release:

```bash
# 1. Bump the version (npm updates package.json + package-lock.json + creates a tag)
npm version patch    # or: minor / major / 0.2.0

# 2. Push the commit and the tag
git push origin master
git push origin --tags
```

CI then publishes the new version. You can also tag manually:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Local development (linking against a consumer)

To pick up local changes in a consumer without publishing, use `npm link`:

```bash
# In this repo
cd ui-bridge-auto
npm link

# In the consumer repo (e.g. qontinui-runner)
npm link @qontinui/ui-bridge-auto
```

To unlink later:

```bash
# In the consumer
npm unlink --no-save @qontinui/ui-bridge-auto
npm install

# In this repo
npm unlink
```

## License

AGPL-3.0-or-later
