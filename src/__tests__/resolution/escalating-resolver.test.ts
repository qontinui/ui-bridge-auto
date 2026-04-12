import { describe, it, expect, beforeEach } from "vitest";
import { ActionExecutor } from "../../actions/action-executor";
import { EscalatingResolver } from "../../resolution/escalating-resolver";
import { CallbackTelemetryEmitter } from "../../resolution/telemetry";
import type { EscalationEvent } from "../../resolution/types";
import type { CentralTargetRegistry, SearchEngine, SearchCriteria, SearchResult } from "@qontinui/ui-bridge";
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
  overrides?: {
    accessibilityThreshold?: number;
    visualThreshold?: number;
    searchThreshold?: number;
    ctr?: CentralTargetRegistry;
    searchEngine?: SearchEngine;
  },
) {
  return new EscalatingResolver({
    registry: mockRegistry,
    executor,
    telemetry: new CallbackTelemetryEmitter((e) => events.push(e)),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Mock factories for UI Bridge APIs
// ---------------------------------------------------------------------------

/** Create a mock CTR that resolves the given logicalName to a DOM element. */
function createMockCtr(
  resolveMap: Map<string, HTMLElement>,
): CentralTargetRegistry {
  return {
    resolveInDOM(logicalName: string) {
      const element = resolveMap.get(logicalName);
      return {
        logicalName,
        resolved: !!element,
        element,
        attemptedSelectors: [],
        durationMs: 1,
      };
    },
  } as unknown as CentralTargetRegistry;
}

/** Create a mock SearchEngine that returns a fixed result for any criteria. */
function createMockSearchEngine(
  resultFn: (criteria: SearchCriteria) => SearchResult | null,
): SearchEngine {
  return {
    findBest(criteria: SearchCriteria) {
      return resultFn(criteria);
    },
  } as unknown as SearchEngine;
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

// ---------------------------------------------------------------------------
// Tier 1.5: CTR resolution
// ---------------------------------------------------------------------------

describe("EscalatingResolver — Tier 1.5 (CTR)", () => {
  it("resolves via CTR using ariaLabel as logical name (ariaLabel takes priority over text)", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Save",
      label: "Save",
    });
    mockRegistry.addElement(btn);

    // CTR maps "Save" (the ariaLabel) to the button's DOM element.
    const ctr = createMockCtr(new Map([["Save", btn.element]]));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { ctr });

    // DOM query fails on "WrongText". queryToLogicalName picks ariaLabel "Save" over
    // text "WrongText" (priority: id > ariaLabel > text). CTR resolves "Save" → btn.element.
    const record = await resolver.execute(
      { text: "WrongText", ariaLabel: "Save" },
      "click",
    );

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("ctr");
    expect(events[0].resolvedElementId).toBe(btn.id);
  });

  it("resolves via CTR using query.id as logical name", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Save",
      label: "Save",
    });
    mockRegistry.addElement(btn);

    const ctr = createMockCtr(new Map([["save-btn", btn.element]]));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { ctr });

    // query.id (string) is used as the logical name for CTR lookup.
    // DOM query by id won't match because registry id is auto-generated.
    const record = await resolver.execute(
      { id: "save-btn", text: "NonexistentText" },
      "click",
    );

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
    expect(performed[0].id).toBe(btn.id);
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("ctr");
    expect(events[0].confidence).toBe(0.95);
    expect(events[0].resolvedElementId).toBe(btn.id);
  });

  it("resolves via CTR using query.text as logical name", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Confirm",
      label: "Confirm",
    });
    mockRegistry.addElement(btn);

    // CTR maps "MismatchedText" to the button's DOM element.
    const ctr = createMockCtr(new Map([["MismatchedText", btn.element]]));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { ctr });

    // DOM query fails (text "MismatchedText" doesn't match textContent "Confirm").
    // CTR resolves "MismatchedText" → btn.element.
    const record = await resolver.execute({ text: "MismatchedText" }, "click");

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("ctr");
  });

  it("skips CTR when no CTR instance provided", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "X",
      label: "X",
      attributes: { "aria-label": "Close" },
    });
    mockRegistry.addElement(btn);
    const executor = createTestExecutor();
    // No ctr provided — should fall through to accessibility tier.
    const resolver = createResolver(executor, { accessibilityThreshold: 0.75 });

    const record = await resolver.execute(
      { text: "Wrong", ariaLabel: "Close" },
      "click",
    );

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("accessibility-tree"); // Not CTR.
  });

  it("skips CTR when no logical name derivable from query (role-only query)", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Y",
      label: "Y",
      attributes: { role: "button" },
    });
    mockRegistry.addElement(btn);

    const ctr = createMockCtr(new Map([["Y", btn.element]]));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      ctr,
      accessibilityThreshold: 0.99,
    });

    // Query with only role — no id, no ariaLabel, no text — queryToLogicalName returns null,
    // so the CTR tier is skipped entirely before it is even invoked.
    // Accessibility threshold too high. Visual needs within. → exhausted.
    const record = await resolver.execute({ role: "menu" }, "click");

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// Tier 2: SearchEngine resolution
// ---------------------------------------------------------------------------

describe("EscalatingResolver — Tier 2 (SearchEngine)", () => {
  it("resolves via SearchEngine when DOM and CTR fail", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Deploy",
      label: "Deploy",
    });
    mockRegistry.addElement(btn);

    const searchEngine = createMockSearchEngine((_criteria) => ({
      element: { id: btn.id } as any,
      confidence: 0.85,
      matchReasons: ["text match"],
      scores: { text: 0.85 },
    }));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { searchEngine });

    // "Deploi" won't match DOM query (text "Deploy"), but SearchEngine finds it.
    const record = await resolver.execute({ text: "Deploi" }, "click");

    expect(record.status).toBe("success");
    expect(performed).toHaveLength(1);
    expect(performed[0].id).toBe(btn.id);
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("search-engine");
    expect(events[0].confidence).toBe(0.85);
    expect(events[0].resolvedElementId).toBe(btn.id);
  });

  it("skips SearchEngine when confidence is below searchThreshold", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Publish",
      label: "Publish",
    });
    mockRegistry.addElement(btn);

    const searchEngine = createMockSearchEngine((_criteria) => ({
      element: { id: btn.id } as any,
      confidence: 0.5, // Below default threshold of 0.7.
      matchReasons: ["partial text match"],
      scores: { text: 0.5 },
    }));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      searchEngine,
      accessibilityThreshold: 0.99, // Disable accessibility tier.
    });

    const record = await resolver.execute({ text: "Pubish" }, "click");

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });

  it("respects custom searchThreshold", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Archive",
      label: "Archive",
    });
    mockRegistry.addElement(btn);

    const searchEngine = createMockSearchEngine((_criteria) => ({
      element: { id: btn.id } as any,
      confidence: 0.65,
      matchReasons: ["fuzzy text match"],
      scores: { text: 0.65 },
    }));
    const executor = createTestExecutor();
    // Custom threshold of 0.6 should accept the 0.65 result.
    const resolver = createResolver(executor, {
      searchEngine,
      searchThreshold: 0.6,
    });

    const record = await resolver.execute({ text: "Archve" }, "click");

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("search-engine");
    expect(events[0].confidence).toBe(0.65);
  });

  it("skips SearchEngine when no instance provided", async () => {
    const executor = createTestExecutor();
    const resolver = createResolver(executor); // No searchEngine.

    const record = await resolver.execute({ text: "Nowhere" }, "click");

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });

  it("SearchEngine result not in registry falls through", async () => {
    // SearchEngine returns an element ID that doesn't exist in our registry.
    const searchEngine = createMockSearchEngine((_criteria) => ({
      element: { id: "phantom-id" } as any,
      confidence: 0.9,
      matchReasons: ["text match"],
      scores: { text: 0.9 },
    }));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      searchEngine,
      accessibilityThreshold: 0.99,
    });

    const record = await resolver.execute({ text: "Phantom" }, "click");

    expect(record.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// Tier ordering: CTR before SearchEngine before accessibility
// ---------------------------------------------------------------------------

describe("EscalatingResolver — tier ordering", () => {
  it("CTR resolves before SearchEngine is tried", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Action",
      label: "Action",
    });
    mockRegistry.addElement(btn);

    let searchEngineCalled = false;
    const ctr = createMockCtr(new Map([["ActionBtn", btn.element]]));
    const searchEngine = createMockSearchEngine((_criteria) => {
      searchEngineCalled = true;
      return {
        element: { id: btn.id } as any,
        confidence: 0.9,
        matchReasons: ["text"],
        scores: { text: 0.9 },
      };
    });
    const executor = createTestExecutor();
    const resolver = createResolver(executor, { ctr, searchEngine });

    const record = await resolver.execute({ id: "ActionBtn" }, "click");

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("ctr");
    expect(searchEngineCalled).toBe(false); // SearchEngine never called.
  });

  it("SearchEngine resolves before accessibility-tree is tried", async () => {
    const btn = createMockElement({
      tagName: "button",
      type: "button",
      textContent: "Proceed",
      label: "Proceed",
      attributes: { "aria-label": "Proceed" },
    });
    mockRegistry.addElement(btn);

    const searchEngine = createMockSearchEngine((_criteria) => ({
      element: { id: btn.id } as any,
      confidence: 0.8,
      matchReasons: ["text"],
      scores: { text: 0.8 },
    }));
    const executor = createTestExecutor();
    const resolver = createResolver(executor, {
      searchEngine,
      accessibilityThreshold: 0.75,
    });

    // Query text "Procede" won't match DOM, but SearchEngine returns the button.
    // ARIA label "Proceed" would also match via accessibility tier.
    const record = await resolver.execute(
      { text: "Procede", ariaLabel: "Proceed" },
      "click",
    );

    expect(record.status).toBe("success");
    expect(events).toHaveLength(1);
    expect(events[0].tier).toBe("search-engine"); // Not accessibility-tree.
  });
});
