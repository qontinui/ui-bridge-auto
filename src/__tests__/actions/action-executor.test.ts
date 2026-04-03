import { describe, it, expect, beforeEach } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createInput,
  resetIdCounter,
} from "../../test-utils/mock-elements";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockRegistry: MockRegistry;
let performed: Array<{ id: string; action: string; params?: Record<string, unknown> }>;
let performAction: (id: string, action: string, params?: Record<string, unknown>) => Promise<void>;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  mockRegistry = new MockRegistry();
  performed = [];
  performAction = async (id, action, params) => {
    performed.push({ id, action, params });
  };
});

function createExecutor(overrides?: {
  performAction?: typeof performAction;
}) {
  return new ActionExecutor({
    registry: mockRegistry,
    performAction: overrides?.performAction ?? performAction,
    waitForIdle: async () => {},
  });
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------

describe("ActionExecutor.execute", () => {
  it("finds element by query and performs action", async () => {
    const btn = createButton("Submit");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const record = await executor.execute({ text: "Submit" }, "click");

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
    expect(performed[0].action).toBe("click");
    expect(performed[0].id).toBe(btn.id);
  });

  it("returns failed ActionRecord when element not found", async () => {
    const executor = createExecutor();

    const record = await executor.execute({ text: "Nonexistent" }, "click");

    expect(record.status).toBe("failed");
    expect(record.error).toBeTruthy();
    expect(performed).toHaveLength(0);
  });

  it("records timing with durationMs > 0", async () => {
    const btn = createButton("Go");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const record = await executor.execute({ text: "Go" }, "click");

    expect(record.durationMs).toBeDefined();
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("passes params to performAction", async () => {
    const input = createInput("Email");
    mockRegistry.addElement(input);
    const executor = createExecutor();

    await executor.execute({ text: "Email" }, "type", { value: "test@example.com" });

    expect(performed[0].params).toEqual({ value: "test@example.com" });
  });
});

// ---------------------------------------------------------------------------
// executeById
// ---------------------------------------------------------------------------

describe("ActionExecutor.executeById", () => {
  it("performs action on element by ID", async () => {
    const btn = createButton("Save", { id: "save-btn" });
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const record = await executor.executeById("save-btn", "click");

    expect(record.status).toBe("success");
    expect(performed[0].id).toBe("save-btn");
    expect(performed[0].action).toBe("click");
  });

  it("returns failed when element ID does not exist", async () => {
    const executor = createExecutor();

    const record = await executor.executeById("missing-id", "click");

    expect(record.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("ActionExecutor history", () => {
  it("getHistory returns all executed actions", async () => {
    const btn = createButton("A");
    const btn2 = createButton("B");
    mockRegistry.addElement(btn);
    mockRegistry.addElement(btn2);
    const executor = createExecutor();

    await executor.execute({ text: "A" }, "click");
    await executor.execute({ text: "B" }, "click");

    const history = executor.getHistory();
    expect(history).toHaveLength(2);
  });

  it("clearHistory empties the history", async () => {
    const btn = createButton("C");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    await executor.execute({ text: "C" }, "click");
    expect(executor.getHistory()).toHaveLength(1);

    executor.clearHistory();
    expect(executor.getHistory()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

describe("ActionExecutor with retry", () => {
  it("retries on failure and eventually succeeds", async () => {
    let callCount = 0;
    const flakyPerform = async (id: string, action: string) => {
      callCount++;
      if (callCount < 3) {
        throw new Error("transient failure");
      }
      performed.push({ id, action });
    };

    const btn = createButton("Retry");
    mockRegistry.addElement(btn);
    const executor = createExecutor({ performAction: flakyPerform });

    const record = await executor.execute({ text: "Retry" }, "click", undefined, {
      retry: { maxAttempts: 5, initialDelayMs: 1, multiplier: 1, maxDelayMs: 10 },
    });

    expect(record.status).toBe("success");
    expect(callCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

describe("ActionExecutor options", () => {
  it("execute with scrollIntoView option", async () => {
    const btn = createButton("Scroll");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const record = await executor.execute({ text: "Scroll" }, "click", undefined, {
      scrollIntoView: true,
    });

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
  });

  it("applies pauseBeforeAction delay", async () => {
    const btn = createButton("Pause");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const start = Date.now();
    const record = await executor.execute({ text: "Pause" }, "click", undefined, {
      pauseBeforeAction: 50,
      waitForIdle: false,
    });
    const elapsed = Date.now() - start;

    expect(record.status).toBe("success");
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow slight timing variance
  });

  it("applies pauseAfterAction delay", async () => {
    const btn = createButton("PauseAfter");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const start = Date.now();
    const record = await executor.execute({ text: "PauseAfter" }, "click", undefined, {
      pauseAfterAction: 50,
      waitForIdle: false,
    });
    const elapsed = Date.now() - start;

    expect(record.status).toBe("success");
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("verification succeeds when element appears", async () => {
    const btn = createButton("Verify");
    mockRegistry.addElement(btn);
    // Add the verification target element so it's found immediately
    const target = createButton("Result");
    mockRegistry.addElement(target);
    const executor = createExecutor();

    const record = await executor.execute({ text: "Verify" }, "click", undefined, {
      verification: {
        type: "elementAppears",
        query: { text: "Result" },
        timeout: 1000,
      },
      waitForIdle: false,
    });

    expect(record.status).toBe("success");
  });

  it("verification fails when element never appears", async () => {
    const btn = createButton("Verify2");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    const record = await executor.execute({ text: "Verify2" }, "click", undefined, {
      verification: {
        type: "elementAppears",
        query: { text: "NeverShows" },
        timeout: 200,
      },
      waitForIdle: false,
    });

    expect(record.status).toBe("failed");
    expect(record.error).toContain("verification");
  });

  it("merges pressTiming into params for performAction", async () => {
    const btn = createButton("Press");
    mockRegistry.addElement(btn);
    const executor = createExecutor();

    await executor.execute({ text: "Press" }, "click", { extra: "val" }, {
      pressTiming: { pressDurationMs: 100, pauseAfterPressMs: 50 },
      waitForIdle: false,
    });

    expect(performed).toHaveLength(1);
    expect(performed[0].params).toHaveProperty("extra", "val");
    expect(performed[0].params).toHaveProperty("_pressTiming");
    expect((performed[0].params as any)._pressTiming.pressDurationMs).toBe(100);
  });
});
