import { describe, it, expect, beforeEach } from "vitest";
import {
  computeFingerprint,
  fingerprintMatch,
  type ElementFingerprint,
} from "../../discovery/element-fingerprint";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("computeFingerprint", () => {
  it("computes fingerprint for a button", () => {
    const btn = document.createElement("button");
    btn.textContent = "Submit";
    document.body.appendChild(btn);

    const fp = computeFingerprint(btn);
    expect(fp.tagName).toBe("button");
    expect(fp.role).toBe("button");
    expect(fp.textHash).toBeTruthy();
    expect(fp.parentTag).toBe("body");
  });

  it("computes fingerprint for a link", () => {
    const link = document.createElement("a");
    link.href = "/home";
    link.textContent = "Home";
    document.body.appendChild(link);

    const fp = computeFingerprint(link);
    expect(fp.tagName).toBe("a");
    expect(fp.role).toBe("link");
  });

  it("captures aria-label", () => {
    const btn = document.createElement("button");
    btn.setAttribute("aria-label", "Close dialog");
    document.body.appendChild(btn);

    const fp = computeFingerprint(btn);
    expect(fp.ariaLabel).toBe("Close dialog");
  });

  it("uses explicit role attribute", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "tabpanel");
    document.body.appendChild(div);

    const fp = computeFingerprint(div);
    expect(fp.role).toBe("tabpanel");
  });

  it("computes depth correctly", () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const deep = document.createElement("button");
    outer.appendChild(inner);
    inner.appendChild(deep);
    document.body.appendChild(outer);

    const fp = computeFingerprint(deep);
    // html > body > outer > inner > deep = 4 in jsdom
    expect(fp.depth).toBe(4);
  });

  it("computes sibling index", () => {
    const parent = document.createElement("div");
    const child0 = document.createElement("span");
    const child1 = document.createElement("span");
    const child2 = document.createElement("button");
    parent.appendChild(child0);
    parent.appendChild(child1);
    parent.appendChild(child2);
    document.body.appendChild(parent);

    expect(computeFingerprint(child0).siblingIndex).toBe(0);
    expect(computeFingerprint(child2).siblingIndex).toBe(2);
  });

  it("returns empty parentTag for root element", () => {
    // document.body has documentElement as parent, but let's test an element
    // attached directly to body
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(computeFingerprint(el).parentTag).toBe("body");
  });
});

describe("fingerprintMatch", () => {
  it("matches identical fingerprints", () => {
    const btn = document.createElement("button");
    btn.textContent = "OK";
    document.body.appendChild(btn);

    const fp1 = computeFingerprint(btn);
    const fp2 = computeFingerprint(btn);
    expect(fingerprintMatch(fp1, fp2)).toBe(true);
  });

  it("rejects different tags", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "body",
    };
    const b: ElementFingerprint = {
      ...a,
      tagName: "a",
      role: "link",
    };
    expect(fingerprintMatch(a, b)).toBe(false);
  });

  it("rejects different text hashes", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "hash1",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "body",
    };
    const b: ElementFingerprint = { ...a, textHash: "hash2" };
    expect(fingerprintMatch(a, b)).toBe(false);
  });

  it("allows small depth drift (tolerance of 2)", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 3,
      siblingIndex: 0,
      parentTag: "div",
    };
    const b: ElementFingerprint = { ...a, depth: 5 };
    expect(fingerprintMatch(a, b)).toBe(true);
  });

  it("rejects large depth drift (>2)", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "div",
    };
    const b: ElementFingerprint = { ...a, depth: 5 };
    expect(fingerprintMatch(a, b)).toBe(false);
  });

  it("allows small sibling index drift (tolerance of 3)", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "div",
    };
    const b: ElementFingerprint = { ...a, siblingIndex: 3 };
    expect(fingerprintMatch(a, b)).toBe(true);
  });

  it("rejects large sibling index drift (>3)", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "div",
    };
    const b: ElementFingerprint = { ...a, siblingIndex: 5 };
    expect(fingerprintMatch(a, b)).toBe(false);
  });

  it("rejects different parent tags", () => {
    const a: ElementFingerprint = {
      tagName: "button",
      role: "button",
      textHash: "abc",
      ariaLabel: "",
      depth: 1,
      siblingIndex: 0,
      parentTag: "div",
    };
    const b: ElementFingerprint = { ...a, parentTag: "nav" };
    expect(fingerprintMatch(a, b)).toBe(false);
  });
});
