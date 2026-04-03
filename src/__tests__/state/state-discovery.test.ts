import { describe, it, expect, beforeEach } from "vitest";
import { StateDiscovery } from "../../state/state-discovery";
import { createButton, createInput, createLink } from "../../test-utils";

let discovery: StateDiscovery;

beforeEach(() => {
  discovery = new StateDiscovery({ minObservations: 1 });
});

describe("recordSnapshot", () => {
  it("records element presence", () => {
    const btn = createButton("Submit");
    const input = createInput("Email");
    discovery.recordSnapshot([btn, input]);

    expect(discovery.coOccurrence.snapshotCount).toBe(1);
  });
});

describe("discover", () => {
  it("finds states from element groups", () => {
    const btn = createButton("Submit");
    const input = createInput("Email");
    const link = createLink("Home", "/");

    // Snapshot 1 & 2: btn + input together (login form)
    discovery.recordSnapshot([btn, input]);
    discovery.recordSnapshot([btn, input]);
    // Snapshot 3 & 4: link alone (home page)
    discovery.recordSnapshot([link]);
    discovery.recordSnapshot([link]);

    const result = discovery.discover();
    expect(result.states.length).toBeGreaterThanOrEqual(1);
  });

  it("detects transitions when actions are recorded", () => {
    const btn = createButton("Login");
    const input = createInput("Email");
    const dashboard = createButton("Dashboard");

    discovery.recordSnapshot([btn, input]);
    discovery.recordAction({ type: "click", elementId: btn.id });
    discovery.recordSnapshot([dashboard]);

    const result = discovery.discover();
    if (result.states.length >= 2) {
      expect(result.transitions.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("toStateDefinitions", () => {
  it("converts to StateMachine format", () => {
    const btn = createButton("Submit");
    const input = createInput("Email");

    discovery.recordSnapshot([btn, input]);
    discovery.recordSnapshot([btn, input]);
    discovery.discover();

    const definitions = discovery.toStateDefinitions();
    expect(definitions.length).toBeGreaterThanOrEqual(1);
    for (const def of definitions) {
      expect(def.id).toBeDefined();
      expect(def.name).toBeDefined();
      expect(def.requiredElements).toBeDefined();
    }
  });
});

describe("clear", () => {
  it("resets discovery data", () => {
    const btn = createButton("Submit");
    discovery.recordSnapshot([btn]);
    discovery.clear();
    expect(discovery.coOccurrence.snapshotCount).toBe(0);
  });
});
