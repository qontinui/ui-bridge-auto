import { describe, it, expect } from "vitest";
import {
  createDefaultSettings,
  mergeSettings,
  hydrateState,
  hydrateTransition,
  type StateConfig,
  type TransitionConfig,
} from "../../config/workflow";

describe("createDefaultSettings", () => {
  it("returns expected default values", () => {
    const s = createDefaultSettings();
    expect(s.defaultTimeout).toBe(10_000);
    expect(s.defaultIdleTimeout).toBe(5_000);
    expect(s.maxRetries).toBe(2);
    expect(s.retryDelay).toBe(500);
    expect(s.waitForIdleAfterAction).toBe(true);
    expect(s.screenshotOnFailure).toBe(true);
    expect(s.abortOnFirstFailure).toBe(true);
  });

  it("returns a fresh object each call", () => {
    expect(createDefaultSettings()).not.toBe(createDefaultSettings());
  });
});

describe("mergeSettings", () => {
  it("preserves base when overrides is empty", () => {
    const base = createDefaultSettings();
    const merged = mergeSettings(base, {});
    expect(merged).toEqual(base);
  });

  it("overrides only specified fields", () => {
    const base = createDefaultSettings();
    const merged = mergeSettings(base, { maxRetries: 5, retryDelay: 1000 });
    expect(merged.maxRetries).toBe(5);
    expect(merged.retryDelay).toBe(1000);
    expect(merged.defaultTimeout).toBe(base.defaultTimeout);
  });

  it("can set boolean fields to false", () => {
    const base = createDefaultSettings();
    const merged = mergeSettings(base, { abortOnFirstFailure: false });
    expect(merged.abortOnFirstFailure).toBe(false);
  });
});

describe("hydrateState", () => {
  it("adds observationCount and preserves config fields", () => {
    const config: StateConfig = {
      id: "s1",
      name: "Login",
      requiredElements: [{ role: "button", text: "Sign In" }],
      isInitial: true,
    };
    const state = hydrateState(config);
    expect(state.observationCount).toBe(0);
    expect(state.id).toBe("s1");
    expect(state.name).toBe("Login");
    expect(state.isInitial).toBe(true);
    expect(state.enteredAt).toBeUndefined();
    expect(state.exitedAt).toBeUndefined();
  });
});

describe("hydrateTransition", () => {
  it("adds reliability tracking fields initialised to zero", () => {
    const config: TransitionConfig = {
      id: "t1",
      name: "Login click",
      fromStates: ["s1"],
      activateStates: ["s2"],
      exitStates: ["s1"],
      actions: [{ type: "click", target: { role: "button" } }],
    };
    const t = hydrateTransition(config);
    expect(t.successCount).toBe(0);
    expect(t.failureCount).toBe(0);
    expect(t.averageDurationMs).toBe(0);
    expect(t.lastExecutedAt).toBeUndefined();
    expect(t.id).toBe("t1");
    expect(t.actions).toHaveLength(1);
  });
});
