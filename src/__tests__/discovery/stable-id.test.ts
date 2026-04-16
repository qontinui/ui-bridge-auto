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

  it("prefers aria-label over textContent for slug source", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Generate with AI spec-brief");
    el.textContent = "Some visible label that changes";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).toContain("button");
    expect(stableId).toContain("generate-with-ai-spec-brief");
    expect(stableId).not.toContain("some-visible-label");
  });

  it("prefers title over textContent when aria-label is absent", () => {
    const el = document.createElement("button");
    el.setAttribute("title", "Generate with AI spec-brief");
    el.textContent = "icon";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    expect(stableId).toContain("button");
    expect(stableId).toContain("generate-with-ai-spec-brief");
    expect(stableId).not.toContain("icon");
    // Must NOT contain a positional -1/-2 integer suffix
    expect(stableId).not.toMatch(/-\d+$/);
  });

  it("does not append positional integer when no collision context is provided", () => {
    const el = document.createElement("button");
    el.textContent = "Save";
    document.body.appendChild(el);

    const stableId = generateStableId(el);
    // Used to be 'button-save-root-2' style with positional drift; now plain.
    expect(stableId).not.toMatch(/-\d+$/);
  });

  it("disambiguates collisions with a stable DOM-path hash (not positional)", () => {
    const a = document.createElement("button");
    a.setAttribute("title", "Generate");
    const b = document.createElement("button");
    b.setAttribute("title", "Generate");
    document.body.appendChild(a);
    document.body.appendChild(b);

    const issued = new Set<string>();
    const idA = generateStableId(a, issued);
    issued.add(idA);
    const idB = generateStableId(b, issued);

    expect(idA).not.toBe(idB);
    // First one has no hash suffix; second has a 6-char hex hash suffix.
    expect(idA).toMatch(/^button-generate-root$/);
    expect(idB).toMatch(/^button-generate-root-[0-9a-f]{6}$/);
  });

  it("collision hash is stable across repeated calls (deterministic)", () => {
    const a = document.createElement("button");
    a.setAttribute("title", "Run");
    const b = document.createElement("button");
    b.setAttribute("title", "Run");
    document.body.appendChild(a);
    document.body.appendChild(b);

    const issued1 = new Set<string>([generateStableId(a)]);
    const issued2 = new Set<string>([generateStableId(a)]);
    const idB1 = generateStableId(b, issued1);
    const idB2 = generateStableId(b, issued2);

    expect(idB1).toBe(idB2);
  });
});
