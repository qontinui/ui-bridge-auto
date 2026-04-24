import { defineConfig } from "tsup";

// Enable `{ resolve: true }` on `dts` so type-resolution failures surface as
// hard build errors instead of being silently swallowed by the dts worker.
// This is the tsup-side half of the Phase 3 Item 8 guard — the other half
// is the `test -s dist/index.d.ts` post-check in the npm script.
export default defineConfig({
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
});
