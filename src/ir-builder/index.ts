/**
 * IR builder — public API.
 *
 * Walks `<State>` / `<TransitionTo>` JSX declarations in a project's TSX
 * source files and produces a deterministic IR JSON file describing the
 * page's states and transitions. See `qontinui-dev-notes/ui-bridge-redesign/`
 * Section 1, Phase 5 for the broader pipeline.
 */

// Extractor
export type {
  ExtractedDeclaration,
  UnsupportedPropMarker,
} from "./extractor";
export {
  extractIRDeclarations,
  isUnsupportedProp,
  UNSUPPORTED_PROP,
} from "./extractor";

// Emitter
export type {
  BuildIRDocumentInput,
  IRBuildResult,
  IRBuildWarning,
} from "./ir-emitter";
export {
  buildIRDocument,
  buildIRDocumentWithWarnings,
  serializeIRDocument,
  IRBuildError,
} from "./ir-emitter";

// Vite plugin
export type {
  IRBuilderPluginOptions,
  VitePluginLike,
} from "./vite-plugin";
export { uiBridgeIRPlugin } from "./vite-plugin";

// Framework-agnostic project-level builder (used by the Vite plugin AND the
// Next.js / standalone CLI path — single source of truth so output is
// byte-identical across both build paths).
export type {
  BuildProjectIROptions,
  BuildProjectIRResult,
} from "./build-project-ir";
export { buildProjectIR, writeProjectIR } from "./build-project-ir";

// Drift comparator — pure-function diff between authored IR and the live
// runtime snapshot. Consumed by section 7's drift-hypothesis correlation.
export type { DriftEntry, DriftReport, RuntimeSnapshot } from "./drift";
export { compareSpecToRuntime } from "./drift";

// Phase A3 codemod CLI — legacy `*.spec.uibridge.json` -> per-page IR layout.
export type { MigrationOutcome, SpecRouting } from "./migrate-cli";
export {
  derivePageIdFromBasename,
  derivePageIdFromWebPath,
  findLegacySpecs,
  routeSpecPath,
  runMigrateCli,
} from "./migrate-cli";
