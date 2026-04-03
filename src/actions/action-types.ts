/**
 * Action type definitions, metadata, and validation.
 *
 * Provides a registry of all supported action types with their metadata,
 * parameter requirements, and categorization. Used by the executor and
 * builder to validate actions before execution.
 */

import type { ActionType } from '../types/transition';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/** Metadata about each action type — what params it accepts, whether it requires a value. */
export interface ActionTypeMetadata {
  /** The action verb. */
  type: ActionType;
  /** Human-readable label for display. */
  label: string;
  /** Description of what the action does. */
  description: string;
  /** Whether this action needs params.text or params.value. */
  requiresValue?: boolean;
  /** Whether this action needs params.target (for drag). */
  requiresTarget?: boolean;
  /** Whether this action changes the DOM. */
  modifiesDOM?: boolean;
  /** Functional category of the action. */
  category: string;
}

/** Registry of all action type metadata, keyed by action type string. */
export const ACTION_METADATA: Record<string, ActionTypeMetadata> = {
  click: {
    type: 'click',
    label: 'Click',
    description: 'Perform a single left-click on the element.',
    modifiesDOM: true,
    category: 'interaction',
  },
  doubleClick: {
    type: 'doubleClick',
    label: 'Double Click',
    description: 'Perform a double left-click on the element.',
    modifiesDOM: true,
    category: 'interaction',
  },
  rightClick: {
    type: 'rightClick',
    label: 'Right Click',
    description: 'Perform a right-click (context menu) on the element.',
    modifiesDOM: true,
    category: 'interaction',
  },
  type: {
    type: 'type',
    label: 'Type',
    description: 'Type text into the element character by character.',
    requiresValue: true,
    modifiesDOM: true,
    category: 'input',
  },
  clear: {
    type: 'clear',
    label: 'Clear',
    description: 'Clear the current value of an input or textarea.',
    modifiesDOM: true,
    category: 'input',
  },
  focus: {
    type: 'focus',
    label: 'Focus',
    description: 'Move keyboard focus to the element.',
    category: 'interaction',
  },
  blur: {
    type: 'blur',
    label: 'Blur',
    description: 'Remove keyboard focus from the element.',
    category: 'interaction',
  },
  hover: {
    type: 'hover',
    label: 'Hover',
    description: 'Move the mouse pointer over the element.',
    category: 'interaction',
  },
  scrollToView: {
    type: 'scrollIntoView',
    label: 'Scroll To View',
    description: 'Scroll the viewport to make the element visible.',
    category: 'interaction',
  },
  scrollIntoView: {
    type: 'scrollIntoView',
    label: 'Scroll Into View',
    description: 'Scroll the viewport so the element is visible.',
    category: 'interaction',
  },
  scroll: {
    type: 'scroll',
    label: 'Scroll',
    description: 'Scroll in a direction by a specified amount.',
    category: 'interaction',
  },
  select: {
    type: 'select',
    label: 'Select',
    description: 'Select an option in a dropdown or select element.',
    requiresValue: true,
    modifiesDOM: true,
    category: 'input',
  },
  check: {
    type: 'check',
    label: 'Check',
    description: 'Check a checkbox or radio button (set to checked state).',
    modifiesDOM: true,
    category: 'input',
  },
  uncheck: {
    type: 'uncheck',
    label: 'Uncheck',
    description: 'Uncheck a checkbox (set to unchecked state).',
    modifiesDOM: true,
    category: 'input',
  },
  toggle: {
    type: 'toggle',
    label: 'Toggle',
    description: 'Toggle a checkbox, switch, or toggle element.',
    modifiesDOM: true,
    category: 'input',
  },
  press: {
    type: 'sendKeys',
    label: 'Press',
    description: 'Press a key or key combination on the element.',
    requiresValue: true,
    modifiesDOM: true,
    category: 'input',
  },
  dragAndDrop: {
    type: 'drag',
    label: 'Drag and Drop',
    description: 'Drag the element to a target position or element.',
    requiresTarget: true,
    modifiesDOM: true,
    category: 'interaction',
  },
  upload: {
    type: 'setValue',
    label: 'Upload',
    description: 'Upload a file to a file input element.',
    requiresValue: true,
    modifiesDOM: true,
    category: 'input',
  },
  setAttribute: {
    type: 'setValue',
    label: 'Set Attribute',
    description: 'Set an HTML attribute on the element.',
    requiresValue: true,
    modifiesDOM: true,
    category: 'input',
  },
  middleClick: {
    type: 'middleClick',
    label: 'Middle Click',
    description: 'Perform a middle mouse button click on the element.',
    modifiesDOM: true,
    category: 'interaction',
  },
  mouseDown: {
    type: 'mouseDown',
    label: 'Mouse Down',
    description: 'Press and hold a mouse button on the element.',
    category: 'interaction',
  },
  mouseUp: {
    type: 'mouseUp',
    label: 'Mouse Up',
    description: 'Release a held mouse button on the element.',
    category: 'interaction',
  },
  keyDown: {
    type: 'keyDown',
    label: 'Key Down',
    description: 'Press and hold a keyboard key on the element.',
    requiresValue: true,
    category: 'input',
  },
  keyUp: {
    type: 'keyUp',
    label: 'Key Up',
    description: 'Release a held keyboard key on the element.',
    requiresValue: true,
    category: 'input',
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that params match what the action type expects.
 * Returns `{ valid: true }` if params are acceptable, or
 * `{ valid: false, errors: ["..."] }` with descriptive errors.
 */
export function validateActionParams(
  type: string,
  params?: Record<string, unknown>,
): { valid: boolean; errors?: string[] } {
  const meta = ACTION_METADATA[type];
  if (!meta) {
    return { valid: false, errors: [`Unknown action type: ${type}`] };
  }

  const errors: string[] = [];

  if (meta.requiresValue) {
    const hasText = params?.text !== undefined;
    const hasValue = params?.value !== undefined;
    const hasKeys = params?.keys !== undefined;
    if (!hasText && !hasValue && !hasKeys) {
      errors.push(
        `Action "${type}" requires a value parameter (text, value, or keys).`,
      );
    }
  }

  if (meta.requiresTarget) {
    const hasTarget = params?.target !== undefined;
    const hasX = params?.x !== undefined;
    const hasY = params?.y !== undefined;
    if (!hasTarget && !(hasX && hasY)) {
      errors.push(
        `Action "${type}" requires a target parameter (target element or x/y coordinates).`,
      );
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Category lookup
// ---------------------------------------------------------------------------

/**
 * Get all action types in a given category.
 */
export function getActionsByCategory(
  category: string,
): string[] {
  return (Object.entries(ACTION_METADATA))
    .filter(([, m]) => m.category === category)
    .map(([key]) => key);
}
