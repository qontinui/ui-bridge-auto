/**
 * Shared test helpers for IR fixture construction.
 *
 * Keep this file zero-dep: tests across the package import these helpers to
 * build `IRAssertion`s without each fixture re-declaring the same shape.
 */

import type { IRAssertion } from "@qontinui/shared-types/ui-bridge-ir";

/**
 * Build a deterministic `IRAssertion` from a state id + index + raw criteria.
 *
 * Tests that previously used `requiredElements: IRElementCriteria[]` (now
 * removed from `IRState`) lift each criterion into a synthesized assertion via
 * this helper. The shape mirrors what synthesis would emit, but the metadata
 * is fixed (`source: "test-fixture"`) so fixtures stay deterministic.
 */
export function makeTestAssertion(
  stateId: string,
  idx: number,
  criteria: Record<string, unknown>,
): IRAssertion {
  return {
    id: `${stateId}-elem-${idx}`,
    description: `Required element ${idx}`,
    category: "element-presence",
    severity: "critical",
    assertionType: "exists",
    target: { type: "search", criteria, label: `Required element ${idx}` },
    source: "test-fixture",
    reviewed: false,
    enabled: true,
  };
}
