/**
 * HTTP endpoint handlers for the UI Bridge auto package.
 *
 * Each handler wraps module calls in try/catch and returns a uniform response
 * shape: { success: true, data } or { success: false, error }.
 *
 * These handlers are designed to be mounted on a UI Bridge server — they
 * accept parsed request bodies and return plain objects (no HTTP concerns).
 *
 * Handlers are organized by domain in the handlers/ directory and composed
 * here into a single object.
 */

import { AutomationEngine } from "../core/engine";
import type { RegistryLike } from "../state/state-detector";
import type { ActionExecutorLike } from "../state/transition-executor";
import type { ElementHighlightManager } from "../visual/element-highlight";
import type { ScreenshotAssertionManager } from "../visual/screenshot-assertion";
import type { IOCRProvider } from "../visual/types";

import {
  createQueryHandlers,
  createWaitHandlers,
  createActionHandlers,
  createStateMachineHandlers,
  createFlowHandlers,
  createRecordingHandlers,
  createGraphHandlers,
  createHealingHandlers,
  createVisualHandlers,
} from "./handlers";

// Re-export response types for consumers
export type { SuccessResponse, ErrorResponse, HandlerResponse } from "./handler-types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for the handler factory. */
export interface AutoHandlersConfig {
  /** The automation engine instance. */
  engine: AutomationEngine;
  /** Element registry for direct access. */
  registry: RegistryLike;
  /** Action executor for direct access. */
  executor: ActionExecutorLike;
  /** Optional highlight manager for visual feedback endpoints. */
  highlightManager?: ElementHighlightManager;
  /** Optional screenshot assertion manager for visual regression endpoints. */
  screenshotManager?: ScreenshotAssertionManager;
  /** Optional OCR provider for text assertion endpoints. */
  ocrProvider?: IOCRProvider;
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

/**
 * Create all auto endpoint handlers.
 *
 * Composes domain-specific handler factories into a single flat object.
 * Each domain (queries, wait, actions, state machine, flows, recording,
 * graph/persistence, healing/discovery, visual) is defined in its own
 * module under handlers/.
 */
export function createAutoHandlers(config: AutoHandlersConfig) {
  const { engine, registry, executor } = config;

  // Auto-create a persistent ScreenshotAssertionManager when Tauri is
  // available and no manager was explicitly provided. This gives the
  // runner's captureBaseline / assertScreenshot endpoints persistent
  // storage in PostgreSQL via the TauriBaselineStore, instead of the
  // InMemoryBaselineStore that loses data on reload.
  let screenshotManager = config.screenshotManager;
  if (!screenshotManager) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasTauri = !!(globalThis as any).__TAURI__;
    if (hasTauri) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TauriBaselineStore } = require("../visual/tauri-baseline-store");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ScreenshotAssertionManager } = require("../visual/screenshot-assertion");
      screenshotManager = new ScreenshotAssertionManager(
        new TauriBaselineStore("visual-regression"),
      );
    }
  }

  return {
    ...createQueryHandlers(engine, registry),
    ...createWaitHandlers(engine),
    ...createActionHandlers(executor, registry, engine.recorder),
    ...createStateMachineHandlers(engine),
    ...createFlowHandlers(engine.flowRegistry, executor, registry),
    ...createRecordingHandlers(engine, executor, registry),
    ...createGraphHandlers(engine),
    ...createHealingHandlers(registry),
    ...createVisualHandlers({
      engine,
      registry,
      highlightManager: config.highlightManager,
      screenshotManager,
      ocrProvider: config.ocrProvider,
    }),
  };
}
