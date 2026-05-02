import { defineConfig } from "tsup";

// Enable `{ resolve: true }` on `dts` so type-resolution failures surface as
// hard build errors instead of being silently swallowed by the dts worker.
// This is the tsup-side half of the Phase 3 Item 8 guard — the other half
// is the `test -s dist/index.d.ts` post-check in the npm script.
//
// Two configs are emitted:
//   1. Library entry (`src/index.ts`) — CJS + ESM + DTS.
//   2. CLI entries (`src/ir-builder/cli.ts`, `src/ir-builder/migrate-cli.ts`)
//      bundled to `dist/ir-builder/*.cjs` so they can be invoked directly via
//      the `bin` field in package.json.
export default defineConfig([
  {
    entry: ["src/index.ts"],
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
  // Metro plugin — emitted as a standalone CJS file so consumers can require
  // it directly from `metro.config.js` (which is CJS by Metro convention).
  {
    entry: {
      "ir-builder/metro-plugin": "src/ir-builder/metro-plugin.ts",
    },
    format: ["cjs"],
    outExtension: () => ({ js: ".cjs" }),
    dts: false,
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
