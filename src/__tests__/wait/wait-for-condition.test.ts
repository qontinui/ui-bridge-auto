import { describe, it, expect } from "vitest";
import { waitForCondition } from "../../wait/wait-for-condition";
import { TimeoutError } from "../../wait/types";

describe("waitForCondition", () => {
  it("resolves immediately when condition is already true", async () => {
    await expect(
      waitForCondition({ condition: () => true }),
    ).resolves.toBeUndefined();
  });

  it("resolves when condition becomes true after polling", async () => {
    let counter = 0;
    const condition = () => {
      counter++;
      return counter >= 3;
    };

    await waitForCondition({
      condition,
      interval: 10,
      timeout: 5000,
    });

    expect(counter).toBeGreaterThanOrEqual(3);
  });

  it("rejects with TimeoutError when condition never becomes true", async () => {
    await expect(
      waitForCondition({
        condition: () => false,
        interval: 10,
        timeout: 100,
      }),
    ).rejects.toThrow(TimeoutError);
  });

  it("supports async condition function", async () => {
    let counter = 0;
    const condition = async () => {
      counter++;
      return counter >= 2;
    };

    await waitForCondition({
      condition,
      interval: 10,
      timeout: 5000,
    });

    expect(counter).toBeGreaterThanOrEqual(2);
  });

  it("rejects when condition throws", async () => {
    const condition = () => {
      throw new Error("condition error");
    };

    // First call is the fast-path, which will throw
    await expect(
      waitForCondition({ condition }),
    ).rejects.toThrow("condition error");
  });

  it("rejects when abort signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      waitForCondition({
        condition: () => false,
        signal: controller.signal,
        timeout: 5000,
      }),
    ).rejects.toThrow();
  });

  it("uses custom polling interval", async () => {
    let callCount = 0;
    const condition = () => {
      callCount++;
      return callCount >= 5;
    };

    const start = Date.now();
    await waitForCondition({
      condition,
      interval: 20,
      timeout: 5000,
    });
    const elapsed = Date.now() - start;

    // With interval=20 and needing 4 polls (fast path uses 1), should take ~80ms
    // Allow generous margin for CI
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });
});
