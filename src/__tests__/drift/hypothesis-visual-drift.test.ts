/**
 * Test that `buildDriftHypotheses` consumes `DriftContext.visualDrift`
 * and produces a `visual drift cluster` hypothesis (Section 8).
 *
 * Mirrors the structural-drift integration test in `hypothesis.test.ts`
 * but on the visual path.
 */

import { describe, it, expect } from "vitest";
import type { IRDocument } from "@qontinui/shared-types/ui-bridge-ir";

import { buildDriftHypotheses } from "../../drift/hypothesis";
import type { DriftContext, GitCommitRef } from "../../drift/types";
import type { DriftReport } from "../../ir-builder/drift";
import type { RecordingSession } from "../../recording/session-recorder";

const FIXED_STARTED_AT = 1735689600000;

function buildSession(): RecordingSession {
  return {
    id: "fixture-session",
    startedAt: FIXED_STARTED_AT,
    events: [],
  };
}

function buildIR(): IRDocument {
  return {
    version: "1.0",
    id: "doc-1",
    name: "Doc 1",
    states: [],
    transitions: [
      {
        id: "submit-form-transition",
        name: "submit",
        fromStates: [],
        activateStates: [],
        actions: [],
        provenance: { source: "build-plugin", file: "src/forms/submit.tsx" },
      },
    ],
  };
}

describe("buildDriftHypotheses with visualDrift", () => {
  it("emits a `visual drift cluster` hypothesis for visual-drift entries", () => {
    const visualDrift: DriftReport = {
      states: [],
      transitions: [
        {
          id: "submit-form-transition",
          kind: "visual-drift",
          detail: "visual drift on submit-form-transition: 8.2% pixels differ",
        },
      ],
    };

    const commit: GitCommitRef = {
      sha: "a".repeat(40),
      message: "tweak submit form layout",
      author: "Alice",
      timestamp: Date.parse("2026-01-15T12:00:00Z"),
      files: ["src/forms/submit.tsx"],
    };

    const ctx: DriftContext = {
      session: buildSession(),
      ir: buildIR(),
      commits: [commit],
      visualDrift,
    };

    const hypotheses = buildDriftHypotheses([], ctx);
    const visual = hypotheses.find((h) =>
      h.hypothesis.startsWith("visual drift cluster"),
    );
    expect(visual).toBeDefined();
    expect(visual?.suspectedFiles).toEqual(["src/forms/submit.tsx"]);
    expect(visual?.suspectedCommits[0]?.sha).toBe(commit.sha);
    expect(visual?.confidence).toBeGreaterThan(0);
    // Visual entry weight is 0.5 vs structural's 1.0 — confidence should be
    // bounded but non-zero with one entry on a touched file.
    expect(visual?.confidence).toBeLessThanOrEqual(1);
  });

  it("returns no visual-drift hypothesis when visualDrift is omitted", () => {
    const ctx: DriftContext = {
      session: buildSession(),
      commits: [],
    };
    const hypotheses = buildDriftHypotheses([], ctx);
    expect(
      hypotheses.find((h) => h.hypothesis.startsWith("visual drift cluster")),
    ).toBeUndefined();
  });

  it("ranks visual-drift cluster lower than a structural cluster on the same file", () => {
    // Same file backs both clusters; structural drift weighs 2× per entry.
    const sameFile = "src/forms/submit.tsx";

    const specDrift: DriftReport = {
      states: [],
      transitions: [
        {
          id: "submit-form-transition",
          kind: "missing-in-runtime",
          detail: "structural drift",
        },
      ],
    };
    const visualDrift: DriftReport = {
      states: [],
      transitions: [
        {
          id: "submit-form-transition",
          kind: "visual-drift",
          detail: "visual drift",
        },
      ],
    };
    const commit: GitCommitRef = {
      sha: "a".repeat(40),
      message: "edit submit",
      author: "Alice",
      timestamp: Date.parse("2026-01-15T12:00:00Z"),
      files: [sameFile],
    };

    const ctx: DriftContext = {
      session: buildSession(),
      ir: buildIR(),
      commits: [commit],
      specDrift,
      visualDrift,
    };

    const hypotheses = buildDriftHypotheses([], ctx);
    const spec = hypotheses.find((h) =>
      h.hypothesis.startsWith("spec drift cluster"),
    );
    const visual = hypotheses.find((h) =>
      h.hypothesis.startsWith("visual drift cluster"),
    );
    expect(spec).toBeDefined();
    expect(visual).toBeDefined();
    expect(spec!.confidence).toBeGreaterThan(visual!.confidence);
  });
});
