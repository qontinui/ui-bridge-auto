/**
 * Test utilities for @qontinui/ui-bridge-auto.
 */

export { MockRegistry } from "./mock-registry";
export {
  createMockElement,
  createButton,
  createInput,
  createLink,
  createSelect,
  createHeading,
  createCheckbox,
  createTextarea,
  resetIdCounter,
  type MockElementOptions,
} from "./mock-elements";
export { MockActionExecutor, type RecordedAction } from "./mock-executor";
