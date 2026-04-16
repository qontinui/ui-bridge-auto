import { describe, it, expect, beforeEach } from "vitest";
import { retargetForClick } from "../../actions/mouse-actions";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("retargetForClick", () => {
  it("returns the element unchanged when it is a button", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    expect(retargetForClick(btn)).toBe(btn);
  });

  it("returns the element unchanged when it is an anchor", () => {
    const a = document.createElement("a");
    a.href = "#";
    document.body.appendChild(a);
    expect(retargetForClick(a)).toBe(a);
  });

  it("returns the element unchanged when it has role=button", () => {
    const span = document.createElement("span");
    span.setAttribute("role", "button");
    document.body.appendChild(span);
    expect(retargetForClick(span)).toBe(span);
  });

  it("retargets from a non-interactive wrapper div to its single button child", () => {
    // Mirrors the AI-toggle bug: <div title="..."><button/></div>
    const wrapper = document.createElement("div");
    wrapper.setAttribute("title", "Generate with AI");
    const btn = document.createElement("button");
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(btn);
  });

  it("retargets from a wrapper to a role=button descendant", () => {
    const wrapper = document.createElement("div");
    const inner = document.createElement("span");
    inner.setAttribute("role", "button");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(inner);
  });

  it("retargets to role=switch (toggle buttons)", () => {
    const wrapper = document.createElement("div");
    const toggle = document.createElement("div");
    toggle.setAttribute("role", "switch");
    wrapper.appendChild(toggle);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(toggle);
  });

  it("does NOT retarget when wrapper has multiple interactive descendants", () => {
    const wrapper = document.createElement("div");
    const btn1 = document.createElement("button");
    const btn2 = document.createElement("button");
    wrapper.appendChild(btn1);
    wrapper.appendChild(btn2);
    document.body.appendChild(wrapper);

    // Ambiguous — click the wrapper as requested, don't guess.
    expect(retargetForClick(wrapper)).toBe(wrapper);
  });

  it("does NOT retarget when wrapper has zero interactive descendants", () => {
    const wrapper = document.createElement("div");
    const span = document.createElement("span");
    wrapper.appendChild(span);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(wrapper);
  });

  it("treats tabindex=-1 as non-interactive (not a retarget candidate)", () => {
    const wrapper = document.createElement("div");
    const inner = document.createElement("span");
    inner.setAttribute("tabindex", "-1");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    // tabindex=-1 is focusable programmatically but not via keyboard;
    // don't treat it as a clickable child.
    expect(retargetForClick(wrapper)).toBe(wrapper);
  });

  it("treats tabindex=0 as interactive (is a retarget candidate)", () => {
    const wrapper = document.createElement("div");
    const inner = document.createElement("span");
    inner.setAttribute("tabindex", "0");
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(inner);
  });

  it("retargets to input[type=checkbox] descendant", () => {
    const wrapper = document.createElement("div");
    const input = document.createElement("input");
    input.type = "checkbox";
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    expect(retargetForClick(wrapper)).toBe(input);
  });
});
