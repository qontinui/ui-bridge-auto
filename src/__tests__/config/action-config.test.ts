import { describe, it, expect } from "vitest";
import {
  createDefaultActionConfig,
  mergeClickConfig,
  mergeTypeConfig,
  mergeSelectConfig,
  mergeWaitConfig,
  mergeActionDefaults,
} from "../../config/action-config";

describe("createDefaultActionConfig", () => {
  it("returns all sub-configs with expected defaults", () => {
    const d = createDefaultActionConfig();
    expect(d.click.doubleClickDelayMs).toBe(100);
    expect(d.click.scrollIntoView).toBe(true);
    expect(d.click.waitForEnabled).toBe(true);
    expect(d.click.waitForEnabledTimeout).toBe(3000);
    expect(d.type.clearFirst).toBe(false);
    expect(d.type.typeDelay).toBe(0);
    expect(d.type.triggerChangeEvent).toBe(true);
    expect(d.select.waitForOptions).toBe(true);
    expect(d.select.optionsTimeout).toBe(5000);
    expect(d.wait.defaultTimeout).toBe(10_000);
    expect(d.wait.pollInterval).toBe(100);
    expect(d.wait.idleSignals).toEqual(["network", "dom", "loading"]);
    expect(d.scrollIntoView.behavior).toBe("auto");
    expect(d.scrollIntoView.block).toBe("center");
    expect(d.scroll.direction).toBe("down");
    expect(d.mousePress.button).toBe("left");
    expect(d.keyPress.modifiers).toEqual([]);
  });

  it("returns a fresh object each call", () => {
    expect(createDefaultActionConfig()).not.toBe(createDefaultActionConfig());
  });
});

describe("mergeClickConfig", () => {
  it("overrides only specified fields", () => {
    const base = createDefaultActionConfig().click;
    const merged = mergeClickConfig(base, { doubleClickDelayMs: 200 });
    expect(merged.doubleClickDelayMs).toBe(200);
    expect(merged.scrollIntoView).toBe(true);
  });
});

describe("mergeTypeConfig", () => {
  it("overrides clearFirst", () => {
    const base = createDefaultActionConfig().type;
    const merged = mergeTypeConfig(base, { clearFirst: true });
    expect(merged.clearFirst).toBe(true);
    expect(merged.typeDelay).toBe(0);
  });
});

describe("mergeSelectConfig", () => {
  it("overrides optionsTimeout", () => {
    const base = createDefaultActionConfig().select;
    const merged = mergeSelectConfig(base, { optionsTimeout: 10000 });
    expect(merged.optionsTimeout).toBe(10000);
    expect(merged.waitForOptions).toBe(true);
  });
});

describe("mergeWaitConfig", () => {
  it("overrides idleSignals entirely", () => {
    const base = createDefaultActionConfig().wait;
    const merged = mergeWaitConfig(base, { idleSignals: ["network"] });
    expect(merged.idleSignals).toEqual(["network"]);
    expect(merged.defaultTimeout).toBe(10_000);
  });
});

describe("mergeActionDefaults", () => {
  it("merges only the specified sub-config", () => {
    const base = createDefaultActionConfig();
    const merged = mergeActionDefaults(base, {
      click: { doubleClickDelayMs: 50 },
    });
    expect(merged.click.doubleClickDelayMs).toBe(50);
    expect(merged.click.scrollIntoView).toBe(true);
    // other sub-configs unchanged
    expect(merged.type).toEqual(base.type);
    expect(merged.wait).toEqual(base.wait);
  });

  it("preserves all sub-configs when overrides is empty", () => {
    const base = createDefaultActionConfig();
    const merged = mergeActionDefaults(base, {});
    expect(merged).toEqual(base);
  });
});
