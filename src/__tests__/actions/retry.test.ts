import { describe, it, expect } from "vitest";
import {
  withRetry,
  computeDelay,
  createDefaultRetryOptions,
} from "../../actions/retry";

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  it("succeeds on first attempt", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        return "ok";
      },
      { maxAttempts: 3, initialDelayMs: 1, multiplier: 2, maxDelayMs: 100 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "recovered";
      },
      { maxAttempts: 5, initialDelayMs: 1, multiplier: 1, maxDelayMs: 10 },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("throws after maxAttempts exhausted", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("always fails");
        },
        { maxAttempts: 3, initialDelayMs: 1, multiplier: 1, maxDelayMs: 10 },
      ),
    ).rejects.toThrow("always fails");

    expect(attempts).toBe(3);
  });

  it("respects retryOn predicate — only retries matching errors", async () => {
    let attempts = 0;

    await expect(
      withRetry(
        async () => {
          attempts++;
          throw new Error("permanent");
        },
        {
          maxAttempts: 5,
          initialDelayMs: 1,
          multiplier: 1,
          maxDelayMs: 10,
          retryOn: (err) => (err as Error).message !== "permanent",
        },
      ),
    ).rejects.toThrow("permanent");

    // Should not retry because retryOn returns false
    expect(attempts).toBe(1);
  });

  it("retries when retryOn returns true", async () => {
    let attempts = 0;

    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "done";
      },
      {
        maxAttempts: 5,
        initialDelayMs: 1,
        multiplier: 1,
        maxDelayMs: 10,
        retryOn: (err) => (err as Error).message === "transient",
      },
    );

    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeDelay
// ---------------------------------------------------------------------------

describe("computeDelay", () => {
  it("attempt 0 returns initialDelayMs", () => {
    const delay = computeDelay(0, { initialDelayMs: 100, multiplier: 2, maxDelayMs: 10000 });
    expect(delay).toBe(100);
  });

  it("attempt 1 returns initialDelayMs * multiplier", () => {
    const delay = computeDelay(1, { initialDelayMs: 100, multiplier: 2, maxDelayMs: 10000 });
    expect(delay).toBe(200);
  });

  it("applies exponential backoff (attempt 3)", () => {
    const delay = computeDelay(3, { initialDelayMs: 100, multiplier: 2, maxDelayMs: 100000 });
    // 100 * 2^3 = 800
    expect(delay).toBe(800);
  });

  it("caps at maxDelayMs", () => {
    const delay = computeDelay(10, { initialDelayMs: 100, multiplier: 2, maxDelayMs: 5000 });
    expect(delay).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// createDefaultRetryOptions
// ---------------------------------------------------------------------------

describe("createDefaultRetryOptions", () => {
  it("returns sensible defaults", () => {
    const opts = createDefaultRetryOptions();

    expect(opts.maxAttempts).toBeGreaterThanOrEqual(2);
    expect(opts.initialDelayMs).toBeGreaterThan(0);
    expect(opts.multiplier).toBeGreaterThanOrEqual(1);
    expect(opts.maxDelayMs).toBeGreaterThan(opts.initialDelayMs);
  });
});
