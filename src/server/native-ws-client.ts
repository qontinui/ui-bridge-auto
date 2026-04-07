/**
 * Typed JSON-RPC client for the UI Bridge Native WebSocket API.
 *
 * Wraps a WebSocket-like transport so consumers can call path-style methods
 * (e.g. `control/snapshot`) as plain async functions instead of hand-crafting
 * JSON-RPC payloads. Handles request/response correlation via auto-incrementing
 * numeric ids, surfaces server-pushed events through an emitter, and rejects
 * all pending calls when the connection closes.
 *
 * The client is transport-agnostic: pass any object that satisfies
 * `WebSocketLike` (the browser `WebSocket`, `ws` from Node, or a stub for
 * tests). It does NOT manage connection lifecycle — callers open and close
 * the socket themselves.
 */

// ---------------------------------------------------------------------------
// Protocol types
//
// These mirror the wire format used by `@qontinui/ui-bridge-native`'s
// `ws-types.ts`. They are duplicated locally rather than imported so that
// `ui-bridge-auto` does not pick up a new dependency just for type aliases.
// ---------------------------------------------------------------------------

/** A JSON-RPC request as sent over the wire. */
export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/** A JSON-RPC response payload (server → client). */
export interface JsonRpcResponse {
  id: number | string;
  result?: {
    success: boolean;
    data?: unknown;
    error?: string;
    code?: string;
    timestamp?: number;
  };
}

/** A server-pushed event. Has no `id` because it is not a reply. */
export interface JsonRpcEvent {
  event: string;
  data: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Domain payload types
//
// These describe the *shapes* returned by the server-side handlers. They are
// kept intentionally permissive (`unknown` for nested fields) so the client
// stays decoupled from the native package's full type surface. Callers that
// want richer typing can cast to the canonical types from
// `@qontinui/ui-bridge-native`.
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape of a `NativeBridgeSnapshot`. The full type lives
 * in `@qontinui/ui-bridge-native`; this local mirror is intentionally loose
 * to avoid a hard dependency.
 */
export interface NativeBridgeSnapshotLike {
  timestamp: number;
  currentRoute?: unknown;
  segments?: unknown;
  elements: Array<{
    id: string;
    type: string;
    label?: string;
    [key: string]: unknown;
  }>;
  components: Array<{
    id: string;
    type: string;
    [key: string]: unknown;
  }>;
}

export interface WaitForElementResult {
  id: string;
  state: unknown;
  identifier?: unknown;
  /** True if the call had to wait for the element to appear; false on fast-path. */
  waited: boolean;
}

export interface SequenceStep {
  method: string;
  params?: Record<string, unknown>;
}

export interface SequenceResult {
  completedSteps: number;
  totalSteps: number;
  results: unknown[];
}

export interface SubscriptionsList {
  events: string[];
  throttleMs: number | null;
}

// ---------------------------------------------------------------------------
// Transport abstraction
// ---------------------------------------------------------------------------

/**
 * The minimal WebSocket interface the client needs. Compatible with the
 * browser `WebSocket`, the Node `ws` package, and test stubs.
 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?(
    type: "message" | "close" | "error" | "open",
    listener: (event: { data?: unknown }) => void,
  ): void;
  removeEventListener?(
    type: "message" | "close" | "error" | "open",
    listener: (event: { data?: unknown }) => void,
  ): void;
  // `ws`-style fallbacks for environments without `addEventListener`.
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Standard `WebSocket.OPEN` constant — duplicated to avoid a DOM lib import. */
const WS_OPEN = 1;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the server returns `success: false`. */
export class NativeWsError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly method?: string,
  ) {
    super(message);
    this.name = "NativeWsError";
  }
}

/** Thrown when a request times out client-side. */
export class NativeWsTimeoutError extends Error {
  constructor(
    public readonly method: string,
    public readonly timeoutMs: number,
  ) {
    super(`JSON-RPC call '${method}' timed out after ${timeoutMs}ms`);
    this.name = "NativeWsTimeoutError";
  }
}

/** Thrown when the connection closes while a request is in flight. */
export class NativeWsClosedError extends Error {
  constructor(message = "WebSocket closed before response was received") {
    super(message);
    this.name = "NativeWsClosedError";
  }
}

// ---------------------------------------------------------------------------
// Internal: pending request bookkeeping
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// Event emitter
// ---------------------------------------------------------------------------

type EventListener = (event: JsonRpcEvent) => void;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface NativeWsClientOptions {
  /** Default per-request timeout in milliseconds. Default 30 000. */
  defaultTimeoutMs?: number;
}

/**
 * Typed wrapper around a WebSocket-like transport speaking the UI Bridge
 * Native JSON-RPC protocol.
 */
export class NativeWsClient {
  private readonly ws: WebSocketLike;
  private readonly defaultTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly wildcardListeners = new Set<EventListener>();
  /** Callbacks invoked when the client is disposed or the socket closes. */
  private readonly disposeCallbacks = new Set<() => void>();
  private nextId = 1;
  private closed = false;
  /**
   * Wrapper used when attaching to a `ws`-style emitter (no addEventListener).
   * Kept on the instance so `detach()` can remove the *same* function reference
   * — otherwise `ws.off('message', ...)` would be a no-op and the listener
   * (and through it, this client) would leak.
   */
  private wsOnMessageWrapper: ((data: unknown) => void) | null = null;

  constructor(ws: WebSocketLike, options: NativeWsClientOptions = {}) {
    this.ws = ws;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.attach();
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reject all pending requests, drop event listeners, and detach from the
   * transport. Call this when the consumer is done with the client. Does NOT
   * close the underlying socket — the caller owns that.
   */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.failAllPending(new NativeWsClosedError("NativeWsClient disposed"));
    this.listeners.clear();
    this.wildcardListeners.clear();
    this.runDisposeCallbacks();
  }

  private runDisposeCallbacks(): void {
    for (const cb of this.disposeCallbacks) {
      try {
        cb();
      } catch {
        /* swallow — disposing should be fail-safe */
      }
    }
    this.disposeCallbacks.clear();
  }

  /** True after `dispose()` has been called or the socket has closed. */
  isClosed(): boolean {
    return this.closed;
  }

  // -------------------------------------------------------------------------
  // Generic call
  // -------------------------------------------------------------------------

  /**
   * Send a raw JSON-RPC request and return the unwrapped `data` payload.
   * Throws `NativeWsError` if the server responds with `success: false`,
   * `NativeWsTimeoutError` on timeout, or `NativeWsClosedError` if the
   * connection drops before a reply arrives.
   */
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(
        new NativeWsClosedError("NativeWsClient is disposed"),
      );
    }
    if (this.ws.readyState !== WS_OPEN) {
      return Promise.reject(
        new NativeWsClosedError(
          `WebSocket not open (readyState=${this.ws.readyState})`,
        ),
      );
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = params
      ? { id, method, params }
      : { id, method };

    return new Promise<T>((resolve, reject) => {
      const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
      const timer =
        effectiveTimeout > 0
          ? setTimeout(() => {
              const entry = this.pending.get(id);
              if (!entry) return;
              this.pending.delete(id);
              entry.reject(new NativeWsTimeoutError(method, effectiveTimeout));
            }, effectiveTimeout)
          : null;

      this.pending.set(id, {
        resolve: (data) => resolve(data as T),
        reject,
        method,
        timer,
      });

      try {
        this.ws.send(JSON.stringify(request));
      } catch (err) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(
          err instanceof Error
            ? err
            : new Error(`Failed to send JSON-RPC request: ${String(err)}`),
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Typed wrappers — control/* routes
  // -------------------------------------------------------------------------

  health(): Promise<unknown> {
    return this.call("health");
  }

  /** Snapshot of the entire native bridge — route, segments, elements, components. */
  getSnapshot(): Promise<NativeBridgeSnapshotLike> {
    return this.call<NativeBridgeSnapshotLike>("control/snapshot");
  }

  /** List all registered elements. */
  getElements(): Promise<unknown[]> {
    return this.call<unknown[]>("control/elements");
  }

  /** Fetch a single element by id. */
  getElement(id: string): Promise<unknown> {
    return this.call(`control/element/${encodeURIComponent(id)}`);
  }

  /** Fetch the live state of a single element. */
  getElementState(id: string): Promise<unknown> {
    return this.call(`control/element/${encodeURIComponent(id)}/state`);
  }

  /**
   * Execute a standard action (`click`, `type`, etc.) on an element.
   * `params` is forwarded as the action's argument bag.
   */
  executeAction(
    id: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.call(`control/element/${encodeURIComponent(id)}/action`, {
      action,
      ...(params !== undefined ? { params } : {}),
    });
  }

  /** Execute a custom component action by id. */
  executeComponentAction(
    componentId: string,
    actionId: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.call(
      `control/component/${encodeURIComponent(componentId)}/action/${encodeURIComponent(actionId)}`,
      params,
    );
  }

  /** Navigate to a URL (or app route). */
  pageNavigate(url: string): Promise<unknown> {
    return this.call("control/page/navigate", { url });
  }

  pageBack(): Promise<unknown> {
    return this.call("control/page/back");
  }

  pageRefresh(): Promise<unknown> {
    return this.call("control/page/refresh");
  }

  /** Capture a screenshot. Server returns base64 data or a URL. */
  screenshot(): Promise<unknown> {
    return this.call("control/screenshot");
  }

  // -------------------------------------------------------------------------
  // Typed wrappers — special server-side methods (not in WS_ROUTES)
  // -------------------------------------------------------------------------

  /**
   * Wait server-side for an element to become available.
   * `timeoutMs` is the *server's* wait window — the client's own timeout is
   * automatically extended to give the server time to respond.
   */
  waitForElement(id: string, timeoutMs?: number): Promise<WaitForElementResult> {
    const params: Record<string, unknown> = { id };
    if (timeoutMs !== undefined) params.timeout = timeoutMs;
    // Allow the client a small grace window beyond the server's timeout.
    const clientTimeout = timeoutMs !== undefined ? timeoutMs + 5_000 : undefined;
    return this.call<WaitForElementResult>("waitForElement", params, clientTimeout);
  }

  /** Execute an ordered sequence of JSON-RPC calls server-side. */
  sequence(steps: SequenceStep[]): Promise<SequenceResult> {
    return this.call<SequenceResult>("sequence", { steps });
  }

  /** Subscribe to one or more server-pushed event streams. */
  subscribe(events: string[], throttleMs?: number): Promise<unknown> {
    const params: Record<string, unknown> = { events };
    if (throttleMs !== undefined) params.throttleMs = throttleMs;
    return this.call("subscribe", params);
  }

  /** Unsubscribe from event streams. */
  unsubscribe(events: string[]): Promise<unknown> {
    return this.call("unsubscribe", { events });
  }

  /** List currently-active subscriptions on this connection. */
  subscriptionsList(): Promise<SubscriptionsList> {
    return this.call<SubscriptionsList>("subscriptions/list");
  }

  // -------------------------------------------------------------------------
  // Event subscriptions (client-side dispatch)
  //
  // These attach listeners that fire when the server pushes a matching
  // `{event, data, timestamp}` frame. They do NOT call `subscribe` on the
  // server — call `subscribe()` separately to opt into a stream.
  // -------------------------------------------------------------------------

  /**
   * Attach a listener for a named event. Pass `'*'` to receive every event.
   * Returns an unsubscribe function.
   */
  on(eventName: string, listener: EventListener): () => void {
    if (eventName === "*") {
      this.wildcardListeners.add(listener);
      return () => this.wildcardListeners.delete(listener);
    }
    let bucket = this.listeners.get(eventName);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(eventName, bucket);
    }
    bucket.add(listener);
    return () => {
      bucket?.delete(listener);
      if (bucket && bucket.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  /**
   * Async iterator over events matching `eventName` (or `'*'` for all).
   * Terminates cleanly when the client is disposed or the socket closes.
   */
  events(eventName = "*"): AsyncIterableIterator<JsonRpcEvent> {
    const queue: JsonRpcEvent[] = [];
    const waiters: Array<(result: IteratorResult<JsonRpcEvent>) => void> = [];
    let done = false;

    const unsubscribe = this.on(eventName, (evt) => {
      const next = waiters.shift();
      if (next) next({ value: evt, done: false });
      else queue.push(evt);
    });

    const finish = (): void => {
      if (done) return;
      done = true;
      unsubscribe();
      while (waiters.length > 0) {
        const w = waiters.shift();
        if (w) w({ value: undefined, done: true });
      }
    };

    // Hook into dispose so iteration ends cleanly when the client tears
    // down — even if no further events arrive after dispose.
    this.disposeCallbacks.add(finish);
    const closeWatcher = (): void => {
      this.disposeCallbacks.delete(finish);
    };

    return {
      next(): Promise<IteratorResult<JsonRpcEvent>> {
        if (done) return Promise.resolve({ value: undefined, done: true });
        const buffered = queue.shift();
        if (buffered) return Promise.resolve({ value: buffered, done: false });
        return new Promise((resolve) => waiters.push(resolve));
      },
      return(): Promise<IteratorResult<JsonRpcEvent>> {
        finish();
        closeWatcher();
        return Promise.resolve({ value: undefined, done: true });
      },
      throw(err): Promise<IteratorResult<JsonRpcEvent>> {
        finish();
        closeWatcher();
        return Promise.reject(err);
      },
      [Symbol.asyncIterator](): AsyncIterableIterator<JsonRpcEvent> {
        return this;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Internal: transport plumbing
  // -------------------------------------------------------------------------

  private readonly handleMessage = (event: { data?: unknown }): void => {
    let payload: unknown;
    try {
      payload =
        typeof event.data === "string"
          ? JSON.parse(event.data)
          : event.data;
    } catch {
      return; // Ignore unparseable frames.
    }

    if (!payload || typeof payload !== "object") return;

    // Server-pushed event (no `id`).
    if ("event" in payload && typeof (payload as JsonRpcEvent).event === "string") {
      this.dispatchEvent(payload as JsonRpcEvent);
      return;
    }

    // JSON-RPC response (has numeric `id`).
    if ("id" in payload) {
      const response = payload as JsonRpcResponse;
      const idValue = response.id;
      const numericId = typeof idValue === "number" ? idValue : Number(idValue);
      if (!Number.isFinite(numericId)) return;

      const entry = this.pending.get(numericId);
      if (!entry) return;
      this.pending.delete(numericId);
      if (entry.timer) clearTimeout(entry.timer);

      const result = response.result;
      if (!result) {
        entry.reject(
          new NativeWsError(
            "Malformed JSON-RPC response: missing 'result' field",
            undefined,
            entry.method,
          ),
        );
        return;
      }
      if (result.success) {
        entry.resolve(result.data);
      } else {
        entry.reject(
          new NativeWsError(
            result.error ?? "JSON-RPC call failed",
            result.code,
            entry.method,
          ),
        );
      }
    }
  };

  private readonly handleClose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    this.failAllPending(new NativeWsClosedError());
    this.runDisposeCallbacks();
  };

  private dispatchEvent(evt: JsonRpcEvent): void {
    const named = this.listeners.get(evt.event);
    if (named) {
      for (const cb of named) {
        try {
          cb(evt);
        } catch {
          /* swallow listener errors so one bad subscriber can't poison others */
        }
      }
    }
    for (const cb of this.wildcardListeners) {
      try {
        cb(evt);
      } catch {
        /* swallow */
      }
    }
  }

  private failAllPending(err: Error): void {
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private attach(): void {
    if (typeof this.ws.addEventListener === "function") {
      this.ws.addEventListener("message", this.handleMessage);
      this.ws.addEventListener("close", this.handleClose);
      this.ws.addEventListener("error", this.handleClose);
    } else if (typeof this.ws.on === "function") {
      // `ws` package style: emits raw data, wrap to match `{data}` shape.
      // Store the wrapper so we can detach the *same* reference later.
      this.wsOnMessageWrapper = (data: unknown) =>
        this.handleMessage({ data: typeof data === "string" ? data : String(data) });
      this.ws.on("message", this.wsOnMessageWrapper);
      this.ws.on("close", this.handleClose);
      this.ws.on("error", this.handleClose);
    }
  }

  private detach(): void {
    if (typeof this.ws.removeEventListener === "function") {
      this.ws.removeEventListener("message", this.handleMessage);
      this.ws.removeEventListener("close", this.handleClose);
      this.ws.removeEventListener("error", this.handleClose);
    } else if (typeof this.ws.off === "function") {
      if (this.wsOnMessageWrapper) {
        this.ws.off(
          "message",
          this.wsOnMessageWrapper as unknown as (...args: unknown[]) => void,
        );
        this.wsOnMessageWrapper = null;
      }
      this.ws.off("close", this.handleClose);
      this.ws.off("error", this.handleClose);
    }
  }
}
