# ui-bridge-auto

DOM-based model-based automation library for the UI Bridge SDK.

## What This Is

A TypeScript library that provides model-based GUI automation purpose-built for DOM-based element interaction. Unlike the qontinui Python library (which uses visual/screenshot-based automation), this library operates on the DOM directly — element finding is cheap, deterministic, and event-driven.

## Architecture

```
ui-bridge-auto (this package)
    ↓ imports types + registry
@qontinui/ui-bridge (UI Bridge SDK)
    ↓ provides
DOM element registry, actions, events
```

## Key Design Principles

1. **DOM-native identification** — no visual/image matching, no heavy dependencies. Elements are found by structural properties (role, text, ARIA, attributes).
2. **Event-driven state management** — subscribe to registry change events, not poll. States update reactively as elements appear/disappear.
3. **Cheap full-element evaluation** — evaluate ALL states on every DOM change (elements are in-memory, not screenshots).
4. **Deterministic element resolution** — exact match or nothing. No confidence scores, no fuzzy cascades.

## Module Structure

```
src/
├── types/          # Core domain types (element, state, transition, action, match, region) — zero-dep
├── config/         # Configuration schemas (workflow, action defaults, search config)
├── core/           # Query engine + automation engine
├── runtime/        # Execution engine: findFirst, executeQuery, registry adapters
├── state/          # State machine + Sections 9–11 pure fns (regression-generator,
│                   #   regression-overlays, scenario-projection, coverage-diff,
│                   #   self-diagnosis, state-detector, pathfinder, transition-executor)
├── ir-builder/     # AST extractor + Vite plugin + standalone CLI (the only `bin` left)
├── drift/          # Spec/runtime drift comparison + visual drift + hypothesis builder
├── regression/     # Subpath barrel re-exporting Section 9+11 from state/
├── diagnosis/      # Subpath barrel re-exporting self-diagnosis from state/
├── counterfactual/ # Section 6: counterfactual exploration primitives
├── visual/         # Highlights, OCR assertions, coordinates, screenshots, design-token check
├── recording/      # Section 5 substrate (capture sessions, fragility scoring)
├── healing/        # Section 7 substrate (drift hypotheses, self-healing)
├── execution/      # Graph-based workflow execution (WU-5)
├── resolution/     # Element resolution helpers
├── actions/        # Action chain primitives
├── batch/          # Action sequences + named flows
├── wait/           # Wait primitives (element, state, idle, condition)
├── discovery/      # Overlay detection, stable IDs, element fingerprinting
├── server/         # HTTP endpoint handlers (in-process; consumers integrate via runner Spec API)
├── test-utils/     # Mock registry, elements, executor for testing
└── __tests__/      # Test suites (vitest + jsdom)
```

**Section 12 deletions (ADR-012 sibling).** The legacy `static-builder/` directory, the `migrate-cli` and `check-pairing` bin entries, and their tests are gone. Only `ir-builder/cli.ts` (`ui-bridge-build-ir`) remains as a `bin`. The IR is the only authoring surface; AI-inference / static-build paths are deleted, not deprecated.

## Subpath Exports

Consumers should import the narrowest surface they need. The CI bundle-analyzer guards `./types` and `./drift` to enforce browser safety (zero `jsdom` / `canvas` / `child_process` imports).

| Subpath | What it exposes |
|---|---|
| `@qontinui/ui-bridge-auto/types` | Element / state / transition / region / match / action types — browser-safe |
| `@qontinui/ui-bridge-auto/drift` | `compareSpecToRuntime`, `runVisualDrift`, `asDriftReport`, `buildDriftHypotheses`, `DriftReport`/`DriftEntry` — browser-safe |
| `@qontinui/ui-bridge-auto/drift/node` | `defaultRunGit` and Node-only drift helpers — hoisted out of `./drift` |
| `@qontinui/ui-bridge-auto/regression` | `generateRegressionSuite`, `serializeSuite`, `coverageOf`, `coverageDiff`, `projectScenarios`, `projectCurrentScenario` |
| `@qontinui/ui-bridge-auto/diagnosis` | `diagnose`, `MemorySink`, `serializeDiagnosis`, `noopMemorySink` |
| `@qontinui/ui-bridge-auto/visual` | Screenshot assertion, baseline store, visibility, OCR cross-check, `checkDesignTokens`, `crossCheckText` |
| `@qontinui/ui-bridge-auto/runtime` | Execution engine: `findFirst`, `executeQuery`, registry adapters |
| `@qontinui/ui-bridge-auto/ir-builder` | AST extractor, Vite plugin, IR emitter, standalone CLI |

The monolithic root export still resolves for back-compat during the transition; new code should pin to a subpath.

## Decision Trail (UI Bridge Redesign)

Every architectural decision behind this package's current shape is captured in an ADR under `qontinui-dev-notes/ui-bridge-redesign/`:

- ADR-001 — IR foundations (`<State>` / `<TransitionTo>` primitives, ts-morph extractor, IR adapter)
- ADR-004 — Metro + Tauri build adapters
- ADR-005 — Causal tracing + replay
- ADR-006 — Counterfactual exploration
- ADR-007 — Confidence + drift hypotheses
- ADR-008 — Visual / semantic fusion
- ADR-009 — Auto-regression generator
- ADR-010 — Self-diagnosis + memory sink
- ADR-011 — Regression executor, scenario projection, coverage diff, unified drift route, **subpath exports** (the carving of this package's public surface)
- ADR-013 — `GET /spec/list` + `useDiscoveredSpecs()` runtime loading
- ADR-013.5 — Section 13.5 production-touchpoint completion

ADR-012 covers Section 12's cleanup (static-builder + migrate-cli deletion; this CLAUDE.md's update; `update-spec` skill rewrite) and is being authored as a sibling workstream.

The canonical SDK + IR pipeline reference is `knowledge-base/qontinui-specific/ui-bridge.md`.

## Building & Testing

```bash
npm run typecheck    # Type-check
npm run test         # Run tests (vitest + jsdom)
npm run test:watch   # Watch mode
npm run build        # Build CJS + ESM + DTS
```

## Dependencies

- `@qontinui/ui-bridge` — UI Bridge SDK (element registry, types, actions)
- `vitest` + `jsdom` — testing (dev only)
- `tsup` — bundling (dev only)

## Roadmap

This library is being built systematically in work units (WU):

| WU | Module | Status |
|----|--------|--------|
| WU-1 | Foundation (types, config, tests) | Complete |
| WU-2 | Element Query Engine (deep implementation) | Complete |
| WU-3 | Action System (chains, control flow, retry) | Complete |
| WU-4 | State Machine (full detection, discovery, pathfinding) | Complete |
| WU-5 | Execution Engine (graph-based workflows) | Complete |
| WU-6 | Recording & Replay | Complete |
| WU-7 | Error Recovery & Self-Healing | Complete |
| WU-8 | Server, MCP, Runner Integration | Complete |
| WU-9 | Visual (highlights, OCR, coordinates, screenshots) | Complete |

## Code Standards

- TypeScript strict mode
- All public APIs have JSDoc comments
- Tests required for all modules (vitest + jsdom)
- No `any` types
- Build must produce CJS, ESM, and DTS outputs
