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
├── types/          # Core domain types (element, state, transition, action, match, region)
├── config/         # Configuration schemas (workflow, action defaults, search config)
├── core/           # Query engine + automation engine
├── state/          # State machine, detector, pathfinder, transition executor
├── wait/           # Wait primitives (element, state, idle, condition)
├── batch/          # Action sequences + named flows
├── discovery/      # Overlay detection, stable IDs, element fingerprinting
├── server/         # HTTP endpoint handlers
├── test-utils/     # Mock registry, elements, executor for testing
└── __tests__/      # Test suites (vitest + jsdom)
```

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
| WU-2 | Element Query Engine (deep implementation) | Pending |
| WU-3 | Action System (chains, control flow, retry) | Pending |
| WU-4 | State Machine (full detection, discovery, pathfinding) | Pending |
| WU-5 | Execution Engine (graph-based workflows) | Pending |
| WU-6 | Recording & Replay | Pending |
| WU-7 | Error Recovery & Self-Healing | Pending |
| WU-8 | Server, MCP, Runner Integration | Pending |

## Code Standards

- TypeScript strict mode
- All public APIs have JSDoc comments
- Tests required for all modules (vitest + jsdom)
- No `any` types
- Build must produce CJS, ESM, and DTS outputs
