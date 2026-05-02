/**
 * Public surface for the counterfactual / model-checking engine.
 */

export {
  exploreCounterfactual,
  CounterfactualError,
} from "./explorer";

export {
  buildCausalIndex,
  forwardClosure,
  backwardClosure,
  type CausalIndex,
} from "./walker";

export type {
  Perturbation,
  DivergenceKind,
  RegressionFailureKind,
  DivergenceLike,
  CounterfactualDivergence,
  FragilityScore,
  CounterfactualReport,
} from "./types";
