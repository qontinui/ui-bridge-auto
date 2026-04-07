import { describe, it, expect, beforeEach } from "vitest";
import { waitForElement } from "../../wait/wait-for-element";
import { TimeoutError } from "../../wait/types";
import { MockRegistry } from "../../test-utils/mock-registry";
import {
  createButton,
  resetIdCounter,
} from "../../test-utils/mock-elements";

let registry: MockRegistry;

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
  registry = new MockRegistry();
});

describe("waitForElement", () => {
  it("resolves immediately when element already exists", async () => {
    const btn = createButton("Submit");
    registry.addElement(btn);

    const result = await waitForElement({
      query: { tagName: "button" },
      registry,
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe(btn.id);
  });

  it("resolves when element appears after delay", async () => {
    const promise = waitForElement({
      query: { tagName: "button" },
      registry,
      timeout: 5000,
    });

    // Add element after a microtask
    setTimeout(() => {
      const btn = createButton("Late Button");
      registry.addElement(btn);
    }, 50);

    const result = await promise;
    expect(result).not.toBeNull();
    expect(result.type).toBe("button");
  });

  it("rejects with TimeoutError when element never appears", async () => {
    await expect(
      waitForElement({
        query: { tagName: "button" },
        registry,
        timeout: 100,
      }),
    ).rejects.toThrow(TimeoutError);
  });

  it("rejects when AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForElement({
        query: { tagName: "button" },
        registry,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("rejects when AbortSignal fires during wait", async () => {
    const controller = new AbortController();

    const promise = waitForElement({
      query: { tagName: "button" },
      registry,
      timeout: 5000,
      signal: controller.signal,
    });

    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toThrow();
  });

  it("resolves via stateChanged event", async () => {
    // Add a hidden button first
    const btn = createButton("Hidden");
    registry.addElement(btn);

    const promise = waitForElement({
      query: { tagName: "button", text: "Visible" },
      registry,
      timeout: 5000,
    });

    // Later, add a matching element via stateChanged
    setTimeout(() => {
      const btn2 = createButton("Visible");
      registry.addElement(btn2);
    }, 50);

    const result = await promise;
    expect(result).not.toBeNull();
  });
});
