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

/** Configuration for directional scroll actions. */
export interface ScrollConfig {
  /** Scroll direction. */
  direction: "up" | "down" | "left" | "right";
  /** Number of scroll units (default 3). */
  amount: number;
  /** Whether to use smooth scrolling (default true). */
  smooth: boolean;
  /** Delay between individual scroll steps (ms, default 100). */
  delayBetweenScrollsMs: number;
}

/** Configuration for low-level mouse press actions (mouseDown/mouseUp). */
export interface MousePressConfig {
  /** Which mouse button (default "left"). */
  button: "left" | "right" | "middle";
  /** How long to hold the button (ms, default 0). */
  pressDurationMs: number;
  /** Pause after pressing (ms, default 0). */
  pauseAfterPressMs: number;
  /** Pause after releasing (ms, default 0). */
  pauseAfterReleaseMs: number;
}

/** Configuration for low-level key press actions (keyDown/keyUp). */
export interface KeyPressConfig {
  /** Modifier keys held during key press. */
  modifiers: ("ctrl" | "shift" | "alt" | "meta")[];
  /** Delay between pressing individual keys (ms, default 0). */
  pauseBetweenKeysMs: number;
  /** Whether to release modifiers before other keys (keyUp only, default false). */
  releaseModifiersFirst: boolean;
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
  /** Directional scroll defaults. */
  scroll: ScrollConfig;
  /** Mouse press (mouseDown/mouseUp) defaults. */
  mousePress: MousePressConfig;
  /** Key press (keyDown/keyUp) defaults. */
  keyPress: KeyPressConfig;
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
    scroll: {
      direction: "down",
      amount: 3,
      smooth: true,
      delayBetweenScrollsMs: 100,
    },
    mousePress: {
      button: "left",
      pressDurationMs: 0,
      pauseAfterPressMs: 0,
      pauseAfterReleaseMs: 0,
    },
    keyPress: {
      modifiers: [],
      pauseBetweenKeysMs: 0,
      releaseModifiersFirst: false,
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
 * Merge partial overrides into a base ScrollConfig.
 */
export function mergeScrollConfig(
  base: ScrollConfig,
  overrides: Partial<ScrollConfig>,
): ScrollConfig {
  return {
    direction: overrides.direction ?? base.direction,
    amount: overrides.amount ?? base.amount,
    smooth: overrides.smooth ?? base.smooth,
    delayBetweenScrollsMs: overrides.delayBetweenScrollsMs ?? base.delayBetweenScrollsMs,
  };
}

/**
 * Merge partial overrides into a base MousePressConfig.
 */
export function mergeMousePressConfig(
  base: MousePressConfig,
  overrides: Partial<MousePressConfig>,
): MousePressConfig {
  return {
    button: overrides.button ?? base.button,
    pressDurationMs: overrides.pressDurationMs ?? base.pressDurationMs,
    pauseAfterPressMs: overrides.pauseAfterPressMs ?? base.pauseAfterPressMs,
    pauseAfterReleaseMs: overrides.pauseAfterReleaseMs ?? base.pauseAfterReleaseMs,
  };
}

/**
 * Merge partial overrides into a base KeyPressConfig.
 */
export function mergeKeyPressConfig(
  base: KeyPressConfig,
  overrides: Partial<KeyPressConfig>,
): KeyPressConfig {
  return {
    modifiers: overrides.modifiers ?? base.modifiers,
    pauseBetweenKeysMs: overrides.pauseBetweenKeysMs ?? base.pauseBetweenKeysMs,
    releaseModifiersFirst: overrides.releaseModifiersFirst ?? base.releaseModifiersFirst,
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
    scroll: Partial<ScrollConfig>;
    mousePress: Partial<MousePressConfig>;
    keyPress: Partial<KeyPressConfig>;
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
    scroll: overrides.scroll
      ? mergeScrollConfig(base.scroll, overrides.scroll)
      : base.scroll,
    mousePress: overrides.mousePress
      ? mergeMousePressConfig(base.mousePress, overrides.mousePress)
      : base.mousePress,
    keyPress: overrides.keyPress
      ? mergeKeyPressConfig(base.keyPress, overrides.keyPress)
      : base.keyPress,
  };
}
