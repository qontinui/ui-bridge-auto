/**
 * Auto-regression generator subpath (Section 9).
 *
 * Public surface for the deterministic regression suite generator + serializer
 * + coverage report + assertion overlays. This barrel re-exports from
 * `state/regression-generator.ts` and `state/regression-overlays.ts` — the
 * source files stay in `state/` because they depend on adjacent state code,
 * but the public subpath lives here so consumers can opt into just the
 * regression API without pulling in the rest of the state machine runtime.
 */

export {
  generateRegressionSuite,
  serializeSuite,
  deserializeSuite,
  coverageOf,
  deriveBaselineKey,
  type RegressionSuite,
  type RegressionCase,
  type RegressionAssertion,
  type StateActiveAssertion,
  type ActionTargetResolvesAssertion,
  type VisualGateAssertion,
  type OverlayAssertion,
  type AssertionOverlay,
  type AssertionOverlayContext,
  type GeneratorOptions,
  type BaselineStoreMarker,
  type CoverageReport,
} from "../state/regression-generator";

export {
  visibilityOverlay,
  tokenOverlay,
  crossCheckOverlay,
  type VisibilityOverlayOptions,
  type CrossCheckOverlayOptions,
} from "../state/regression-overlays";

// Section 11 — scenario projection (B1).
export {
  projectScenarios,
  projectCurrentScenario,
  type ScenarioProjection,
  type ProjectedState,
  type ProjectedTransition,
  type AvailableTransition,
  type BlockedTransition,
  type CurrentScenarioProjection,
  type ProjectCurrentScenarioOptions,
  type Projection,
} from "../state/scenario-projection";

// Section 11 — coverage diff (C1).
export {
  coverageDiff,
  type CoverageDiffReport,
  type AssertionExecution,
  type AssertionRef,
  type TransitionRef,
} from "../state/coverage-diff";
