import { describe, it, expect, beforeEach } from "vitest";
import {
  applyStrategy,
  selectStrategy,
  retryStrategy,
  fallbackStrategy,
  waitStrategy,
} from "../../healing/recovery-strategies";
import { classifyError } from "../../healing/error-classifier";
import { MockActionExecutor } from "../../test-utils/mock-executor";
import { ElementRelocator } from "../../healing/element-relocator";
import { MockRegistry } from "../../test-utils/mock-registry";
import { resetIdCounter } from "../../test-utils/mock-elements";

let executor: MockActionExecutor;
let registry: MockRegistry;
let relocator: ElementRelocator;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  executor = new MockActionExecutor();
  registry = new MockRegistry();
  relocator = new ElementRelocator(registry);
});

describe("applyStrategy", () => {
  it("retry strategy retries and succeeds", async () => {
    let callCount = 0;
    const action = async () => {
      callCount++;
      if (callCount < 2) throw new Error("transient");
    };

    const result = await applyStrategy(
      retryStrategy(3, 0),
      action,
      { executor, relocator, error: new Error("initial") },
    );

    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe("retry");
    expect(result.attempts).toBe(2);
  });

  it("retry strategy exhausts attempts", async () => {
    const action = async () => {
      throw new Error("always fails");
    };

    const result = await applyStrategy(
      retryStrategy(2, 0),
      action,
      { executor, relocator, error: new Error("initial") },
    );

    expect(result.recovered).toBe(false);
    expect(result.strategy).toBe("retry");
    expect(result.attempts).toBe(2);
    expect(result.error).toBe("always fails");
  });

  it("wait strategy waits then retries", async () => {
    let called = false;
    const action = async () => {
      called = true;
    };

    const result = await applyStrategy(
      waitStrategy(10),
      action,
      { executor, relocator, error: new Error("initial") },
    );

    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe("wait");
    expect(called).toBe(true);
  });

  it("fallback strategy finds and clicks element", async () => {
    executor.registerElement("role:link", "fallback-link");

    const result = await applyStrategy(
      fallbackStrategy({ role: "link" }),
      async () => { throw new Error("original"); },
      { executor, relocator, error: new Error("original") },
    );

    expect(result.recovered).toBe(true);
    expect(result.strategy).toBe("fallback");
    expect(executor.executedActions).toHaveLength(1);
    expect(executor.executedActions[0].elementId).toBe("fallback-link");
  });

  it("fallback strategy fails when element not found", async () => {
    const result = await applyStrategy(
      fallbackStrategy({ role: "nonexistent" }),
      async () => { throw new Error("original"); },
      { executor, relocator, error: new Error("original") },
    );

    expect(result.recovered).toBe(false);
    expect(result.error).toContain("not found");
  });
});

describe("selectStrategy", () => {
  it("selects retry for timeout errors", () => {
    const classified = classifyError(new Error("Operation timeout"));
    const strategy = selectStrategy(classified);
    expect(strategy.type).toBe("retry");
  });

  it("selects retry for relocate errors", () => {
    const classified = classifyError(new Error("Element not found"));
    const strategy = selectStrategy(classified);
    expect(strategy.type).toBe("retry");
  });

  it("selects wait for environmental errors", () => {
    const classified = classifyError(new Error("Network error"));
    const strategy = selectStrategy(classified);
    expect(strategy.type).toBe("wait");
  });

  it("selects alternativePath for reroute errors", () => {
    const classified = classifyError(new Error("No path available"));
    const strategy = selectStrategy(classified);
    expect(strategy.type).toBe("alternativePath");
  });

  it("selects retry(1) for abort errors", () => {
    const classified = classifyError(new Error("unknown error xyz"));
    const strategy = selectStrategy(classified);
    expect(strategy.type).toBe("retry");
    expect(strategy.maxAttempts).toBe(1);
  });
});

describe("factory functions", () => {
  it("retryStrategy creates correct config", () => {
    const s = retryStrategy(5, 1000);
    expect(s.type).toBe("retry");
    expect(s.maxAttempts).toBe(5);
    expect(s.delayMs).toBe(1000);
  });

  it("fallbackStrategy creates correct config", () => {
    const s = fallbackStrategy({ role: "button" });
    expect(s.type).toBe("fallback");
    expect(s.fallbackQuery).toEqual({ role: "button" });
  });

  it("waitStrategy creates correct config", () => {
    const s = waitStrategy(3000);
    expect(s.type).toBe("wait");
    expect(s.delayMs).toBe(3000);
  });
});
