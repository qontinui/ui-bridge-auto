/**
 * Shared types for event-driven wait primitives.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TimeoutError extends Error {
  public readonly timeout: number;

  constructor(message: string, timeout: number) {
    super(message);
    this.name = "TimeoutError";
    this.timeout = timeout;
  }
}

// ---------------------------------------------------------------------------
// Common options
// ---------------------------------------------------------------------------

export interface WaitOptions {
  /** Maximum time (ms) to wait before throwing TimeoutError. Default 10 000. */
  timeout?: number;
  /** Optional AbortSignal to cancel the wait externally. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Registry abstraction (mirrors @qontinui/ui-bridge surface)
// ---------------------------------------------------------------------------

export type BridgeEventType =
  | "element:registered"
  | "element:unregistered"
  | "element:stateChanged"
  | "dom:settled"
  | "network:idle";

export interface BridgeEventPayload {
  elementId?: string;
  [key: string]: unknown;
}

export interface Registry {
  on(type: BridgeEventType, listener: (payload: BridgeEventPayload) => void): () => void;
  getAllElements(): RegistryElement[];
}

export interface RegistryElement {
  id: string;
  type: string;
  label?: string;
  element: HTMLElement;
  getState: () => RegistryElementState;
  getIdentifier?: () => { selector?: string; xpath?: string; htmlId?: string };
}

export interface RegistryElementState {
  visible?: boolean;
  enabled?: boolean;
  focused?: boolean;
  checked?: boolean;
  textContent?: string;
  value?: string | number | boolean;
  rect?: { x: number; y: number; width: number; height: number };
  computedStyles?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Detector interfaces (consumed by specialised wait functions)
// ---------------------------------------------------------------------------

export interface StateDetector {
  /** Returns true if the named state is currently active. */
  isActive(stateId: string): boolean;
  /** Subscribes to state-enter events. Returns an unsubscribe function. */
  onStateEnter(stateId: string, callback: () => void): () => void;
}

export interface IdleDetector {
  /** Returns true when the UI is considered idle right now. */
  isIdle(): boolean;
  /** Resolves when the UI becomes idle, or rejects on timeout. */
  waitForIdle(options?: { timeout?: number; signals?: string[] }): Promise<void>;
}
