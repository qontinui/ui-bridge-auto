/**
 * Integration tests for NativeWsClient — exercises the client against a
 * real in-process WebSocket server (via the `ws` npm package) on an
 * ephemeral port.
 *
 * Complements `native-ws-client.test.ts`, which uses synthetic mock sockets.
 * These tests validate the full end-to-end round trip over actual WebSocket
 * frames, including real event-loop interleaving, async message dispatch,
 * and the `on`/`off` transport path taken by the `ws` package.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  NativeWsClient,
  NativeWsError,
  NativeWsTimeoutError,
  NativeWsClosedError,
  type JsonRpcEvent,
  type WebSocketLike,
} from "../../server/native-ws-client";

// ---------------------------------------------------------------------------
// Test harness: an in-process WebSocket server with a small JSON-RPC responder
// ---------------------------------------------------------------------------

interface PendingResponder {
  /** Method handlers registered via `server.onMethod(...)`. */
  handlers: Map<
    string,
    (
      params: Record<string, unknown> | undefined,
      ws: WebSocket,
    ) => Promise<unknown> | unknown
  >;
  /** Connected sockets on the server side (so tests can push events / close). */
  sockets: Set<WebSocket>;
}

interface TestServer {
  wss: WebSocketServer;
  port: number;
  state: PendingResponder;
  /** Register a method handler. Return the `data` payload or throw to error. */
  onMethod(
    method: string,
    handler: (
      params: Record<string, unknown> | undefined,
      ws: WebSocket,
    ) => Promise<unknown> | unknown,
  ): void;
  /** Mark a method as unresponsive — server will receive but never reply. */
  silence(method: string): void;
  /** Have the server respond with `{success: false, ...}` for a method. */
  fail(method: string, code: string, message?: string): void;
  /** Push a server-initiated event to every connected client. */
  broadcast(event: string, data: unknown): void;
  /** Close every connected client from the server side. */
  closeAllClients(): void;
  /** Shut down the server. */
  close(): Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const state: PendingResponder = {
    handlers: new Map(),
    sockets: new Set(),
  };

  const wss = new WebSocketServer({ port: 0 });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  const addr = wss.address() as AddressInfo;
  const port = addr.port;

  wss.on("connection", (ws) => {
    state.sockets.add(ws);
    ws.on("close", () => state.sockets.delete(ws));
    ws.on("message", async (raw: RawData) => {
      let msg: { id?: number | string; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof msg.method !== "string" || msg.id === undefined) return;

      const handler = state.handlers.get(msg.method);
      if (!handler) {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: {
              success: false,
              error: `No handler for method '${msg.method}'`,
              code: "NO_HANDLER",
            },
          }),
        );
        return;
      }

      try {
        const data = await handler(msg.params, ws);
        if (data === SILENCE_SENTINEL) return; // Never respond.
        if (
          data &&
          typeof data === "object" &&
          "__error__" in (data as Record<string, unknown>)
        ) {
          const errShape = data as {
            __error__: true;
            code: string;
            error?: string;
          };
          ws.send(
            JSON.stringify({
              id: msg.id,
              result: {
                success: false,
                error: errShape.error ?? "failed",
                code: errShape.code,
              },
            }),
          );
          return;
        }
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: { success: true, data, timestamp: Date.now() },
          }),
        );
      } catch (err) {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: {
              success: false,
              error: err instanceof Error ? err.message : String(err),
              code: "HANDLER_THREW",
            },
          }),
        );
      }
    });
  });

  const server: TestServer = {
    wss,
    port,
    state,
    onMethod(method, handler) {
      state.handlers.set(method, handler);
    },
    silence(method) {
      state.handlers.set(method, () => SILENCE_SENTINEL);
    },
    fail(method, code, message) {
      state.handlers.set(method, () => ({
        __error__: true as const,
        code,
        error: message,
      }));
    },
    broadcast(event, data) {
      const frame = JSON.stringify({ event, data, timestamp: Date.now() });
      for (const ws of state.sockets) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    },
    closeAllClients() {
      for (const ws of state.sockets) ws.close();
    },
    async close() {
      // Force-terminate any lingering client sockets so close() resolves fast.
      for (const ws of state.sockets) ws.terminate();
      state.sockets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };

  return server;
}

/** Sentinel returned from a handler to indicate "never respond". */
const SILENCE_SENTINEL = Symbol("silence");

/** Open a client socket and wait for it to reach OPEN state. */
async function connectClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NativeWsClient (integration)", () => {
  let server: TestServer;
  let socket: WebSocket;
  let client: NativeWsClient;

  beforeEach(async () => {
    server = await startTestServer();
    socket = await connectClient(server.port);
    // `ws`'s WebSocket has a DOM-stricter addEventListener signature than
    // our generic WebSocketLike; cast to unknown so TS accepts it while
    // runtime happily uses the on()/off() transport path.
    client = new NativeWsClient(socket as unknown as WebSocketLike, {
      defaultTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    client.dispose();
    if (socket.readyState === WebSocket.OPEN) socket.close();
    await server.close();
  });

  // -------------------------------------------------------------------------
  // 1. Full round-trip for `health`
  // -------------------------------------------------------------------------
  it("completes a full health round trip against a real server", async () => {
    server.onMethod("health", () => ({ ok: true, version: "1.2.3" }));

    const result = (await client.health()) as { ok: boolean; version: string };

    expect(result).toEqual({ ok: true, version: "1.2.3" });
  });

  // -------------------------------------------------------------------------
  // 2. Concurrent out-of-order responses
  // -------------------------------------------------------------------------
  it("correctly correlates 10 concurrent calls with varying server delays", async () => {
    server.onMethod("delayed", async (params) => {
      const delay = (params?.delay as number) ?? 0;
      const tag = (params?.tag as string) ?? "";
      await new Promise((r) => setTimeout(r, delay));
      return { tag };
    });

    // Fire 10 concurrent calls with descending delays so later-sent requests
    // finish earlier (forces real out-of-order resolution).
    const promises = Array.from({ length: 10 }, (_, i) =>
      client.call<{ tag: string }>("delayed", {
        tag: `call-${i}`,
        delay: (10 - i) * 15, // 150ms, 135ms, ..., 15ms
      }),
    );

    const results = await Promise.all(promises);

    // Each promise must resolve to its own tag regardless of completion order.
    for (let i = 0; i < 10; i++) {
      expect(results[i]?.tag).toBe(`call-${i}`);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Server-pushed events via on()
  // -------------------------------------------------------------------------
  it("delivers real server-pushed events to on() listeners", async () => {
    const seen: JsonRpcEvent[] = [];
    client.on("element:registered", (evt) => seen.push(evt));

    // Wait until the server-side socket exists for this client (it does,
    // since we awaited `open`), then broadcast.
    server.broadcast("element:registered", { id: "btn-1" });
    server.broadcast("element:registered", { id: "btn-2" });
    // Flush the event loop so the client has a chance to dispatch.
    await new Promise((r) => setTimeout(r, 20));

    expect(seen).toHaveLength(2);
    expect(seen[0]?.event).toBe("element:registered");
    expect((seen[0]?.data as { id: string }).id).toBe("btn-1");
    expect((seen[1]?.data as { id: string }).id).toBe("btn-2");
  });

  // -------------------------------------------------------------------------
  // 4. Server-pushed events via async iterator
  // -------------------------------------------------------------------------
  it("iterates server-pushed events via client.events('*') and breaks cleanly", async () => {
    const iter = client.events("*");

    // Broadcast after a microtask so the iterator is definitely waiting.
    setTimeout(() => {
      server.broadcast("evt", { n: 1 });
      server.broadcast("evt", { n: 2 });
      server.broadcast("evt", { n: 3 });
    }, 10);

    const collected: number[] = [];
    for await (const evt of iter) {
      collected.push((evt.data as { n: number }).n);
      if (collected.length === 3) break;
    }

    expect(collected).toEqual([1, 2, 3]);

    // After `break`, subsequent next() should be done.
    const after = await iter.next();
    expect(after.done).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. Server-initiated close rejects pending requests
  // -------------------------------------------------------------------------
  it("rejects pending requests with NativeWsClosedError when the server closes the socket", async () => {
    server.silence("hang");

    const pending = client.call("hang", {}, 10_000);
    const caught = pending.catch((e: unknown) => e);

    // Give the send a moment to reach the server, then close from the
    // server side.
    await new Promise((r) => setTimeout(r, 20));
    server.closeAllClients();

    const err = await caught;
    expect(err).toBeInstanceOf(NativeWsClosedError);
  });

  // -------------------------------------------------------------------------
  // 6. waitForElement round trip with extended client timeout
  // -------------------------------------------------------------------------
  it("waitForElement resolves when the server replies after a delay", async () => {
    server.onMethod("waitForElement", async (params) => {
      await new Promise((r) => setTimeout(r, 100));
      return {
        id: params?.id as string,
        state: { visible: true },
        waited: true,
      };
    });

    const result = await client.waitForElement("btn", 500);

    expect(result.id).toBe("btn");
    expect(result.waited).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Timeout against unresponsive server
  // -------------------------------------------------------------------------
  it("rejects with NativeWsTimeoutError when the server never responds", async () => {
    server.silence("hang");

    const err = await client
      .call("hang", {}, 150)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NativeWsTimeoutError);
    expect((err as NativeWsTimeoutError).method).toBe("hang");
    expect((err as NativeWsTimeoutError).timeoutMs).toBe(150);
  });

  // -------------------------------------------------------------------------
  // 8. Server error response maps to NativeWsError
  // -------------------------------------------------------------------------
  it("surfaces server success:false responses as NativeWsError with the correct code", async () => {
    server.fail("boom", "BOOM", "server exploded");

    const err = await client.call("boom").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NativeWsError);
    expect((err as NativeWsError).code).toBe("BOOM");
    expect((err as NativeWsError).message).toBe("server exploded");
    expect((err as NativeWsError).method).toBe("boom");
  });

  // -------------------------------------------------------------------------
  // 9. `sequence` round trip
  // -------------------------------------------------------------------------
  it("sequence() round-trips a realistic {completedSteps, totalSteps, results} payload", async () => {
    server.onMethod("sequence", (params) => {
      const steps = (params?.steps as Array<{ method: string }>) ?? [];
      return {
        completedSteps: steps.length,
        totalSteps: steps.length,
        results: steps.map((s) => ({ method: s.method, ok: true })),
      };
    });

    const result = await client.sequence([
      { method: "health" },
      { method: "control/snapshot" },
      { method: "control/elements" },
    ]);

    expect(result.totalSteps).toBe(3);
    expect(result.completedSteps).toBe(3);
    expect(result.results).toHaveLength(3);
    expect((result.results[0] as { method: string }).method).toBe("health");
  });

  // -------------------------------------------------------------------------
  // 10. Dispose after close is idempotent
  // -------------------------------------------------------------------------
  it("dispose() after the server closes the socket is idempotent and does not hang", async () => {
    // Trigger a server-side close, then dispose the client.
    server.closeAllClients();

    // Give the close event a moment to propagate to the client.
    await new Promise((r) => setTimeout(r, 20));

    expect(client.isClosed()).toBe(true);

    // dispose() after auto-close must not throw, must not double-reject,
    // must not hang.
    expect(() => client.dispose()).not.toThrow();
    expect(() => client.dispose()).not.toThrow();
    expect(client.isClosed()).toBe(true);

    // New calls after dispose reject cleanly.
    const err = await client.call("anything").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NativeWsClosedError);
  });
});
