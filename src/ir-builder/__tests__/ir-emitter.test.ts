/**
 * Unit tests for the IR emitter — determinism + shape mapping.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";

import {
  buildIRDocument,
  buildIRDocumentWithWarnings,
  serializeIRDocument,
  IRBuildError,
} from "../ir-emitter";
import type { ExtractedDeclaration } from "../extractor";

const STATE_LOGIN: ExtractedDeclaration = {
  kind: "state",
  file: "src/Login.tsx",
  line: 10,
  column: 11,
  props: {
    id: "login",
    name: "Login",
    requiredElements: [{ role: "button", text: "Login" }],
  },
};

const STATE_DASHBOARD: ExtractedDeclaration = {
  kind: "state",
  file: "src/Dashboard.tsx",
  line: 4,
  column: 11,
  props: {
    id: "dashboard",
    name: "Dashboard",
    requiredElements: [{ role: "heading", text: "Dashboard" }],
    isInitial: true,
  },
};

const TRANSITION: ExtractedDeclaration = {
  kind: "transition",
  file: "src/Login.tsx",
  line: 25,
  column: 11,
  props: {
    id: "open-login",
    name: "Open Login",
    fromStates: ["dashboard"],
    activateStates: ["login"],
    effect: "read",
    actions: [
      {
        type: "click",
        target: { role: "button", text: "Login" },
      },
    ],
  },
};

describe("buildIRDocument", () => {
  it("produces a valid IRDocument with shaped states and transitions", () => {
    const doc = buildIRDocument({
      id: "page",
      name: "Page",
      declarations: [STATE_LOGIN, STATE_DASHBOARD, TRANSITION],
      pluginVersion: "0.1.0",
    });

    expect(doc.version).toBe("1.0");
    expect(doc.id).toBe("page");
    expect(doc.states).toHaveLength(2);
    expect(doc.transitions).toHaveLength(1);

    // Sorted by id (alphabetical).
    expect(doc.states.map((s) => s.id)).toEqual(["dashboard", "login"]);
    expect(doc.initialState).toBe("dashboard");

    // Provenance preserved.
    expect(doc.states[0].provenance).toMatchObject({
      source: "build-plugin",
      file: "src/Dashboard.tsx",
      line: 4,
      column: 11,
      pluginVersion: "0.1.0",
    });

    // Transition shaping.
    const t = doc.transitions[0];
    expect(t.actions).toEqual([
      { type: "click", target: { role: "button", text: "Login" } },
    ]);
    expect(t.effect).toBe("read");
  });

  it("lifts legacy elements: string[] -> requiredElements: [{id}]", () => {
    const doc = buildIRDocument({
      id: "p",
      name: "P",
      declarations: [
        {
          kind: "state",
          file: "src/x.tsx",
          line: 1,
          props: {
            id: "s",
            name: "S",
            elements: ["a", "b"],
          },
        },
      ],
    });

    expect(doc.states[0].assertions.map((a) => a.target.criteria)).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("prefers requiredElements over legacy elements when both present", () => {
    const doc = buildIRDocument({
      id: "p",
      name: "P",
      declarations: [
        {
          kind: "state",
          file: "src/x.tsx",
          line: 1,
          props: {
            id: "s",
            name: "S",
            requiredElements: [{ role: "button" }],
            elements: ["a", "b"],
          },
        },
      ],
    });

    expect(doc.states[0].assertions.map((a) => a.target.criteria)).toEqual([
      { role: "button" },
    ]);
  });

  it("throws on duplicate state ids with both source locations", () => {
    expect(() =>
      buildIRDocument({
        id: "p",
        name: "P",
        declarations: [
          {
            kind: "state",
            file: "src/A.tsx",
            line: 5,
            props: { id: "dup", name: "A", requiredElements: [] },
          },
          {
            kind: "state",
            file: "src/B.tsx",
            line: 12,
            props: { id: "dup", name: "B", requiredElements: [] },
          },
        ],
      }),
    ).toThrowError(/dup.*src\/A\.tsx:5.*src\/B\.tsx:12/s);
  });

  it("throws on duplicate transition ids", () => {
    expect(() =>
      buildIRDocument({
        id: "p",
        name: "P",
        declarations: [
          {
            kind: "transition",
            file: "src/A.tsx",
            line: 5,
            props: {
              id: "t",
              name: "A",
              fromStates: ["x"],
              activateStates: ["y"],
            },
          },
          {
            kind: "transition",
            file: "src/B.tsx",
            line: 12,
            props: {
              id: "t",
              name: "B",
              fromStates: ["x"],
              activateStates: ["y"],
            },
          },
        ],
      }),
    ).toThrowError(IRBuildError);
  });

  it("captures warnings for unsupported computed props", () => {
    const { document, warnings } = buildIRDocumentWithWarnings({
      id: "p",
      name: "P",
      declarations: [
        {
          kind: "state",
          file: "src/X.tsx",
          line: 7,
          props: {
            id: "x",
            name: { __unsupported__: true, expression: "getName()", line: 7 },
            requiredElements: [],
          },
        },
      ],
    });

    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.message.includes("Unsupported computed expression"))).toBe(true);
    // Missing required name -> declaration skipped.
    expect(document.states).toHaveLength(0);
  });
});

describe("serializeIRDocument", () => {
  it("is byte-for-byte identical across two calls (determinism)", () => {
    const doc = buildIRDocument({
      id: "page",
      name: "Page",
      declarations: [STATE_LOGIN, STATE_DASHBOARD, TRANSITION],
      pluginVersion: "0.1.0",
    });

    const a = serializeIRDocument(doc);
    const b = serializeIRDocument(doc);
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
  });

  it("produces identical output regardless of declaration input order", () => {
    const a = serializeIRDocument(
      buildIRDocument({
        id: "page",
        name: "Page",
        declarations: [STATE_LOGIN, STATE_DASHBOARD, TRANSITION],
        pluginVersion: "0.1.0",
      }),
    );
    const b = serializeIRDocument(
      buildIRDocument({
        id: "page",
        name: "Page",
        declarations: [TRANSITION, STATE_DASHBOARD, STATE_LOGIN],
        pluginVersion: "0.1.0",
      }),
    );
    expect(a).toBe(b);
  });

  it("alphabetizes object keys at every depth", () => {
    const doc = buildIRDocument({
      id: "page",
      name: "Page",
      declarations: [STATE_LOGIN],
      pluginVersion: "0.1.0",
    });
    const json = serializeIRDocument(doc);

    // The first appearance of "id" in the document body must come BEFORE
    // the first appearance of "name" (alphabetical key sort).
    const idIdx = json.indexOf('"id"');
    const nameIdx = json.indexOf('"name"');
    expect(idIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeGreaterThan(-1);
    expect(idIdx).toBeLessThan(nameIdx);
  });

  it("omits undefined optional fields", () => {
    const doc = buildIRDocument({
      id: "p",
      name: "P",
      declarations: [
        {
          kind: "state",
          file: "x.tsx",
          line: 1,
          props: { id: "s", name: "S", requiredElements: [] },
        },
      ],
    });
    const json = serializeIRDocument(doc);
    expect(json).not.toContain('"description"');
    expect(json).not.toContain('"blocking"');
    expect(json).not.toContain('"isInitial"');
  });

  it("contains no timestamps or millisecond fields", () => {
    const doc = buildIRDocument({
      id: "p",
      name: "P",
      declarations: [STATE_LOGIN, TRANSITION],
      pluginVersion: "0.1.0",
    });
    const json = serializeIRDocument(doc);
    expect(json).not.toMatch(/"capturedAt"|"timestamp"|"createdAt"|"updatedAt"/);
  });
});
