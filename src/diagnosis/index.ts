/**
 * Self-diagnosis subpath (Section 10).
 *
 * Public surface for the failure diagnosis composer — turns regression run
 * results into actionable `SelfDiagnosis` reports. Re-exports from
 * `state/self-diagnosis.ts`; the source file stays in `state/` because it
 * is conceptually adjacent to the state machine, but the public subpath
 * lives here so consumers (e.g. qontinui-web) can pull in just the diagnosis
 * API without the full state machine runtime.
 */

export {
  diagnose,
  serializeDiagnosis,
  deserializeDiagnosis,
  surfaceDiagnosis,
  noopMemorySink,
  type RegressionFailure,
  type RegressionRunResult,
  type SelfDiagnosis,
  type DiagnoseOptions,
  type MemorySink,
} from "../state/self-diagnosis";
