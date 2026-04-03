/**
 * State machine graph export/import.
 *
 * Supports JSON, Mermaid, and DOT (Graphviz) formats for visualising and
 * serialising the state/transition graph.
 */

import type { StateDefinition, TransitionDefinition } from "./state-machine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported graph export formats. */
export type GraphFormat = "json" | "mermaid" | "dot";

/** Serialisable graph data structure. */
export interface StateGraphData {
  states: Array<{
    id: string;
    name: string;
    isInitial?: boolean;
    isTerminal?: boolean;
    elementCount: number;
  }>;
  transitions: Array<{
    id: string;
    from: string;
    to: string;
    name: string;
    cost: number;
  }>;
  metadata: {
    version: string;
    createdAt: number;
    stateCount: number;
    transitionCount: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPH_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Export a state machine to the specified format.
 *
 * @param states - State definitions to export.
 * @param transitions - Transition definitions to export.
 * @param format - Output format: 'json', 'mermaid', or 'dot'.
 * @returns The formatted string.
 */
export function exportGraph(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
  format: GraphFormat,
): string {
  switch (format) {
    case "json":
      return toJSON(states, transitions);
    case "mermaid":
      return toMermaid(states, transitions);
    case "dot":
      return toDot(states, transitions);
  }
}

/**
 * Import states and transitions from a JSON graph export.
 *
 * @param json - JSON string produced by `exportGraph(..., 'json')`.
 * @returns Parsed state and transition definitions.
 */
export function importGraph(json: string): {
  states: StateDefinition[];
  transitions: TransitionDefinition[];
} {
  const data: StateGraphData = JSON.parse(json);

  const states: StateDefinition[] = data.states.map((s) => ({
    id: s.id,
    name: s.name,
    requiredElements: [],
    pathCost: 1.0,
  }));

  const transitions: TransitionDefinition[] = data.transitions.map((t) => ({
    id: t.id,
    name: t.name,
    fromStates: [t.from],
    activateStates: [t.to],
    exitStates: [t.from],
    actions: [],
    pathCost: t.cost,
  }));

  return { states, transitions };
}

// ---------------------------------------------------------------------------
// Format-specific generators
// ---------------------------------------------------------------------------

/**
 * Generate a Mermaid state diagram.
 *
 * Produces a `stateDiagram-v2` block with transitions rendered as arrows.
 */
export function toMermaid(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
): string {
  const lines: string[] = ["stateDiagram-v2"];

  // Declare states
  for (const state of states) {
    const label = sanitizeMermaid(state.name);
    lines.push(`    ${sanitizeId(state.id)} : ${label}`);
  }

  // Mark initial states
  const initialStates = states.filter(
    (s) => (s as StateDefinition & { isInitial?: boolean }).isInitial,
  );
  for (const s of initialStates) {
    lines.push(`    [*] --> ${sanitizeId(s.id)}`);
  }

  // Transitions
  for (const t of transitions) {
    for (const from of t.fromStates) {
      for (const to of t.activateStates) {
        const label = sanitizeMermaid(t.name);
        lines.push(
          `    ${sanitizeId(from)} --> ${sanitizeId(to)} : ${label}`,
        );
      }
    }
  }

  // Mark terminal states (no outgoing transitions)
  const statesWithOutgoing = new Set(transitions.flatMap((t) => t.fromStates));
  for (const state of states) {
    if (!statesWithOutgoing.has(state.id)) {
      lines.push(`    ${sanitizeId(state.id)} --> [*]`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a DOT (Graphviz) directed graph.
 */
export function toDot(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
): string {
  const lines: string[] = ["digraph StateMachine {"];
  lines.push("    rankdir=LR;");
  lines.push('    node [shape=box, style=rounded];');
  lines.push("");

  // Nodes
  for (const state of states) {
    const label = escapeDot(state.name);
    const attrs: string[] = [`label="${label}"`];
    if (state.blocking) {
      attrs.push("style=filled", "fillcolor=lightyellow");
    }
    lines.push(`    "${escapeDot(state.id)}" [${attrs.join(", ")}];`);
  }

  lines.push("");

  // Edges
  for (const t of transitions) {
    for (const from of t.fromStates) {
      for (const to of t.activateStates) {
        const label = escapeDot(t.name);
        const cost = t.pathCost ?? 1.0;
        lines.push(
          `    "${escapeDot(from)}" -> "${escapeDot(to)}" [label="${label} (${cost})"];`,
        );
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the JSON graph data and stringify it. */
function toJSON(
  states: StateDefinition[],
  transitions: TransitionDefinition[],
): string {
  const statesWithOutgoing = new Set(transitions.flatMap((t) => t.fromStates));

  const data: StateGraphData = {
    states: states.map((s) => ({
      id: s.id,
      name: s.name,
      elementCount: s.requiredElements.length,
      isTerminal: !statesWithOutgoing.has(s.id) || undefined,
    })),
    transitions: transitions.flatMap((t) => {
      const results: StateGraphData["transitions"] = [];
      for (const from of t.fromStates) {
        for (const to of t.activateStates) {
          results.push({
            id: t.id,
            from,
            to,
            name: t.name,
            cost: t.pathCost ?? 1.0,
          });
        }
      }
      return results;
    }),
    metadata: {
      version: GRAPH_VERSION,
      createdAt: Date.now(),
      stateCount: states.length,
      transitionCount: transitions.length,
    },
  };

  return JSON.stringify(data, null, 2);
}

/** Sanitize an ID for Mermaid (replace non-alphanumeric with underscores). */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Sanitize a label for Mermaid (remove characters that break diagram syntax). */
function sanitizeMermaid(text: string): string {
  return text.replace(/[[\]{}|<>]/g, "").replace(/"/g, "'");
}

/** Escape a string for use in DOT labels. */
function escapeDot(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
