/**
 * Configuration for the static state machine builder.
 *
 * Defines the minimal project-level config that tells the builder where to
 * find route definitions, navigation functions, and the app shell layout.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for static analysis of a React project. */
export interface BuilderConfig {
  /** Absolute path to the project root directory. */
  projectRoot: string;

  /**
   * Path to the route file, relative to projectRoot.
   * This file must contain a switch statement that maps route IDs to components.
   * @example "src/components/app/TabContent.tsx"
   */
  routeFile: string;

  /**
   * Name of the function/component containing the route switch statement.
   * @example "TabContent"
   */
  routeFunction: string;

  /**
   * Name of the switch discriminant variable.
   * @example "activeTab"
   */
  routeDiscriminant: string;

  /**
   * Path to the app shell file, relative to projectRoot.
   * Used to extract global layout elements that are always present.
   * @example "src/App.tsx"
   */
  appShellFile?: string;

  /**
   * Function names that trigger navigation between states.
   * Calls to these functions are traced to build transitions.
   * @example ["setActiveTab"]
   */
  navigationFunctions: string[];

  /**
   * Custom event names that trigger navigation.
   * Matched against window.dispatchEvent(new CustomEvent(...)) calls.
   * @example ["navigate-to-active", "navigate-to-error-monitor"]
   */
  navigationEvents?: string[];

  /**
   * Path to tsconfig.json, relative to projectRoot.
   * Used by ts-morph for module resolution and path alias handling.
   * @default "tsconfig.json"
   */
  tsconfigPath?: string;

  /**
   * Maximum depth for recursive component tree resolution.
   * Higher values extract more elements but take longer.
   * @default 3
   */
  maxComponentDepth?: number;

  /**
   * Path to the specs directory containing .spec.uibridge.json files,
   * relative to projectRoot. Specs provide authoritative element data
   * for each page, augmenting what static analysis can extract.
   * @example "src/specs"
   */
  specsDir?: string;

  /** AI enhancement configuration (optional, disabled by default). */
  ai?: {
    /** Enable AI enhancement for uncertain items. */
    enabled: boolean;
    /** Model ID (e.g., "claude-sonnet-4-5-20250514"). */
    model: string;
    /** API key. Falls back to ANTHROPIC_API_KEY env var. */
    apiKey?: string;
    /** Maximum tokens per AI response (default 1024). */
    maxTokens?: number;
  };

  /** Output configuration. */
  output?: {
    format: "workflow-config" | "persisted";
    path: string;
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TSCONFIG_PATH = "tsconfig.json";
const DEFAULT_MAX_COMPONENT_DEPTH = 5;

/** Fill in defaults for optional config fields. */
export function resolveConfig(
  config: BuilderConfig,
): Required<Pick<BuilderConfig, "tsconfigPath" | "maxComponentDepth">> &
  BuilderConfig {
  return {
    ...config,
    tsconfigPath: config.tsconfigPath ?? DEFAULT_TSCONFIG_PATH,
    maxComponentDepth: config.maxComponentDepth ?? DEFAULT_MAX_COMPONENT_DEPTH,
    navigationEvents: config.navigationEvents ?? [],
    specsDir: config.specsDir,
  };
}
