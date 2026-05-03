import { defineConfig } from "tsup";

// Enable `{ resolve: true }` on `dts` so type-resolution failures surface as
// hard build errors instead of being silently swallowed by the dts worker.
// This is the tsup-side half of the Phase 3 Item 8 guard — the other half
// is the `test -s dist/index.d.ts` post-check in the npm script.
//
// Three logical bundles are emitted:
//   1. Library entries — the root `src/index.ts` plus per-subpath barrels
//      (`types`, `drift`, `regression`, `diagnosis`, `visual`, `runtime`).
//      Emitted as CJS + ESM + DTS so consumers can import the slice they
//      need without dragging the full DOM execution engine into their
//      bundle. See `package.json#exports` for the public mapping.
//   2. CLI entries (`src/ir-builder/cli.ts`, `src/ir-builder/migrate-cli.ts`,
//      `src/ir-builder/check-pairing.ts`) bundled to `dist/ir-builder/*.cjs`
//      so they can be invoked directly via the `bin` field in package.json.
//   3. IR-builder library subpath — exposes the Vite plugin / extractor /
//      emitter / build-project-ir / drift comparator as
//      `@qontinui/ui-bridge-auto/ir-builder`. Kept off the main entry so
//      the Node-only deps (`node:fs`, `node:path`, `ts-morph`) don't leak
//      into a browser bundle when the runner's Vite alias resolves the
//      package to source.
export default defineConfig([
  {
    // Per-subpath entry points. Each becomes `dist/<name>.{js,mjs,d.ts}` —
    // tsup deduplicates shared chunks across entries automatically, so the
    // total dist size is roughly the same as a single bundle, but consumers
    // can tree-shake at the subpath boundary.
    entry: {
      index: "src/index.ts",
      "types/index": "src/types/index.ts",
      "drift/index": "src/drift/index.ts",
      "drift/node": "src/drift/node.ts",
      "regression/index": "src/regression/index.ts",
      "diagnosis/index": "src/diagnosis/index.ts",
      "visual/index": "src/visual/index.ts",
      "runtime/index": "src/runtime/index.ts",
    },
    format: ["cjs", "esm"],
    dts: { resolve: true },
    clean: true,
    sourcemap: true,
    external: [
      "@qontinui/ui-bridge",
      "ts-morph",
      "@ts-morph/common",
      "@anthropic-ai/sdk",
    ],
  },
  {
    entry: {
      "ir-builder/cli": "src/ir-builder/cli.ts",
      "ir-builder/migrate-cli": "src/ir-builder/migrate-cli.ts",
      "ir-builder/check-pairing": "src/ir-builder/check-pairing.ts",
    },
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    dts: false,
    // Don't clean — we share the dist dir with the library build above; the
    // first config (which runs first) already cleans.
    clean: false,
    sourcemap: true,
    // tsup preserves the source shebang in the bundle output, so no banner is
    // needed — adding `banner: { js: "#!/usr/bin/env node" }` would duplicate
    // the shebang and break Node parsing.
    external: [
      "@qontinui/ui-bridge",
      "ts-morph",
      "@ts-morph/common",
      "@anthropic-ai/sdk",
    ],
  },
  // ir-builder library subpath
  {
    entry: { "ir-builder/index": "src/ir-builder/index.ts" },
    format: ["cjs", "esm"],
    dts: { resolve: true },
    clean: false,
    sourcemap: true,
    external: [
      "@qontinui/ui-bridge",
      "ts-morph",
      "@ts-morph/common",
      "@anthropic-ai/sdk",
    ],
  },
]);
