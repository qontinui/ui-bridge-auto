/**
 * Pipeline orchestrator — runs all analysis stages sequentially
 * and produces the final state machine output.
 *
 * Each stage is a pure function that takes prior stage outputs and
 * produces structured data. The pipeline accumulates results across stages.
 */

import type {
  StateDefinition,
  TransitionDefinition,
} from "../state/state-machine";
import type { ElementQuery } from "../core/element-query";
import type { BuilderConfig } from "./config";
import { resolveConfig } from "./config";
import { loadProject } from "./parsing/source-loader";
import { extractRoutes, type RouteEntry } from "./parsing/route-extractor";
import {
  resolveRouteComponents,
  type ResolvedComponent,
} from "./parsing/import-resolver";
import {
  parseComponent,
  type ParsedComponent,
} from "./parsing/component-parser";
import {
  extractElementsFromRoots,
  type ExtractedElement,
} from "./extraction/element-extractor";
import {
  extractGlobalLayout,
  type GlobalLayout,
} from "./extraction/global-layout-extractor";
import {
  enumerateBranches,
  enumerateEarlyReturns,
  type BranchEnumeration,
  type BranchGroup,
} from "./extraction/branch-enumerator";
import {
  traceNavigationTransitions,
  type TracedTransition,
} from "./extraction/navigation-tracer";
import { generateStates } from "./generation/state-generator";
import { generateTransitions } from "./generation/transition-generator";
import { stateId, stateName } from "./generation/id-generator";
import { enhanceWithAI } from "./enhancement/ai-analyzer";
import type {
  AIConfig,
  AIEnhancementResult,
} from "./enhancement/ai-types";
import {
  extractAllPageMetadata,
  type PageMetadata,
} from "./extraction/page-metadata-extractor";
import {
  loadSpecsSync,
  specElementsByState,
  type LoadedSpec,
} from "./extraction/spec-loader";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Intermediate results accumulated across pipeline stages. */
export interface PipelineContext {
  config: BuilderConfig;
  routes: RouteEntry[];
  /** Resolved component trees per route. */
  resolvedComponents: Map<string, ResolvedComponent[]>;
  /** Parsed component data per source file path. */
  parsedComponents: Map<string, ParsedComponent>;
  /** Extracted elements per route ID. */
  routeElements: Map<string, ExtractedElement[]>;
  /** Global layout data (always-present elements). */
  globalLayout: GlobalLayout | undefined;
  /** Branch enumerations per route ID. */
  routeBranches: Map<string, BranchEnumeration>;
  /** Traced navigation transitions per route ID. */
  routeTransitions: Map<string, TracedTransition[]>;
  states: StateDefinition[];
  transitions: TransitionDefinition[];
  uncertain: UncertainItem[];
}

/** Final output of the static builder pipeline. */
export interface BuildResult {
  states: StateDefinition[];
  transitions: TransitionDefinition[];
  /** Route entries extracted (for diagnostics). */
  routes: RouteEntry[];
  /** Extracted elements per route (for diagnostics). */
  routeElements: Map<string, ExtractedElement[]>;
  /** Global layout elements (for diagnostics). */
  globalElements: ExtractedElement[];
  /** Branch enumerations per route (for diagnostics). */
  routeBranches: Map<string, BranchEnumeration>;
  /** Traced transitions per route (for diagnostics). */
  tracedTransitions: TracedTransition[];
  /** AI enhancement results (if AI was enabled). */
  aiEnhancement?: AIEnhancementResult;
  /** Items the mechanical analysis could not fully resolve. */
  uncertain: UncertainItem[];
}

/** An item that could not be fully resolved by mechanical analysis. */
export interface UncertainItem {
  type: "dynamic-navigation" | "complex-condition" | "unknown-component";
  sourceFile: string;
  line: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full static analysis pipeline.
 *
 * Stages:
 * 1. Load project and parse source files
 * 2. Extract routes from switch statement
 * 3. Resolve component trees for each route
 * 4. Parse components and extract elements
 * 5. Extract global layout elements
 * 6. Enumerate conditional branches (Phase 3)
 * 7. Trace event handlers (Phase 3)
 * 8. Generate state definitions (Phase 4)
 * 9. Generate transition definitions (Phase 4)
 */
export function buildStateMachine(config: BuilderConfig): BuildResult {
  const resolved = resolveConfig(config);
  const uncertain: UncertainItem[] = [];

  // Stage 1: Load project
  let project: ReturnType<typeof loadProject>["project"];
  let routeFile: ReturnType<typeof loadProject>["routeFile"];
  let appShellFile: ReturnType<typeof loadProject>["appShellFile"];
  try {
    ({ project, routeFile, appShellFile } = loadProject(config));
  } catch (e) {
    uncertain.push({
      type: "unknown-component",
      sourceFile: config.routeFile,
      line: 0,
      description: `Failed to load project: ${e instanceof Error ? e.message : String(e)}`,
    });
    return {
      states: [],
      transitions: [],
      routes: [],
      routeElements: new Map(),
      globalElements: [],
      routeBranches: new Map(),
      tracedTransitions: [],
      uncertain,
    };
  }

  // Stage 2: Extract routes
  let routes: RouteEntry[];
  try {
    routes = extractRoutes(
      routeFile,
      resolved.routeFunction,
      resolved.routeDiscriminant,
    );
  } catch (e) {
    uncertain.push({
      type: "unknown-component",
      sourceFile: routeFile.getFilePath(),
      line: 0,
      description: `Failed to extract routes: ${e instanceof Error ? e.message : String(e)}`,
    });
    return {
      states: [],
      transitions: [],
      routes: [],
      routeElements: new Map(),
      globalElements: [],
      routeBranches: new Map(),
      tracedTransitions: [],
      uncertain,
    };
  }

  // Stage 3: Resolve component trees for each route
  const resolvedComponents = new Map<string, ResolvedComponent[]>();
  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const components = resolveRouteComponents(
      route.componentNames,
      routeFile,
      project,
      resolved.maxComponentDepth,
    );
    resolvedComponents.set(primaryId, components);

    // Flag unresolvable components
    for (const name of route.componentNames) {
      if (!components.find((c) => c.name === name)) {
        uncertain.push({
          type: "unknown-component",
          sourceFile: routeFile.getFilePath(),
          line: route.line,
          description: `Could not resolve component "${name}" for route "${primaryId}"`,
        });
      }
    }
  }

  // Stage 4: Parse components and extract elements
  const parsedComponents = new Map<string, ParsedComponent>();
  const routeElements = new Map<string, ExtractedElement[]>();

  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const components = resolvedComponents.get(primaryId) ?? [];
    const allElements: ExtractedElement[] = [];

    for (const component of components) {
      const filePath = component.sourceFile.getFilePath();
      let parsed = parsedComponents.get(filePath);
      if (!parsed) {
        parsed =
          parseComponent(component.sourceFile, component.name) ?? undefined;
        if (parsed) parsedComponents.set(filePath, parsed);
      }

      if (parsed) {
        const elements = extractElementsFromRoots(parsed.jsxRoots);
        allElements.push(...elements);
      }

      // Also extract from child components
      for (const child of component.children) {
        const childPath = child.sourceFile.getFilePath();
        let childParsed = parsedComponents.get(childPath);
        if (!childParsed) {
          childParsed =
            parseComponent(child.sourceFile, child.name) ?? undefined;
          if (childParsed) parsedComponents.set(childPath, childParsed);
        }
        if (childParsed) {
          allElements.push(...extractElementsFromRoots(childParsed.jsxRoots));
        }
      }
    }

    routeElements.set(primaryId, allElements);
  }

  // Stage 5: Extract global layout elements
  let globalLayout: GlobalLayout | undefined;
  if (appShellFile) {
    globalLayout = extractGlobalLayout(
      appShellFile,
      resolved.routeFunction,
      project,
      resolved.maxComponentDepth,
    );
  }

  // Stage 6: Enumerate conditional branches per route
  const routeBranches = new Map<string, BranchEnumeration>();
  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const components = resolvedComponents.get(primaryId) ?? [];

    for (const component of components) {
      const parsed = parsedComponents.get(component.sourceFile.getFilePath());
      if (parsed) {
        for (const jsxRoot of parsed.jsxRoots) {
          const enumeration = enumerateBranches(jsxRoot);
          const existing = routeBranches.get(primaryId);
          if (existing) {
            existing.unconditionalElements.push(
              ...enumeration.unconditionalElements,
            );
            existing.branchGroups.push(...enumeration.branchGroups);
          } else {
            routeBranches.set(primaryId, enumeration);
          }
        }
      }
    }
  }

  // Stage 7: Trace navigation transitions per route
  const allTracedTransitions: TracedTransition[] = [];
  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const components = resolvedComponents.get(primaryId) ?? [];

    for (const component of components) {
      const parsed = parsedComponents.get(component.sourceFile.getFilePath());
      if (parsed) {
        const transitions = traceNavigationTransitions(
          parsed.jsxRoots[0],
          component.sourceFile,
          resolved.navigationFunctions,
          resolved.navigationEvents ?? [],
        );
        allTracedTransitions.push(...transitions);
      }
    }
  }

  // Stage 7b: Trace navigation from the route file itself.
  // Prop callbacks like onNavigateToActive={() => setActiveTab("active")} are defined
  // in the route file's switch cases, not in individual component files.
  const routeFileParsed = parseComponent(routeFile, resolved.routeFunction);
  if (routeFileParsed) {
    for (const jsxRoot of routeFileParsed.jsxRoots) {
      const routeFileTransitions = traceNavigationTransitions(
        jsxRoot,
        routeFile,
        resolved.navigationFunctions,
        resolved.navigationEvents ?? [],
      );
      allTracedTransitions.push(...routeFileTransitions);
    }
  }

  // Build route line ranges for source state inference.
  // Each route entry has a starting line; the end line is the next route's start - 1.
  const routeLineRanges: Array<{
    startLine: number;
    endLine: number;
    stateId: string;
  }> = [];
  for (let i = 0; i < routes.length; i++) {
    const startLine = routes[i].line;
    const endLine = i + 1 < routes.length ? routes[i + 1].line - 1 : 99999;
    routeLineRanges.push({
      startLine,
      endLine,
      stateId: stateId(routes[i].caseValues[0]),
    });
  }

  // Stage 7c: Extract page metadata from PageRegistration components.
  // Provides AI-readable page names and descriptions directly from the source.
  const routeFileParsedForMeta = parseComponent(routeFile, resolved.routeFunction);
  const pageMetadata = new Map<string, PageMetadata>();
  if (routeFileParsedForMeta) {
    for (const root of routeFileParsedForMeta.jsxRoots) {
      const meta = extractAllPageMetadata(root);
      for (const [id, m] of meta) {
        pageMetadata.set(id, m);
      }
    }
  }

  // Stage 7d: Load spec files for authoritative element data.
  // Spec files (.spec.uibridge.json) contain per-page element assertions
  // that augment what static analysis can extract from source code.
  let specElements = new Map<string, ElementQuery[]>();
  if (resolved.specsDir) {
    try {
      const specsDirPath = `${config.projectRoot}/${resolved.specsDir}`.replace(
        /\\/g,
        "/",
      );
      // ts-morph already requires Node.js, so we use its fs access.
      // Read spec files through the ts-morph project's file system.
      const fileSystem = project.getFileSystem();
      const specs = loadSpecsSync(
        specsDirPath,
        (path: string) => fileSystem.readFileSync(path, "utf-8"),
        (dir: string) =>
          fileSystem.readDirSync(dir).map((entry) => {
            const name = typeof entry === "string" ? entry : entry.name;
            // ts-morph may return full paths — extract just the filename
            const parts = name.replace(/\\/g, "/").split("/");
            return parts[parts.length - 1];
          }),
      );
      specElements = specElementsByState(specs, stateId);
    } catch (e) {
      // Specs not available — continue without them.
      // Store error as a complex-condition uncertainty (infrastructure issue, not a missing component).
      uncertain.push({
        type: "complex-condition",
        sourceFile: resolved.specsDir ?? "specs",
        line: 0,
        description: `Failed to load specs: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // Merge spec elements into route elements
  for (const [sid, elements] of specElements) {
    const routeId = sid.replace(/^tab-/, "");
    const existing = routeElements.get(routeId) ?? [];
    // Add spec elements that aren't already present
    const existingKeys = new Set(existing.map((e) => JSON.stringify(e.query)));
    for (const el of elements) {
      if (!existingKeys.has(JSON.stringify(el))) {
        existing.push({
          query: el,
          interactive: false,
          tagName: "spec",
          line: 0,
        });
      }
    }
    routeElements.set(routeId, existing);
  }

  // Stage 7e: Add data-page-id convention elements.
  // Each state gets a requiredElement for its data-page-id attribute.
  // Apps should add data-page-id="route-id" to their page root containers
  // for definitive state detection.
  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const existing = routeElements.get(primaryId) ?? [];
    existing.push({
      query: { attributes: { "data-page-id": primaryId } },
      interactive: false,
      tagName: "div",
      line: 0,
    });
    routeElements.set(primaryId, existing);
  }

  // Stage 8: Generate state definitions
  // Use page metadata for names when available.
  const routeNameOverrides = new Map<string, string>();
  for (const [id, meta] of pageMetadata) {
    routeNameOverrides.set(id, meta.name);
  }

  const states = generateStates({
    routes,
    routeElements,
    globalElements: globalLayout?.globalElements ?? [],
    routeBranches,
    appBranches: globalLayout?.appBranches ?? [],
    routeNameOverrides,
  });

  // Build source file → state mapping for transition generation
  const sourceFileToState = new Map<string, string>();
  for (const route of routes) {
    const primaryId = route.caseValues[0];
    const components = resolvedComponents.get(primaryId) ?? [];
    for (const component of components) {
      sourceFileToState.set(
        component.sourceFile.getFilePath(),
        stateId(primaryId),
      );
      for (const child of component.children) {
        sourceFileToState.set(
          child.sourceFile.getFilePath(),
          stateId(primaryId),
        );
      }
    }
  }

  // Build state names map
  const stateNames = new Map<string, string>();
  for (const s of states) {
    stateNames.set(s.id, s.name);
  }

  // Build blocking state set
  const blockingStateIds = new Set<string>();
  for (const s of states) {
    if (s.blocking) blockingStateIds.add(s.id);
  }

  // Stage 9: Generate transition definitions
  const transitions = generateTransitions({
    tracedTransitions: allTracedTransitions,
    stateIds: states.map((s) => s.id),
    stateNames,
    blockingStateIds,
    sourceFileToState,
    routeLineToState: {
      filePath: routeFile.getFilePath(),
      ranges: routeLineRanges,
    },
  });

  return {
    states,
    transitions,
    routes,
    routeElements,
    globalElements: globalLayout?.globalElements ?? [],
    routeBranches,
    tracedTransitions: allTracedTransitions,
    uncertain,
  };
}

/**
 * Run the full static analysis pipeline with optional AI enhancement.
 *
 * Same as buildStateMachine() but runs an AI enhancement pass between
 * mechanical analysis and generation. AI resolves uncertain items:
 * dynamic navigation targets, unknown components, complex conditions.
 *
 * Requires AI config with enabled: true. Falls back to the sync pipeline
 * if AI is disabled.
 */
export async function buildStateMachineAsync(
  config: BuilderConfig,
): Promise<BuildResult> {
  // Run the mechanical analysis first
  const result = buildStateMachine(config);

  // If AI is disabled or no uncertain items, return as-is
  if (!config.ai?.enabled || result.uncertain.length === 0) {
    return result;
  }

  // Build source context map for uncertain items
  const contexts = new Map<string, string>();
  // Contexts are built from the source files we already have loaded
  // For now, the description field provides the context

  const aiConfig: AIConfig = {
    enabled: true,
    model: config.ai.model,
    apiKey: config.ai.apiKey,
    maxTokens: config.ai.maxTokens,
  };

  const aiResult = await enhanceWithAI(result.uncertain, aiConfig, {
    knownRouteIds: result.routes.map((r) => r.caseValues[0]),
    contexts,
  });

  // Apply AI results to the state machine
  const enhancedResult = applyAIEnhancements(result, aiResult);
  return enhancedResult;
}

/**
 * Apply AI enhancement results to the build output.
 *
 * - Dynamic navigation results add new traced transitions
 * - Inferred elements add requiredElements to affected states
 * - Improved labels update state names
 */
function applyAIEnhancements(
  result: BuildResult,
  aiResult: AIEnhancementResult,
): BuildResult {
  // Apply inferred elements to states with unknown components
  for (const inferred of aiResult.inferredElements) {
    const item = inferred.originalItem;
    // Find states that reference the unknown component's route
    // The description contains the route ID
    const routeIdMatch = item.description.match(/route "([^"]+)"/);
    if (routeIdMatch) {
      const targetStateId = stateId(routeIdMatch[1]);
      const state = result.states.find((s) => s.id === targetStateId);
      if (state) {
        state.requiredElements.push(...inferred.inferredElements);
      }
    }
  }

  // Apply improved labels to state names
  for (const label of aiResult.improvedLabels) {
    for (const state of result.states) {
      if (state.name.includes(label.originalLabel)) {
        state.name = state.name.replace(
          label.originalLabel,
          label.improvedLabel,
        );
      }
    }
  }

  return {
    ...result,
    aiEnhancement: aiResult,
    uncertain: aiResult.unresolved,
  };
}

