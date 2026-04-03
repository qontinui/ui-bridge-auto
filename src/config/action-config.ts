/**
 * Per-action-type configuration defaults.
 *
 * Each action verb (click, type, select, etc.) has its own configuration
 * that controls behaviour like delays, auto-scrolling, and event dispatch.
 * These defaults can be overridden at the workflow or action level.
 */

// ---------------------------------------------------------------------------
// Per-action-type configs
// ---------------------------------------------------------------------------

/** Configuration for click actions. */
export interface ClickConfig {
  /** Delay between the two click events in a double-click (ms). */
  doubleClickDelayMs: number;
  /** Whether to auto-scroll the element into view before clicking. */
  scrollIntoView: boolean;
  /** Whether to wait for the element to become enabled before clicking. */
  waitForEnabled: boolean;
  /** Maximum time (ms) to wait for the element to become enabled. */
  waitForEnabledTimeout: number;
}

/** Configuration for type/keystroke actions. */
export interface TypeConfig {
  /** Whether to clear the input field before typing. */
  clearFirst: boolean;
  /** Delay between individual keystrokes (ms). 0 for instant. */
  typeDelay: number;
  /** Whether to dispatch a change event after typing completes. */
  triggerChangeEvent: boolean;
}

/** Configuration for select/dropdown actions. */
export interface SelectConfig {
  /** Whether to wait for dropdown options to load before selecting. */
  waitForOptions: boolean;
  /** Maximum time (ms) to wait for options to appear. */
  optionsTimeout: number;
}

/** Configuration for wait/idle operations. */
export interface WaitConfig {
  /** Default timeout for all wait operations (ms). */
  defaultTimeout: number;
  /** Polling interval for condition checks (ms). */
  pollInterval: number;
  /** Which idle signals to monitor. */
  idleSignals: ("network" | "dom" | "loading")[];
}

/** Configuration for scroll-into-view operations. */
export interface ScrollIntoViewConfig {
  /** Scroll behaviour: "auto" (instant) or "smooth" (animated). */
  behavior: "auto" | "smooth";
  /** Block alignment: "center" (center in viewport) or "nearest" (minimal scroll). */
  block: "center" | "nearest";
}

// ---------------------------------------------------------------------------
// Combined defaults
// ---------------------------------------------------------------------------

/**
 * Complete set of per-action-type configuration defaults.
 * Used as the baseline configuration; individual actions can override
 * specific fields via their params.
 */
export interface ActionDefaults {
  /** Click action defaults. */
  click: ClickConfig;
  /** Type/keystroke action defaults. */
  type: TypeConfig;
  /** Select/dropdown action defaults. */
  select: SelectConfig;
  /** Wait/idle operation defaults. */
  wait: WaitConfig;
  /** Scroll-into-view defaults. */
  scrollIntoView: ScrollIntoViewConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a complete ActionDefaults object with sensible defaults.
 *
 * Default values:
 * - click: 100ms double-click delay, auto-scroll on, wait-for-enabled on (3s timeout)
 * - type: clear first off, 0ms type delay, trigger change event on
 * - select: wait for options on, 5s options timeout
 * - wait: 10s default timeout, 100ms poll interval, all idle signals
 * - scrollIntoView: auto behaviour, center block
 */
export function createDefaultActionConfig(): ActionDefaults {
  return {
    click: {
      doubleClickDelayMs: 100,
      scrollIntoView: true,
      waitForEnabled: true,
      waitForEnabledTimeout: 3000,
    },
    type: {
      clearFirst: false,
      typeDelay: 0,
      triggerChangeEvent: true,
    },
    select: {
      waitForOptions: true,
      optionsTimeout: 5000,
    },
    wait: {
      defaultTimeout: 10_000,
      pollInterval: 100,
      idleSignals: ["network", "dom", "loading"],
    },
    scrollIntoView: {
      behavior: "auto",
      block: "center",
    },
  };
}

/**
 * Merge partial overrides into a base ClickConfig.
 */
export function mergeClickConfig(
  base: ClickConfig,
  overrides: Partial<ClickConfig>,
): ClickConfig {
  return {
    doubleClickDelayMs: overrides.doubleClickDelayMs ?? base.doubleClickDelayMs,
    scrollIntoView: overrides.scrollIntoView ?? base.scrollIntoView,
    waitForEnabled: overrides.waitForEnabled ?? base.waitForEnabled,
    waitForEnabledTimeout: overrides.waitForEnabledTimeout ?? base.waitForEnabledTimeout,
  };
}

/**
 * Merge partial overrides into a base TypeConfig.
 */
export function mergeTypeConfig(
  base: TypeConfig,
  overrides: Partial<TypeConfig>,
): TypeConfig {
  return {
    clearFirst: overrides.clearFirst ?? base.clearFirst,
    typeDelay: overrides.typeDelay ?? base.typeDelay,
    triggerChangeEvent: overrides.triggerChangeEvent ?? base.triggerChangeEvent,
  };
}

/**
 * Merge partial overrides into a base SelectConfig.
 */
export function mergeSelectConfig(
  base: SelectConfig,
  overrides: Partial<SelectConfig>,
): SelectConfig {
  return {
    waitForOptions: overrides.waitForOptions ?? base.waitForOptions,
    optionsTimeout: overrides.optionsTimeout ?? base.optionsTimeout,
  };
}

/**
 * Merge partial overrides into a base WaitConfig.
 */
export function mergeWaitConfig(
  base: WaitConfig,
  overrides: Partial<WaitConfig>,
): WaitConfig {
  return {
    defaultTimeout: overrides.defaultTimeout ?? base.defaultTimeout,
    pollInterval: overrides.pollInterval ?? base.pollInterval,
    idleSignals: overrides.idleSignals ?? base.idleSignals,
  };
}

/**
 * Merge partial overrides into a full ActionDefaults.
 * Each sub-config is merged independently so partial overrides
 * within a sub-config don't discard other fields.
 */
export function mergeActionDefaults(
  base: ActionDefaults,
  overrides: Partial<{
    click: Partial<ClickConfig>;
    type: Partial<TypeConfig>;
    select: Partial<SelectConfig>;
    wait: Partial<WaitConfig>;
    scrollIntoView: Partial<ScrollIntoViewConfig>;
  }>,
): ActionDefaults {
  return {
    click: overrides.click ? mergeClickConfig(base.click, overrides.click) : base.click,
    type: overrides.type ? mergeTypeConfig(base.type, overrides.type) : base.type,
    select: overrides.select
      ? mergeSelectConfig(base.select, overrides.select)
      : base.select,
    wait: overrides.wait ? mergeWaitConfig(base.wait, overrides.wait) : base.wait,
    scrollIntoView: overrides.scrollIntoView
      ? {
          behavior: overrides.scrollIntoView.behavior ?? base.scrollIntoView.behavior,
          block: overrides.scrollIntoView.block ?? base.scrollIntoView.block,
        }
      : base.scrollIntoView,
  };
}
