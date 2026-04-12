import { describe, it, expect, beforeEach } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import { EscalatingResolver } from "../../resolution/escalating-resolver";
import { CallbackTelemetryEmitter } from "../../resolution/telemetry";
import type { EscalationEvent } from "../../resolution/types";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  createMockElement,
  resetIdCounter,
} from "../../test-utils/mock-elements";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let mockRegistry: MockRegistry;
let performed: Array<{ id: string; action: string; params?: Record<string, unknown> }>;
let events: EscalationEvent[];
let performAction: (id: string, action: string, params?: Record<string, unknown>) => Promise<void>;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  mockRegistry = new MockRegistry();
  performed = [];
  events = [];
  performAction = async (id, action, params) => {
    performed.push({ id, action, params });
  };
});

function createTestExecutor(overrides?: {
  performAction?: typeof performAction;
}) {
  return new ActionExecutor({
    registry: mockRegistry,
    performAction: overrides?.performAction ?? performAction,
    waitForIdle: async () => {},
  });
}

function createResolver(
  executor: ActionExecutor,
  overrides?: { accessibilityThreshold?: number; visualThreshold?: number },
) {
  return new EscalatingResolver({
    registry: mockRegistry,
    executor,
    telemetry: new CallbackTelemetryEmitter((e) => events.push(e)),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tier 1: Deterministic success — no escalation
// ---------------------------------------------------------------------------

describe("EscalatingResolver — Tier 1 (deterministic)", () => {
  it("returns success with no telemetry event when element found directly", async () => {
    const btn = createButton("Submit");
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    const resolver = createResolver(executor);

    const record = await resolver.execute({ text: "Submit" }, "click");

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
    expect(performed[0].id).toBe(btn.id);
    expect(events).toHaveLength(0); // No escalation event.
  });
});

// ---------------------------------------------------------------------------
// Tier 2: Accessibility-tree fallback
// ---------------------------------------------------------------------------

describe("EscalatingResolver — Tier 2 (accessibility-tree)", () => {
  it("escalates to accessibility-tree when DOM query fails and ARIA label matches", async () => {
    // Create a button with an aria-label that doesn't match text query
    // but will be found by ElementRelocator's ARIA label strategy.
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "OK",
      label: "OK",
      attributes: { "aria-label": "Confirm Action" },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    // Set low threshold to accept ARIA label match (confidence 0.9).
    const resolver = createResolver(executor, { accessibilityThreshold: 0.75 });

    // Query by ariaLabel that ElementRelocator.findAlternative will match.
    // The primary DOM query uses text "NonexistentText" which won't match,
    // but the fallback uses ariaLabel "Confirm Action" which will.
    const record = await resolver.execute(
      { text: "NonexistentText", ariaLabel: "Confirm Action" },
      "click",
    );

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
    expect(performed[0].id).toBe(btn.id);
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("accessibility-tree");
    expect(events[0].confidence).toBe(0.9);
    expect(events[0].resolvedElementId).toBe(btn.id);
  });

  it("skips Tier 2 when confidence is below threshold", async () => {
    // Create an element that role+position matches (confidence 0.5).
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Something",
      label: "Something",
      attributes: { role: "button" },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    // High threshold rejects role+position (0.5 < 0.9).
    const resolver = createResolver(executor, { accessibilityThreshold: 0.9 });

    const record = await resolver.execute(
      { text: "Nonexistent", role: "button" },
      "click",
    );

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// Tier 3: Visual coordinate fallback
// ---------------------------------------------------------------------------

describe("EscalatingResolver — Tier 3 (visual-coordinate)", () => {
  it("escalates to visual-coordinate when DOM and accessibility fail", async () => {
    // Create a button at known coordinates.
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Hidden Button",
      label: "Hidden Button",
      state: { rect: { x: 50, y: 50, width: 80, height: 30 } },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    // Low thresholds so visual tier can succeed.
    const resolver = createResolver(executor, {
      accessibilityThreshold: 0.99, // Effectively disable Tier 2.
      visualThreshold: 0.4,
    });

    // Query with spatial anchor (within bounds) that contains the element.
    const record = await resolver.execute(
      { text: "Nonexistent", within: { x: 0, y: 0, width: 200, height: 200 } },
      "click",
    );

    expect(record.status).toBe("success");
    expect(performed.length).toBeGreaterThanOrEqual(1);
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("visual-coordinate");
    expect(events[0].resolvedElementId).toBe(btn.id);
    expect(events[0].confidence).toBeGreaterThanOrEqual(0.4);
  });

  it("skips Tier 3 when no spatial anchor (query.within) is provided", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Orphan",
      label: "Orphan",
      state: { rect: { x: 50, y: 50, width: 80, height: 30 } },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      accessibilityThreshold: 0.99,
      visualThreshold: 0.4,
    });

    // No `within` — Tier 3 guard should skip.
    const record = await resolver.execute({ text: "Nonexistent" }, "click");

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });

  it("boosts confidence when role matches structural hint", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Magic",
      label: "Magic",
      attributes: { role: "button" },
      state: { rect: { x: 100, y: 100, width: 60, height: 30 } },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      accessibilityThreshold: 0.99,
      visualThreshold: 0.5,
    });

    const record = await resolver.execute(
      {
        text: "Nonexistent",
        role: "button",
        within: { x: 80, y: 80, width: 60, height: 60 },
      },
      "click",
    );

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("visual-coordinate");
    // Confidence should be boosted by role match (+0.15).
    expect(events[0].confidence).toBeGreaterThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// All tiers exhausted
// ---------------------------------------------------------------------------

describe("EscalatingResolver — exhausted", () => {
  it("returns original failure and emits exhausted event when all tiers fail", async () => {
    const executor = createTestExecutor();
    const resolver = createResolver(executor);

    const record = await resolver.execute({ text: "Ghost" }, "click");

    expect(record.status).toBe("failed");
    expect(record.error).toContain("Ghost");
    expect(performed).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
    expect(events[0].resolvedElementId).toBeUndefined();
    expect(events[0].confidence).toBeUndefined();
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

describe("EscalatingResolver — telemetry", () => {
  it("emits exactly one event per escalation", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Present",
      label: "Present",
      attributes: { "aria-label": "Present" },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { accessibilityThreshold: 0.75 });

    // First call: deterministic success, no event.
    await resolver.execute({ text: "Present" }, "click");
    expect(events).toHaveLength(0);

    // Second call: force escalation via wrong text, ARIA fallback.
    await resolver.execute(
      { text: "Wrong", ariaLabel: "Present" },
      "click",
    );
    expect(events).toHaveLength(1);
  });

  it("event contains the original query", async () => {
    const executor = createTestExecutor();
    const resolver = createResolver(executor);

    const query = { text: "Missing", role: "link" };
    await resolver.execute(query, "click");

    expect(events).toHaveLength(1);
    expect(events[0].query).toEqual(query);
  });
});
