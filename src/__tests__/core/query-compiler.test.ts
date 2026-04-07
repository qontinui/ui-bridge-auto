import { describe, it, expect, beforeEach } from "vitest";
import { compileQuery, QueryCache } from "../../core/query-compiler";
import { matchesQuery } from "../../core/element-query";
import type { ElementQuery } from "../../core/element-query";
import {
  createButton,
  createInput,
  createLink,
  resetIdCounter,
} from "../../test-utils/mock-elements";

beforeEach(() => {
  resetIdCounter();
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// compileQuery
// ---------------------------------------------------------------------------

describe("compileQuery", () => {
  it("compiled query produces same match results as matchesQuery", () => {
    const query: ElementQuery = { tagName: "button" };
    const compiled = compileQuery(query);

    const btn = createButton("Submit");
    const link = createLink("Home", "/");

    const directBtnMatch = matchesQuery(btn, query).matches;
    const compiledBtnMatch = compiled.matches(btn);
    expect(compiledBtnMatch).toBe(directBtnMatch);

    const directLinkMatch = matchesQuery(link, query).matches;
    const compiledLinkMatch = compiled.matches(link);
    expect(compiledLinkMatch).toBe(directLinkMatch);
  });

  it("matches() returns true for matching element", () => {
    const compiled = compileQuery({ role: "button" });
    const btn = createButton("Click");
    expect(compiled.matches(btn)).toBe(true);
  });

  it("matches() returns false for non-matching element", () => {
    const compiled = compileQuery({ role: "button" });
    const input = createInput("Name");
    expect(compiled.matches(input)).toBe(false);
  });

  it("test() returns true when any element in collection matches", () => {
    const compiled = compileQuery({ tagName: "button" });
    const link = createLink("Home", "/");
    const btn = createButton("Submit");
    expect(compiled.test([link, btn])).toBe(true);
  });

  it("test() returns false when no element matches", () => {
    const compiled = compileQuery({ tagName: "select" });
    const btn = createButton("Submit");
    const link = createLink("Home", "/");
    expect(compiled.test([btn, link])).toBe(false);
  });

  it("execute() returns all matching elements", () => {
    const compiled = compileQuery({ tagName: "button" });
    const btn1 = createButton("A");
    const btn2 = createButton("B");
    const link = createLink("C", "/");

    const results = compiled.execute([btn1, btn2, link]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toContain(btn1.id);
    expect(results.map((r) => r.id)).toContain(btn2.id);
  });

  it("first() returns first matching element", () => {
    const compiled = compileQuery({ tagName: "button" });
    const link = createLink("Home", "/");
    const btn = createButton("Submit");

    const result = compiled.first([link, btn]);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(btn.id);
  });

  it("first() returns null when no match", () => {
    const compiled = compileQuery({ tagName: "select" });
    const btn = createButton("Submit");
    expect(compiled.first([btn])).toBeNull();
  });

  it("preserves the original query on the compiled object", () => {
    const query: ElementQuery = { role: "button", text: "Save" };
    const compiled = compileQuery(query);
    expect(compiled.source.role).toBe("button");
    expect(compiled.source.text).toBe("Save");
  });
});

// ---------------------------------------------------------------------------
// QueryCache
// ---------------------------------------------------------------------------

describe("QueryCache", () => {
  it("returns same compiled instance for same query", () => {
    const cache = new QueryCache();
    const query: ElementQuery = { role: "button" };

    const first = cache.get(query);
    const second = cache.get(query);
    expect(first).toBe(second);
  });

  it("tracks cache size", () => {
    const cache = new QueryCache();
    expect(cache.size).toBe(0);

    cache.get({ role: "button" });
    expect(cache.size).toBe(1);

    cache.get({ role: "link" });
    expect(cache.size).toBe(2);
  });

  it("invalidate clears all entries", () => {
    const cache = new QueryCache();
    cache.get({ role: "button" });
    cache.get({ role: "link" });
    expect(cache.size).toBe(2);

    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it("respects maxSize by evicting oldest entry", () => {
    const cache = new QueryCache(2);

    cache.get({ role: "button" });
    cache.get({ role: "link" });
    expect(cache.size).toBe(2);

    // Adding a third should evict the first
    cache.get({ role: "textbox" });
    expect(cache.size).toBe(2);
  });

  it("different queries produce different cache entries", () => {
    const cache = new QueryCache();
    const a = cache.get({ role: "button" });
    const b = cache.get({ role: "link" });
    expect(a).not.toBe(b);
  });
});
