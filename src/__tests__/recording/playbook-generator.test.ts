import { describe, it, expect, beforeEach } from "vitest";
import { PlaybookGenerator } from "../../recording/playbook-generator";
import type { RecordingSession } from "../../recording/session-recorder";

let generator: PlaybookGenerator;

beforeEach(() => {
  generator = new PlaybookGenerator();
});

function makeSession(): RecordingSession {
  return {
    id: "sess-1",
    startedAt: Date.now(),
    events: [
      {
        id: "e1",
        timestamp: Date.now(),
        type: "action",
        data: {
          actionType: "click",
          elementId: "btn-login",
          elementLabel: "Login",
          success: true,
          durationMs: 200,
        },
      },
      {
        id: "e2",
        timestamp: Date.now() + 100,
        type: "stateChange",
        data: {
          entered: ["dashboard"],
          exited: ["login-form"],
          activeStates: ["dashboard"],
        },
      },
      {
        id: "e3",
        timestamp: Date.now() + 200,
        type: "action",
        data: {
          actionType: "type",
          elementId: "input-search",
          elementLabel: "Search",
          params: { text: "hello" },
          success: true,
          durationMs: 150,
        },
      },
    ],
  };
}

describe("PlaybookGenerator", () => {
  it("generates a playbook from a session", () => {
    const playbook = generator.generate(makeSession(), "Login Flow");

    expect(playbook.name).toBe("Login Flow");
    expect(playbook.steps).toHaveLength(2);
    expect(playbook.steps[0].action).toBe("click");
    expect(playbook.steps[0].target.id).toBe("btn-login");
    expect(playbook.steps[0].expectedStateAfter).toBe("dashboard");
    expect(playbook.steps[1].action).toBe("type");
    expect(playbook.steps[1].params).toEqual({ text: "hello" });
  });

  it("skips failed actions", () => {
    const session: RecordingSession = {
      id: "sess-2",
      startedAt: Date.now(),
      events: [
        {
          id: "e1",
          timestamp: Date.now(),
          type: "action",
          data: {
            actionType: "click",
            elementId: "btn-1",
            success: false,
            durationMs: 50,
          },
        },
      ],
    };

    const playbook = generator.generate(session, "Test");
    expect(playbook.steps).toHaveLength(0);
  });

  it("converts playbook to FlowDefinition", () => {
    const playbook = generator.generate(makeSession(), "Test Flow");
    const flow = generator.toFlowDefinition(playbook);

    expect(flow.name).toBe("Test Flow");
    expect(flow.steps).toHaveLength(2);
    expect(flow.steps[0].action).toBe("click");
    expect(flow.steps[0].target).toHaveProperty("id", "btn-login");
  });

  it("converts playbook to ActionStep[]", () => {
    const playbook = generator.generate(makeSession(), "Test");
    const steps = generator.toActionSteps(playbook);

    expect(steps).toHaveLength(2);
    expect(steps[0].action).toBe("click");
    expect(steps[0].target).toHaveProperty("id", "btn-login");
    expect(steps[1].action).toBe("type");
    expect(steps[1].waitAfter).toBeDefined();
    expect(steps[1].waitAfter?.type).toBe("time");
  });

  it("sets createdFrom to session id", () => {
    const playbook = generator.generate(makeSession(), "Test");
    expect(playbook.createdFrom).toBe("sess-1");
  });
});
