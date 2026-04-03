/**
 * Error classification for recovery strategy selection.
 *
 * Classifies errors into categories (transient, permanent, environmental)
 * and suggests appropriate recovery actions. Supports custom rules.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Broad classification of an error's nature. */
export type ErrorClass = "transient" | "permanent" | "environmental";

/** An error with classification metadata and a suggested recovery action. */
export interface ClassifiedError {
  originalError: Error;
  classification: ErrorClass;
  retryable: boolean;
  suggestedAction: "retry" | "abort" | "wait" | "relocate" | "reroute";
  reason: string;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

interface ClassificationRule {
  pattern: RegExp;
  classification: ErrorClass;
  suggestedAction: ClassifiedError["suggestedAction"];
}

/** Default classification rules applied in order. */
const DEFAULT_RULES: ClassificationRule[] = [
  {
    pattern: /timeout/i,
    classification: "transient",
    suggestedAction: "retry",
  },
  {
    pattern: /element not found|not found/i,
    classification: "transient",
    suggestedAction: "relocate",
  },
  {
    pattern: /no path/i,
    classification: "permanent",
    suggestedAction: "reroute",
  },
  {
    pattern: /network/i,
    classification: "environmental",
    suggestedAction: "wait",
  },
  {
    pattern: /disabled|not enabled/i,
    classification: "environmental",
    suggestedAction: "wait",
  },
];

let customRules: ClassificationRule[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify an error based on its message and type.
 *
 * Tests the error message against registered rules (custom first, then
 * defaults). The first matching rule determines the classification.
 * Unmatched errors default to permanent/abort.
 */
export function classifyError(error: Error): ClassifiedError {
  const message = error.message;

  // Check custom rules first, then defaults
  const allRules = [...customRules, ...DEFAULT_RULES];

  for (const rule of allRules) {
    if (rule.pattern.test(message)) {
      return {
        originalError: error,
        classification: rule.classification,
        retryable:
          rule.suggestedAction === "retry" ||
          rule.suggestedAction === "relocate" ||
          rule.suggestedAction === "wait",
        suggestedAction: rule.suggestedAction,
        reason: `Matched pattern: ${rule.pattern.source}`,
      };
    }
  }

  // Default: permanent, abort
  return {
    originalError: error,
    classification: "permanent",
    retryable: false,
    suggestedAction: "abort",
    reason: "No matching classification rule",
  };
}

/**
 * Register a custom error classification rule.
 *
 * Custom rules are checked before default rules, so they can override
 * built-in classifications.
 */
export function addClassificationRule(
  pattern: RegExp,
  classification: ErrorClass,
  suggestedAction: ClassifiedError["suggestedAction"],
): void {
  customRules.push({ pattern, classification, suggestedAction });
}

/**
 * Reset to default classification rules, removing all custom rules.
 */
export function resetClassificationRules(): void {
  customRules = [];
}
