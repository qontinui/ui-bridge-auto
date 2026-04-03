import { describe, it, expect, beforeEach } from "vitest";
import { generateStableId } from "../../discovery/stable-id";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("generateStableId", () => {
  it("returns data-testid when present (highest priority)", () => {
    const el = document.createElement("button");
    el.setAttribute("data-testid", "submit-btn");
    el.setAttribute("data-ui-id", "other-id");
    el.id = "my-btn";
    document.body.appendChild(el);

    expect(generateStableId(el)).toBe("submit-btn");
  });

  it("returns data-ui-id when data-testid is absent", () => {
    const el = document.createElement("button");
    el.setAttribute("data-ui-id", "ui-submit");
    el.id = "my-btn";
    document.body.appendChild(el);

    expect(generateStableId(el)).toBe("ui-submit");
  });

  it("returns intentional HTML id when no data attributes", () => {
    const el = document.createElement("button");
    el.id = "main-submit";
    document.body.appendChild(el);

    expect(generateStableId(el)).toBe("main-submit");
  });

  it("rejects hex-looking HTML ids as random hashes", () => {
    const el = document.createElement("button");
    el.id = "a1b2c3d4e5f6";
    el.textContent = "Submit";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    // Should NOT return the hex id, should construct from role+text
    expect(stableId).not.toBe("a1b2c3d4e5f6");
    expect(stableId).toContain("button");
  });

  it("rejects React-generated :r0: style ids", () => {
    const el = document.createElement("input");
    el.id = ":r0:";
    el.setAttribute("type", "text");
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).not.toBe(":r0:");
  });

  it("rejects UUID-like ids", () => {
    const el = document.createElement("div");
    el.id = "550e8400-e29b-41d4-a716-446655440000";
    el.textContent = "Content";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).not.toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("rejects uid-prefixed hash ids", () => {
    const el = document.createElement("button");
    el.id = "uid-a1b2c3d4";
    el.textContent = "Click";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).not.toBe("uid-a1b2c3d4");
  });

  it("constructs id from role + text + landmark", () => {
    const el = document.createElement("button");
    el.textContent = "Save Changes";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).toContain("button");
    expect(stableId).toContain("save-changes");
  });

  it("constructs id using nearest landmark context", () => {
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Main Navigation");
    const btn = document.createElement("button");
    btn.textContent = "Home";
    nav.appendChild(btn);
    document.body.appendChild(nav);

    const stableId = generateStableId(btn);
    expect(stableId).toContain("button");
    expect(stableId).toContain("home");
    // Should include a landmark reference
    expect(stableId).toContain("navigation");
  });

  it("uses heading text as landmark context", () => {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = "User Settings";
    section.appendChild(heading);
    const btn = document.createElement("button");
    btn.textContent = "Save";
    section.appendChild(btn);
    document.body.appendChild(section);

    const stableId = generateStableId(btn);
    expect(stableId).toContain("button");
    expect(stableId).toContain("save");
  });

  it("falls back to root when no landmark found", () => {
    const el = document.createElement("button");
    el.textContent = "OK";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).toContain("root");
  });

  it("infers correct role for input[type=checkbox]", () => {
    const el = document.createElement("input");
    el.setAttribute("type", "checkbox");
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).toContain("checkbox");
  });

  it("is deterministic — same element always produces same id", () => {
    const el = document.createElement("button");
    el.textContent = "Submit";
    el.setAttribute("data-testid", "submit");
    document.body.appendChild(el);

    const id1 = generateStableId(el);
    const id2 = generateStableId(el);
    expect(id1).toBe(id2);
  });
});
