/**
 * Validation guards for action params that previously fell through to
 * silent success when required keys were missing or aliased to the wrong
 * name. Each guard throws a descriptive error with a hint when callers
 * pass a recognizably-aliased key (e.g. `value` to `type` action, or
 * `text` to `setValue` action).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { performType, performSendKeys } from "../../actions/keyboard-actions";
import { performSelect, performSetValue } from "../../actions/form-actions";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("performType — text param validation", () => {
  it("throws when params is undefined", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    await expect(performType(input)).rejects.toThrow(/'text' string parameter/);
  });

  it("throws when text is missing", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    await expect(performType(input, {})).rejects.toThrow(/'text' string parameter/);
  });

  it("hints when caller passed `value` (the select/setValue alias)", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    await expect(
      performType(input, { value: "hello" } as unknown as { text: string }),
    ).rejects.toThrow(/Got `value`.*expects `text`/);
  });

  it("does not hint when caller passed neither key", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      await performType(input, {});
      throw new Error("expected throw");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/'text' string parameter/);
      expect(msg).not.toMatch(/Got `value`/);
    }
  });

  it("succeeds when text is a valid string", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    await performType(input, { text: "hi" });
    expect(input.value).toBe("hi");
  });

  it("rejects empty-string text? actually empty string is permitted (valid no-op type)", async () => {
    // Documented behavior: text === "" is treated as a no-op type, NOT a guard violation.
    // (This locks in the contract: only missing/non-string text triggers the guard.)
    const input = document.createElement("input");
    document.body.appendChild(input);
    await performType(input, { text: "" });
    expect(input.value).toBe("");
  });
});

describe("performSendKeys — keys param validation", () => {
  it("throws when params is undefined", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    await expect(performSendKeys(div)).rejects.toThrow(/'keys' array/);
  });

  it("throws when keys is missing", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    await expect(performSendKeys(div, {})).rejects.toThrow(/'keys' array/);
  });

  it("throws on empty keys array (not silent success)", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    await expect(performSendKeys(div, { keys: [] })).rejects.toThrow(/non-empty 'keys' array/);
  });

  it("succeeds with a non-empty keys array", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    let keydownFired = false;
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter") keydownFired = true;
    });
    await performSendKeys(div, { keys: [{ key: "Enter" }] });
    expect(keydownFired).toBe(true);
  });
});

describe("performSelect — value param validation", () => {
  it("throws when params is undefined", async () => {
    const select = document.createElement("select");
    document.body.appendChild(select);
    await expect(performSelect(select)).rejects.toThrow(/'value' parameter/);
  });

  it("throws when value is missing", async () => {
    const select = document.createElement("select");
    document.body.appendChild(select);
    await expect(performSelect(select, {})).rejects.toThrow(/'value' parameter/);
  });

  it("throws when value is null (explicit-null is a misuse, not a no-op)", async () => {
    const select = document.createElement("select");
    document.body.appendChild(select);
    await expect(
      performSelect(select, { value: null as unknown as string }),
    ).rejects.toThrow(/'value' parameter/);
  });

  it("succeeds with a string value matching an option", async () => {
    const select = document.createElement("select");
    const opt = document.createElement("option");
    opt.value = "a";
    select.appendChild(opt);
    document.body.appendChild(select);
    await performSelect(select, { value: "a" });
    expect(select.value).toBe("a");
  });
});

describe("performSetValue — value param validation", () => {
  it("throws when params is undefined", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(() => performSetValue(input)).toThrow(/'value' parameter/);
  });

  it("throws when value is missing", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(() => performSetValue(input, {} as { value: string })).toThrow(
      /'value' parameter/,
    );
  });

  it("hints when caller passed `text` (the type-action alias)", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(() =>
      performSetValue(input, { text: "hello" } as unknown as { value: string }),
    ).toThrow(/Got `text`.*expects `value`/);
  });

  it("succeeds with a valid value", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    performSetValue(input, { value: "hi" });
    expect(input.value).toBe("hi");
  });
});
