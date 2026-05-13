/**
 * IR emitter — shapes a flat list of {@link ExtractedDeclaration}s into a
 * deterministic {@link IRDocument}. Determinism is load-bearing: downstream
 * tooling (counterfactual analysis in section 6, the regression generator
 * in section 9) consumes byte-for-byte stable JSON, and CI's `git diff` over
 * the emitted file is the contract for "did the IR change?".
 *
 * Determinism guarantees:
 * - State and transition arrays are sorted by `id`.
 * - Object keys at every depth are alphabetized via {@link serializeIRDocument}.
 * - No timestamps, no random IDs, no `Date.now()` reads.
 */

import type {
  IRAssertion,
  IRDocument,
  IRElementCriteria,
  IRMetadata,
  IRProvenance,
  IRState,
  IRTransition,
  IRTransitionAction,
  IREffect,
  IRVersion,
} from "@qontinui/shared-types/ui-bridge-ir";

import {
  type ExtractedDeclaration,
  type UnsupportedPropMarker,
  isUnsupportedProp,
} from "./extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Build-time warning produced by {@link buildIRDocument}. */
export interface IRBuildWarning {
  /** Source file (forward-slash normalized). */
  file: string;
  /** Source line (1-based). */
  line: number;
  /** Declaration kind that produced the warning. */
  kind: "state" | "transition" | "document";
  /** Declaration id, if available. */
  id?: string;
  /** Human-readable warning. */
  message: string;
}

/** Input to {@link buildIRDocument}. */
export interface BuildIRDocumentInput {
  /** Document-level identifier (e.g., the page or scope name). */
  id: string;
  /** Document-level human-readable name. */
  name: string;
  /** Optional document description. */
  description?: string;
  /** Extracted JSX declarations. */
  declarations: ExtractedDeclaration[];
  /**
   * Override for the provenance source. Defaults to `"build-plugin"`.
   */
  provenanceSource?: IRProvenance["source"];
  /** Plugin version string (e.g., `"0.1.0"`). */
  pluginVersion?: string;
  /**
   * If set, warnings are appended to this array instead of thrown. Otherwise
   * warnings are silent (callers can re-call {@link buildIRDocumentWithWarnings}).
   */
  warnings?: IRBuildWarning[];
}

/** Result of {@link buildIRDocumentWithWarnings}. */
export interface IRBuildResult {
  document: IRDocument;
  warnings: IRBuildWarning[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const IR_VERSION: IRVersion = "1.0";

/**
 * Build an {@link IRDocument} from extracted JSX declarations.
 *
 * Throws on duplicate state or transition ids — the failure includes both
 * source locations to make resolution obvious.
 */
export function buildIRDocument(input: BuildIRDocumentInput): IRDocument {
  return buildIRDocumentWithWarnings(input).document;
}

/**
 * Same as {@link buildIRDocument} but also returns the build warnings list.
 *
 * Warnings cover unsupported computed props, missing required fields, and
 * legacy-shape lifts (`elements: string[]` → `requiredElements`).
 */
export function buildIRDocumentWithWarnings(
  input: BuildIRDocumentInput,
): IRBuildResult {
  const warnings: IRBuildWarning[] = input.warnings ?? [];
  const states: IRState[] = [];
  const transitions: IRTransition[] = [];

  // Track id -> first source location for duplicate detection.
  const stateLocations = new Map<string, { file: string; line: number }>();
  const transitionLocations = new Map<string, { file: string; line: number }>();

  for (const decl of input.declarations) {
    if (decl.kind === "state") {
      const state = shapeState(
        decl,
        warnings,
        input.provenanceSource ?? "build-plugin",
        input.pluginVersion,
      );
      if (!state) continue;

      const prior = stateLocations.get(state.id);
      if (prior) {
        throw new IRBuildError(
          `Duplicate state id "${state.id}" — first declared at ${prior.file}:${prior.line}, again at ${decl.file}:${decl.line}`,
        );
      }
      stateLocations.set(state.id, { file: decl.file, line: decl.line });
      states.push(state);
    } else {
      const transition = shapeTransition(
        decl,
        warnings,
        input.provenanceSource ?? "build-plugin",
        input.pluginVersion,
      );
      if (!transition) continue;

      const prior = transitionLocations.get(transition.id);
      if (prior) {
        throw new IRBuildError(
          `Duplicate transition id "${transition.id}" — first declared at ${prior.file}:${prior.line}, again at ${decl.file}:${decl.line}`,
        );
      }
      transitionLocations.set(transition.id, {
        file: decl.file,
        line: decl.line,
      });
      transitions.push(transition);
    }
  }

  // Determinism: sort by id (stable, lexicographic).
  states.sort(byId);
  transitions.sort(byId);

  const initialState =
    states.find((s) => s.isInitial)?.id ??
    (states.length > 0 ? undefined : undefined);

  const document: IRDocument = {
    version: IR_VERSION,
    id: input.id,
    name: input.name,
    description: input.description,
    states,
    transitions,
    initialState,
  };

  return { document, warnings };
}

/**
 * Serialize an {@link IRDocument} deterministically: alphabetized keys at
 * every depth, two-space indent, trailing newline. Two calls with the same
 * input produce byte-for-byte identical output.
 */
export function serializeIRDocument(doc: IRDocument): string {
  return JSON.stringify(canonicalize(doc), null, 2) + "\n";
}

/** Error thrown by {@link buildIRDocument} for hard build failures. */
export class IRBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IRBuildError";
  }
}

// ---------------------------------------------------------------------------
// State shaping
// ---------------------------------------------------------------------------

function shapeState(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
  source: IRProvenance["source"],
  pluginVersion: string | undefined,
): IRState | undefined {
  const id = readStringProp(decl, "id", warnings);
  const name = readStringProp(decl, "name", warnings);
  if (!id || !name) {
    warnings.push({
      file: decl.file,
      line: decl.line,
      kind: "state",
      id,
      message: `<State> is missing required ${id ? "name" : "id"} prop — declaration skipped`,
    });
    return undefined;
  }

  const description = readOptionalStringProp(decl, "description", warnings);
  const requiredElements = readRequiredElements(decl, warnings);
  const excludedElements = readOptionalCriteriaArray(
    decl,
    "excludedElements",
    warnings,
  );
  const blocking = readOptionalBoolProp(decl, "blocking", warnings);
  const group = readOptionalStringProp(decl, "group", warnings);
  const pathCost = readOptionalNumberProp(decl, "pathCost", warnings);
  const isInitial = readOptionalBoolProp(decl, "isInitial", warnings);
  const isTerminal = readOptionalBoolProp(decl, "isTerminal", warnings);
  const metadata = readMetadata(decl, warnings);

  // Lift the extracted criteria list into the IR's canonical `assertions`
  // shape. Each criterion becomes one synthesized assertion whose
  // `target.criteria` carries the original predicate verbatim — preserving
  // the round-trip property the projection helpers rely on.
  const assertions: IRAssertion[] = requiredElements.map(
    (criteria, idx) => criteriaToAssertion(id, idx, criteria),
  );

  const state: IRState = {
    id,
    name,
    assertions,
    description,
    excludedElements,
    blocking,
    group,
    pathCost,
    isInitial,
    isTerminal,
    metadata,
    provenance: makeProvenance(decl, source, pluginVersion),
  };
  return stripUndefined(state);
}

/**
 * Lift a single `IRElementCriteria` into the canonical `IRAssertion` shape.
 * The id is derived from `(stateId, idx)` so the emitter stays deterministic.
 */
function criteriaToAssertion(
  stateId: string,
  idx: number,
  criteria: IRElementCriteria,
): IRAssertion {
  return {
    id: `${stateId}-elem-${idx}`,
    description: `Required element ${idx}`,
    category: "element-presence",
    severity: "critical",
    assertionType: "exists",
    target: {
      type: "search",
      criteria: criteria as unknown as Record<string, unknown>,
      label: `Required element ${idx}`,
    },
    source: "build-plugin",
    reviewed: false,
    enabled: true,
  };
}

// ---------------------------------------------------------------------------
// Transition shaping
// ---------------------------------------------------------------------------

function shapeTransition(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
  source: IRProvenance["source"],
  pluginVersion: string | undefined,
): IRTransition | undefined {
  const id = readStringProp(decl, "id", warnings);
  const name = readStringProp(decl, "name", warnings);
  if (!id || !name) {
    warnings.push({
      file: decl.file,
      line: decl.line,
      kind: "transition",
      id,
      message: `<TransitionTo> is missing required ${id ? "name" : "id"} prop — declaration skipped`,
    });
    return undefined;
  }

  const fromStates = readStringArrayProp(decl, "fromStates", warnings) ?? [];
  const activateStates =
    readStringArrayProp(decl, "activateStates", warnings) ?? [];
  const exitStates = readStringArrayProp(decl, "exitStates", warnings);
  const description = readOptionalStringProp(decl, "description", warnings);
  const actions = readActionsArray(decl, warnings);
  const pathCost = readOptionalNumberProp(decl, "pathCost", warnings);
  const bidirectional = readOptionalBoolProp(decl, "bidirectional", warnings);
  const effect = readEffect(decl, warnings);
  const metadata = readMetadata(decl, warnings);

  const transition: IRTransition = {
    id,
    name,
    description,
    fromStates,
    activateStates,
    exitStates,
    actions,
    pathCost,
    bidirectional,
    effect,
    metadata,
    provenance: makeProvenance(decl, source, pluginVersion),
  };
  return stripUndefined(transition);
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

function readStringProp(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): string | undefined {
  const value = decl.props[key];
  if (value === undefined) return undefined;
  if (isUnsupportedProp(value)) {
    pushUnsupported(warnings, decl, key, value);
    return undefined;
  }
  if (typeof value === "string") return value;
  pushTypeMismatch(warnings, decl, key, "string", typeof value);
  return undefined;
}

function readOptionalStringProp(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): string | undefined {
  return readStringProp(decl, key, warnings);
}

function readOptionalBoolProp(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): boolean | undefined {
  const value = decl.props[key];
  if (value === undefined) return undefined;
  if (isUnsupportedProp(value)) {
    pushUnsupported(warnings, decl, key, value);
    return undefined;
  }
  if (typeof value === "boolean") return value;
  pushTypeMismatch(warnings, decl, key, "boolean", typeof value);
  return undefined;
}

function readOptionalNumberProp(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): number | undefined {
  const value = decl.props[key];
  if (value === undefined) return undefined;
  if (isUnsupportedProp(value)) {
    pushUnsupported(warnings, decl, key, value);
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  pushTypeMismatch(warnings, decl, key, "number", typeof value);
  return undefined;
}

function readStringArrayProp(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): string[] | undefined {
  const value = decl.props[key];
  if (value === undefined) return undefined;
  if (isUnsupportedProp(value)) {
    pushUnsupported(warnings, decl, key, value);
    return undefined;
  }
  if (!Array.isArray(value)) {
    pushTypeMismatch(warnings, decl, key, "string[]", typeof value);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
    } else if (isUnsupportedProp(item)) {
      pushUnsupported(warnings, decl, `${key}[]`, item);
    } else {
      pushTypeMismatch(warnings, decl, `${key}[]`, "string", typeof item);
    }
  }
  return out;
}

/**
 * Read the `requiredElements` IR-canonical shape; if absent, fall back to
 * the legacy `elements: string[]` form and lift each entry to
 * `{ id: '<entry>' }`.
 */
function readRequiredElements(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
): IRElementCriteria[] {
  const required = readOptionalCriteriaArray(decl, "requiredElements", warnings);
  if (required) return required;

  const legacy = decl.props.elements;
  if (legacy === undefined) return [];
  if (isUnsupportedProp(legacy)) {
    pushUnsupported(warnings, decl, "elements", legacy);
    return [];
  }
  if (!Array.isArray(legacy)) {
    pushTypeMismatch(warnings, decl, "elements", "string[]", typeof legacy);
    return [];
  }

  const out: IRElementCriteria[] = [];
  for (const item of legacy) {
    if (typeof item === "string") {
      out.push({ id: item });
    } else if (isUnsupportedProp(item)) {
      pushUnsupported(warnings, decl, "elements[]", item);
    } else {
      pushTypeMismatch(warnings, decl, "elements[]", "string", typeof item);
    }
  }
  return out;
}

function readOptionalCriteriaArray(
  decl: ExtractedDeclaration,
  key: string,
  warnings: IRBuildWarning[],
): IRElementCriteria[] | undefined {
  const raw = decl.props[key];
  if (raw === undefined) return undefined;
  if (isUnsupportedProp(raw)) {
    pushUnsupported(warnings, decl, key, raw);
    return undefined;
  }
  if (!Array.isArray(raw)) {
    pushTypeMismatch(warnings, decl, key, "object[]", typeof raw);
    return undefined;
  }
  const out: IRElementCriteria[] = [];
  for (const entry of raw) {
    const criteria = coerceElementCriteria(entry, decl, `${key}[]`, warnings);
    if (criteria) out.push(criteria);
  }
  return out;
}

/**
 * Read transition `actions` array. Each action is an object literal with at
 * least `type: string` and `target: IRElementCriteria`. Unsupported entries
 * are skipped with a warning.
 */
function readActionsArray(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
): IRTransitionAction[] {
  const raw = decl.props.actions;
  if (raw === undefined) return [];
  if (isUnsupportedProp(raw)) {
    pushUnsupported(warnings, decl, "actions", raw);
    return [];
  }
  if (!Array.isArray(raw)) {
    pushTypeMismatch(warnings, decl, "actions", "object[]", typeof raw);
    return [];
  }

  const out: IRTransitionAction[] = [];
  for (const entry of raw) {
    if (isUnsupportedProp(entry)) {
      pushUnsupported(warnings, decl, "actions[]", entry);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      pushTypeMismatch(warnings, decl, "actions[]", "object", typeof entry);
      continue;
    }
    const obj = entry as Record<string, unknown>;
    const type = obj.type;
    if (typeof type !== "string") {
      pushTypeMismatch(warnings, decl, "actions[].type", "string", typeof type);
      continue;
    }
    const target = coerceElementCriteria(
      obj.target,
      decl,
      "actions[].target",
      warnings,
    );
    if (!target) continue;
    const action: IRTransitionAction = { type, target };
    if (obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)) {
      action.params = obj.params as Record<string, unknown>;
    }
    out.push(action);
  }
  return out;
}

function readEffect(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
): IREffect | undefined {
  const value = decl.props.effect;
  if (value === undefined) return undefined;
  if (isUnsupportedProp(value)) {
    pushUnsupported(warnings, decl, "effect", value);
    return undefined;
  }
  if (value === "read" || value === "write" || value === "destructive") {
    return value;
  }
  pushTypeMismatch(warnings, decl, "effect", "'read'|'write'|'destructive'", String(value));
  return undefined;
}

function readMetadata(
  decl: ExtractedDeclaration,
  warnings: IRBuildWarning[],
): IRMetadata | undefined {
  const raw = decl.props.metadata;
  if (raw === undefined) return undefined;
  if (isUnsupportedProp(raw)) {
    pushUnsupported(warnings, decl, "metadata", raw);
    return undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    pushTypeMismatch(warnings, decl, "metadata", "object", typeof raw);
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const md: IRMetadata = {};
  if (typeof obj.description === "string") md.description = obj.description;
  if (typeof obj.purpose === "string") md.purpose = obj.purpose;
  if (Array.isArray(obj.tags)) {
    md.tags = obj.tags.filter((t): t is string => typeof t === "string");
  }
  if (Array.isArray(obj.relatedElements)) {
    md.relatedElements = obj.relatedElements.filter(
      (t): t is string => typeof t === "string",
    );
  }
  if (typeof obj.notes === "string") md.notes = obj.notes;
  return Object.keys(md).length === 0 ? undefined : md;
}

/**
 * Coerce an arbitrary extracted prop value into an {@link IRElementCriteria}.
 * Object literals are read field-by-field; the legacy string form
 * (`elements: ["btn-login"]`) is lifted to `{ id: '<value>' }`.
 */
function coerceElementCriteria(
  raw: unknown,
  decl: ExtractedDeclaration,
  context: string,
  warnings: IRBuildWarning[],
): IRElementCriteria | undefined {
  if (raw === undefined) return undefined;

  if (isUnsupportedProp(raw)) {
    pushUnsupported(warnings, decl, context, raw);
    return undefined;
  }

  if (typeof raw === "string") {
    return { id: raw };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    pushTypeMismatch(warnings, decl, context, "object", typeof raw);
    return undefined;
  }

  const obj = raw as Record<string, unknown>;
  const criteria: IRElementCriteria = {};
  if (typeof obj.role === "string") criteria.role = obj.role;
  if (typeof obj.text === "string") criteria.text = obj.text;
  if (typeof obj.textContains === "string") criteria.textContains = obj.textContains;
  if (typeof obj.ariaLabel === "string") criteria.ariaLabel = obj.ariaLabel;
  if (typeof obj.id === "string") criteria.id = obj.id;
  if (
    obj.attributes &&
    typeof obj.attributes === "object" &&
    !Array.isArray(obj.attributes)
  ) {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.attributes as Record<string, unknown>)) {
      if (typeof v === "string") attrs[k] = v;
    }
    if (Object.keys(attrs).length > 0) criteria.attributes = attrs;
  }
  return criteria;
}

// ---------------------------------------------------------------------------
// Provenance / warnings
// ---------------------------------------------------------------------------

function makeProvenance(
  decl: ExtractedDeclaration,
  source: IRProvenance["source"],
  pluginVersion: string | undefined,
): IRProvenance {
  const prov: IRProvenance = {
    source,
    file: decl.file,
    line: decl.line,
  };
  if (decl.column !== undefined) prov.column = decl.column;
  if (pluginVersion) prov.pluginVersion = pluginVersion;
  return prov;
}

function pushUnsupported(
  warnings: IRBuildWarning[],
  decl: ExtractedDeclaration,
  key: string,
  marker: UnsupportedPropMarker,
): void {
  warnings.push({
    file: decl.file,
    line: marker.line ?? decl.line,
    kind: declKind(decl),
    id: typeof decl.props.id === "string" ? decl.props.id : undefined,
    message: `Unsupported computed expression for prop "${key}": ${marker.expression} — IR omits this field.`,
  });
}

function pushTypeMismatch(
  warnings: IRBuildWarning[],
  decl: ExtractedDeclaration,
  key: string,
  expected: string,
  got: string,
): void {
  warnings.push({
    file: decl.file,
    line: decl.line,
    kind: declKind(decl),
    id: typeof decl.props.id === "string" ? decl.props.id : undefined,
    message: `Prop "${key}" expected ${expected}, got ${got} — IR omits this field.`,
  });
}

function declKind(
  decl: ExtractedDeclaration,
): IRBuildWarning["kind"] {
  return decl.kind === "state" ? "state" : "transition";
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/** Sort comparator on `id`. */
function byId(a: { id: string }, b: { id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Recursively rebuild an object/array with alphabetized keys at every depth.
 * Used by {@link serializeIRDocument} to guarantee byte-stable output.
 *
 * Arrays are walked element-by-element WITHOUT reordering — array order is
 * already deterministic from the build pipeline (states/transitions sorted
 * by id; actions/criteria preserve authoring order).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      sorted[key] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/** Strip top-level keys whose value is `undefined`. */
function stripUndefined<T extends object>(obj: T): T {
  const out = { ...obj };
  for (const key of Object.keys(out) as Array<keyof T>) {
    if (out[key] === undefined) delete out[key];
  }
  return out;
}
