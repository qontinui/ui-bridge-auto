/**
 * Tests for NativeWsClient — typed JSON-RPC client over a WebSocket-like
 * transport.
 *
 * Covers request/response correlation, timeouts, server error mapping,
 * close handling, event dispatch, async iterators, typed wrapper
 * serialization, and the `ws`-package transport variant (including the
 * `wsOnMessageWrapper` listener-detach fix).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NativeWsClient,
  NativeWsError,
  NativeWsTimeoutError,
  NativeWsClosedError,
  type WebSocketLike,
  type JsonRpcEvent,
} from "../../server/native-ws-client";

// ---------------------------------------------------------------------------
// Mock transports
// ---------------------------------------------------------------------------

const WS_OPEN = 1;
const WS_CLOSED = 3;

type Listener = (event: { data?: unknown }) => void;

/** Browser-style WebSocket mock using addEventListener / removeEventListener. */
class MockBrowserWs implements WebSocketLike {
  public readyState = WS_OPEN;
  public sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WS_CLOSED;
    this.dispatch("close", {});
  }

  addEventListener(type: string, listener: Listener): void {
    let bucket = this.listeners.get(type);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(type, bucket);
    }
    bucket.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Helper: simulate the server pushing a frame. */
  push(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.dispatch("message", { data });
  }

  /** Helper: read the most recently sent JSON-RPC payload. */
  lastSent(): { id: number; method: string; params?: Record<string, unknown> } {
    const raw = this.sent[this.sent.length - 1];
    if (!raw) throw new Error("No frames sent");
    return JSON.parse(raw);
  }

  /** Helper: simulate the server closing the connection. */
  simulateClose(): void {
    this.readyState = WS_CLOSED;
    this.dispatch("close", {});
  }

  /** Helper: count current listeners for a given type. */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  private dispatch(type: string, event: { data?: unknown }): void {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    for (const cb of bucket) cb(event);
  }
}

/** ws-package style mock using on/off and emitting raw data (no wrapper). */
class MockNodeWs implements WebSocketLike {
  public readyState = WS_OPEN;
  public sent: string[] = [];
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WS_CLOSED;
    this.emit("close");
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Helper: simulate raw server push (data is the message body). */
  push(payload: unknown): void {
    const data = typeof payload === "string" ? payload : JSON.stringify(payload);
    this.emit("message", data);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  simulateClose(): void {
    this.readyState = WS_CLOSED;
    this.emit("close");
  }

  private emit(event: string, ...args: unknown[]): void {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const cb of bucket) cb(...args);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NativeWsClient", () => {
  let ws: MockBrowserWs;
  let client: NativeWsClient;

  beforeEach(() => {
    ws = new MockBrowserWs();
    client = new NativeWsClient(ws);
  });

  afterEach(() => {
    client.dispose();
  });

  // -------------------------------------------------------------------------
  // 1. Request / response correlation
  // -------------------------------------------------------------------------

  describe("request/response correlation", () => {
    it("serializes a JSON-RPC request with id, method, params", async () => {
      const promise = client.call("widget/poke", { a: 1 });
      const sent = ws.lastSent();
      expect(sent.method).toBe("widget/poke");
      expect(sent.params).toEqual({ a: 1 });
      expect(typeof sent.id).toBe("number");

      ws.push({ id: sent.id, result: { success: true, data: "ok" } });
      await expect(promise).resolves.toBe("ok");
    });

    it("omits params when not provided", async () => {
      const promise = client.call("health");
      const sent = ws.lastSent();
      expect("params" in sent).toBe(false);
      ws.push({ id: sent.id, result: { success: true, data: { ok: true } } });
      await promise;
    });

    it("auto-increments ids", async () => {
      const p1 = client.call("a");
      const p2 = client.call("b");
      const id1 = JSON.parse(ws.sent[0]!).id as number;
      const id2 = JSON.parse(ws.sent[1]!).id as number;
      expect(id2).toBe(id1 + 1);

      ws.push({ id: id1, result: { success: true, data: 1 } });
      ws.push({ id: id2, result: { success: true, data: 2 } });
      await expect(p1).resolves.toBe(1);
      await expect(p2).resolves.toBe(2);
    });

    it("handles out-of-order responses for concurrent requests", async () => {
      const p1 = client.call("first");
      const p2 = client.call("second");
      const p3 = client.call("third");
      const ids = ws.sent.map((s) => (JSON.parse(s) as { id: number }).id);

      // Resolve in reverse order.
      ws.push({ id: ids[2], result: { success: true, data: "third-data" } });
      ws.push({ id: ids[0], result: { success: true, data: "first-data" } });
      ws.push({ id: ids[1], result: { success: true, data: "second-data" } });

      await expect(p1).resolves.toBe("first-data");
      await expect(p2).resolves.toBe("second-data");
      await expect(p3).resolves.toBe("third-data");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Timeouts
  // -------------------------------------------------------------------------

  describe("timeouts", () => {
    it("rejects with NativeWsTimeoutError after the configured timeout", async () => {
      vi.useFakeTimers();
      try {
        const promise = client.call("slow", {}, 50);
        // Attach a catch handler immediately so the rejection is observed.
        const caught = promise.catch((err: unknown) => err);
        vi.advanceTimersByTime(60);
        const err = await caught;
        expect(err).toBeInstanceOf(NativeWsTimeoutError);
        expect((err as NativeWsTimeoutError).method).toBe("slow");
        expect((err as NativeWsTimeoutError).timeoutMs).toBe(50);
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores late responses for already-timed-out requests", async () => {
      vi.useFakeTimers();
      try {
        const promise = client.call("slow", {}, 25);
        const caught = promise.catch((err: unknown) => err);
        const id = ws.lastSent().id;
        vi.advanceTimersByTime(50);
        await caught;

        // Late response should not throw or double-resolve.
        expect(() =>
          ws.push({ id, result: { success: true, data: "late" } }),
        ).not.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });

    it("applies the default 30s timeout when no per-call timeout is given", async () => {
      vi.useFakeTimers();
      try {
        const promise = client.call("default");
        const caught = promise.catch((err: unknown) => err);
        // Just before 30s — no rejection yet.
        vi.advanceTimersByTime(29_999);
        let resolved = false;
        void caught.then(() => (resolved = true));
        await Promise.resolve();
        expect(resolved).toBe(false);

        // Cross the threshold.
        vi.advanceTimersByTime(2);
        const err = await caught;
        expect(err).toBeInstanceOf(NativeWsTimeoutError);
        expect((err as NativeWsTimeoutError).timeoutMs).toBe(30_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it("respects a custom defaultTimeoutMs from constructor options", async () => {
      const ws2 = new MockBrowserWs();
      const client2 = new NativeWsClient(ws2, { defaultTimeoutMs: 100 });
      vi.useFakeTimers();
      try {
        const promise = client2.call("x");
        const caught = promise.catch((err: unknown) => err);
        vi.advanceTimersByTime(150);
        const err = await caught;
        expect(err).toBeInstanceOf(NativeWsTimeoutError);
        expect((err as NativeWsTimeoutError).timeoutMs).toBe(100);
      } finally {
        vi.useRealTimers();
        client2.dispose();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Server errors
  // -------------------------------------------------------------------------

  describe("server errors", () => {
    it("rejects with NativeWsError carrying code and method on success:false", async () => {
      const promise = client.call("op");
      const id = ws.lastSent().id;
      ws.push({
        id,
        result: { success: false, error: "nope", code: "BAD" },
      });
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsError);
      expect((err as NativeWsError).message).toBe("nope");
      expect((err as NativeWsError).code).toBe("BAD");
      expect((err as NativeWsError).method).toBe("op");
    });

    it("uses fallback error message when error string is missing", async () => {
      const promise = client.call("op");
      const id = ws.lastSent().id;
      ws.push({ id, result: { success: false } });
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsError);
      expect((err as NativeWsError).message).toBe("JSON-RPC call failed");
    });

    it("rejects with NativeWsError when result field is missing", async () => {
      const promise = client.call("op");
      const id = ws.lastSent().id;
      ws.push({ id });
      const err = await promise.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsError);
      expect((err as NativeWsError).message).toMatch(/missing 'result'/);
    });

    it("ignores response frames with no id (no crash)", async () => {
      const promise = client.call("op");
      const id = ws.lastSent().id;

      expect(() => ws.push({ result: { success: true, data: 1 } })).not.toThrow();
      expect(() => ws.push("not json at all {{{")).not.toThrow();
      expect(() => ws.push(null)).not.toThrow();

      // Still works for the real reply.
      ws.push({ id, result: { success: true, data: "ok" } });
      await expect(promise).resolves.toBe("ok");
    });

    it("ignores responses with non-numeric id", async () => {
      // Should not crash.
      expect(() =>
        ws.push({ id: "not-a-number", result: { success: true, data: 1 } }),
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 4. Close handling
  // -------------------------------------------------------------------------

  describe("close handling", () => {
    it("rejects all pending requests when the socket closes", async () => {
      const p1 = client.call("a");
      const p2 = client.call("b");
      ws.simulateClose();
      const e1 = await p1.catch((e: unknown) => e);
      const e2 = await p2.catch((e: unknown) => e);
      expect(e1).toBeInstanceOf(NativeWsClosedError);
      expect(e2).toBeInstanceOf(NativeWsClosedError);
    });

    it("dispose() rejects pending requests with NativeWsClosedError", async () => {
      const p = client.call("a");
      client.dispose();
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsClosedError);
      expect((err as NativeWsClosedError).message).toMatch(/disposed/);
    });

    it("dispose() is idempotent", () => {
      client.dispose();
      expect(() => client.dispose()).not.toThrow();
      expect(client.isClosed()).toBe(true);
    });

    it("rejects new calls immediately after dispose", async () => {
      client.dispose();
      const err = await client.call("a").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsClosedError);
    });

    it("rejects new calls when readyState is not OPEN", async () => {
      ws.readyState = WS_CLOSED;
      const err = await client.call("a").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsClosedError);
      expect((err as NativeWsClosedError).message).toMatch(/readyState=3/);
    });

    it("detaches transport listeners on dispose", () => {
      expect(ws.listenerCount("message")).toBe(1);
      client.dispose();
      expect(ws.listenerCount("message")).toBe(0);
      expect(ws.listenerCount("close")).toBe(0);
      expect(ws.listenerCount("error")).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Event dispatch
  // -------------------------------------------------------------------------

  describe("event dispatch", () => {
    it("delivers events to a named listener", () => {
      const seen: JsonRpcEvent[] = [];
      client.on("element:registered", (evt) => seen.push(evt));
      ws.push({
        event: "element:registered",
        data: { id: "btn-1" },
        timestamp: 123,
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.event).toBe("element:registered");
    });

    it("delivers all events to a wildcard listener", () => {
      const seen: string[] = [];
      client.on("*", (evt) => seen.push(evt.event));
      ws.push({ event: "a", data: {}, timestamp: 1 });
      ws.push({ event: "b", data: {}, timestamp: 2 });
      expect(seen).toEqual(["a", "b"]);
    });

    it("returns an unsubscribe function that detaches the listener", () => {
      const seen: JsonRpcEvent[] = [];
      const off = client.on("evt", (e) => seen.push(e));
      ws.push({ event: "evt", data: {}, timestamp: 1 });
      off();
      ws.push({ event: "evt", data: {}, timestamp: 2 });
      expect(seen).toHaveLength(1);
    });

    it("unsubscribe works for wildcard listeners", () => {
      const seen: JsonRpcEvent[] = [];
      const off = client.on("*", (e) => seen.push(e));
      ws.push({ event: "x", data: {}, timestamp: 1 });
      off();
      ws.push({ event: "x", data: {}, timestamp: 2 });
      expect(seen).toHaveLength(1);
    });

    it("does not let one throwing listener block others", () => {
      const seen: string[] = [];
      client.on("evt", () => {
        throw new Error("boom");
      });
      client.on("evt", () => seen.push("second"));
      client.on("*", () => seen.push("wild"));
      expect(() =>
        ws.push({ event: "evt", data: {}, timestamp: 1 }),
      ).not.toThrow();
      expect(seen).toContain("second");
      expect(seen).toContain("wild");
    });

    it("two listeners for the same event both fire", () => {
      const calls: number[] = [];
      client.on("e", () => calls.push(1));
      client.on("e", () => calls.push(2));
      ws.push({ event: "e", data: {}, timestamp: 1 });
      expect(calls).toEqual([1, 2]);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Async iterator events()
  // -------------------------------------------------------------------------

  describe("events() async iterator", () => {
    it("yields buffered events in order", async () => {
      const iter = client.events("foo");
      ws.push({ event: "foo", data: { n: 1 }, timestamp: 1 });
      ws.push({ event: "foo", data: { n: 2 }, timestamp: 2 });

      const a = await iter.next();
      const b = await iter.next();
      expect(a.done).toBe(false);
      expect((a.value as JsonRpcEvent).timestamp).toBe(1);
      expect((b.value as JsonRpcEvent).timestamp).toBe(2);
      await iter.return!();
    });

    it("yields events that arrive after a pending next()", async () => {
      const iter = client.events("foo");
      const pending = iter.next();
      ws.push({ event: "foo", data: {}, timestamp: 99 });
      const result = await pending;
      expect(result.done).toBe(false);
      expect((result.value as JsonRpcEvent).timestamp).toBe(99);
      await iter.return!();
    });

    it("default events() (no name) yields all events via wildcard", async () => {
      const iter = client.events();
      ws.push({ event: "anything", data: {}, timestamp: 1 });
      const r = await iter.next();
      expect((r.value as JsonRpcEvent).event).toBe("anything");
      await iter.return!();
    });

    it("breaking out via return() unsubscribes cleanly", async () => {
      const iter = client.events("foo");
      ws.push({ event: "foo", data: {}, timestamp: 1 });
      await iter.next();
      await iter.return!();

      // Subsequent next() should be done.
      const next = await iter.next();
      expect(next.done).toBe(true);
    });

    it("dispose() terminates active async iterators (no hang)", async () => {
      const iter = client.events("never-fires");
      const pending = iter.next();
      // Nothing has been pushed; the iterator is awaiting a waiter.
      client.dispose();
      const result = await pending;
      expect(result.done).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Typed wrapper serialization
  // -------------------------------------------------------------------------

  describe("typed wrappers", () => {
    /** Helper: respond to the most recent call with success/data. */
    function respond(data: unknown): void {
      const id = ws.lastSent().id;
      ws.push({ id, result: { success: true, data } });
    }

    it("health() calls 'health' with no params", async () => {
      const p = client.health();
      const sent = ws.lastSent();
      expect(sent.method).toBe("health");
      expect("params" in sent).toBe(false);
      respond({ ok: true });
      await p;
    });

    it("getSnapshot() calls control/snapshot", async () => {
      const p = client.getSnapshot();
      expect(ws.lastSent().method).toBe("control/snapshot");
      respond({ timestamp: 1, elements: [], components: [] });
      await p;
    });

    it("getElements() calls control/elements", async () => {
      const p = client.getElements();
      expect(ws.lastSent().method).toBe("control/elements");
      respond([]);
      await p;
    });

    it("getElement(id) embeds the id in the path", async () => {
      const p = client.getElement("abc");
      expect(ws.lastSent().method).toBe("control/element/abc");
      respond({});
      await p;
    });

    it("getElement url-encodes ids with special chars", async () => {
      const p = client.getElement("a/b c");
      expect(ws.lastSent().method).toBe("control/element/a%2Fb%20c");
      respond({});
      await p;
    });

    it("getElementState(id) calls control/element/<id>/state", async () => {
      const p = client.getElementState("abc");
      expect(ws.lastSent().method).toBe("control/element/abc/state");
      respond({});
      await p;
    });

    it("executeAction wraps action and params", async () => {
      const p = client.executeAction("abc", "press", { x: 1 });
      const sent = ws.lastSent();
      expect(sent.method).toBe("control/element/abc/action");
      expect(sent.params).toEqual({ action: "press", params: { x: 1 } });
      respond({});
      await p;
    });

    it("executeAction omits params field when none provided", async () => {
      const p = client.executeAction("abc", "press");
      const sent = ws.lastSent();
      expect(sent.params).toEqual({ action: "press" });
      respond({});
      await p;
    });

    it("executeComponentAction embeds both ids in path", async () => {
      const p = client.executeComponentAction("comp", "doThing", { y: 2 });
      const sent = ws.lastSent();
      expect(sent.method).toBe("control/component/comp/action/doThing");
      expect(sent.params).toEqual({ y: 2 });
      respond({});
      await p;
    });

    it("waitForElement passes id and timeout, extends client timeout beyond server timeout", async () => {
      vi.useFakeTimers();
      try {
        const p = client.waitForElement("btn", 2000);
        const caught = p.catch((e: unknown) => e);
        const sent = ws.lastSent();
        expect(sent.method).toBe("waitForElement");
        expect(sent.params).toEqual({ id: "btn", timeout: 2000 });

        // Advance past the server timeout (2000ms) but below the client
        // timeout (2000 + 5000 = 7000ms). The client should NOT have rejected.
        vi.advanceTimersByTime(2500);
        let settled = false;
        void caught.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);

        // Now respond — the call should resolve.
        const id = sent.id;
        ws.push({
          id,
          result: { success: true, data: { id: "btn", state: {}, waited: true } },
        });
        const result = (await p) as { id: string; waited: boolean };
        expect(result.id).toBe("btn");
        expect(result.waited).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("waitForElement omits timeout when not provided", async () => {
      const p = client.waitForElement("btn");
      const sent = ws.lastSent();
      expect(sent.params).toEqual({ id: "btn" });
      respond({ id: "btn", state: {}, waited: false });
      await p;
    });

    it("sequence wraps steps array", async () => {
      const p = client.sequence([{ method: "health" }, { method: "x", params: { a: 1 } }]);
      const sent = ws.lastSent();
      expect(sent.method).toBe("sequence");
      expect(sent.params).toEqual({
        steps: [{ method: "health" }, { method: "x", params: { a: 1 } }],
      });
      respond({ completedSteps: 2, totalSteps: 2, results: [] });
      await p;
    });

    it("subscribe passes events and throttleMs", async () => {
      const p = client.subscribe(["element:*"], 500);
      const sent = ws.lastSent();
      expect(sent.method).toBe("subscribe");
      expect(sent.params).toEqual({ events: ["element:*"], throttleMs: 500 });
      respond({});
      await p;
    });

    it("subscribe omits throttleMs when not provided", async () => {
      const p = client.subscribe(["a"]);
      const sent = ws.lastSent();
      expect(sent.params).toEqual({ events: ["a"] });
      respond({});
      await p;
    });

    it("unsubscribe passes events list", async () => {
      const p = client.unsubscribe(["a", "b"]);
      const sent = ws.lastSent();
      expect(sent.method).toBe("unsubscribe");
      expect(sent.params).toEqual({ events: ["a", "b"] });
      respond({});
      await p;
    });

    it("subscriptionsList calls subscriptions/list", async () => {
      const p = client.subscriptionsList();
      expect(ws.lastSent().method).toBe("subscriptions/list");
      respond({ events: [], throttleMs: null });
      await p;
    });

    it("pageNavigate passes url", async () => {
      const p = client.pageNavigate("https://x.test");
      const sent = ws.lastSent();
      expect(sent.method).toBe("control/page/navigate");
      expect(sent.params).toEqual({ url: "https://x.test" });
      respond({});
      await p;
    });

    it("pageBack / pageRefresh / screenshot have no params", async () => {
      const p1 = client.pageBack();
      expect(ws.lastSent().method).toBe("control/page/back");
      respond({});
      await p1;

      const p2 = client.pageRefresh();
      expect(ws.lastSent().method).toBe("control/page/refresh");
      respond({});
      await p2;

      const p3 = client.screenshot();
      expect(ws.lastSent().method).toBe("control/screenshot");
      respond({});
      await p3;
    });
  });

  // -------------------------------------------------------------------------
  // 8. ws-package transport variant (on/off)
  // -------------------------------------------------------------------------

  describe("ws-package transport (on/off)", () => {
    let nodeWs: MockNodeWs;
    let nodeClient: NativeWsClient;

    beforeEach(() => {
      nodeWs = new MockNodeWs();
      nodeClient = new NativeWsClient(nodeWs);
    });

    afterEach(() => {
      nodeClient.dispose();
    });

    it("attaches a single message listener via on()", () => {
      expect(nodeWs.listenerCount("message")).toBe(1);
      expect(nodeWs.listenerCount("close")).toBe(1);
      expect(nodeWs.listenerCount("error")).toBe(1);
    });

    it("request/response works with raw-data emission", async () => {
      const promise = nodeClient.call("op", { x: 1 });
      const sent = JSON.parse(nodeWs.sent[0]!);
      expect(sent.method).toBe("op");
      nodeWs.push({ id: sent.id, result: { success: true, data: 42 } });
      await expect(promise).resolves.toBe(42);
    });

    it("close rejects pending requests", async () => {
      const p = nodeClient.call("op");
      nodeWs.simulateClose();
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NativeWsClosedError);
    });

    it("dispose() detaches the wrapped message listener (wsOnMessageWrapper fix)", () => {
      const offSpy = vi.spyOn(nodeWs, "off");
      expect(nodeWs.listenerCount("message")).toBe(1);

      nodeClient.dispose();

      // The wrapped function reference must be passed to off().
      expect(offSpy).toHaveBeenCalledWith("message", expect.any(Function));
      expect(nodeWs.listenerCount("message")).toBe(0);
      expect(nodeWs.listenerCount("close")).toBe(0);
      expect(nodeWs.listenerCount("error")).toBe(0);
    });

    it("post-dispose server pushes do not invoke any client handler", () => {
      const seen: JsonRpcEvent[] = [];
      nodeClient.on("*", (e) => seen.push(e));

      // Pre-dispose: events flow.
      nodeWs.push({ event: "before", data: {}, timestamp: 1 });
      expect(seen).toHaveLength(1);

      nodeClient.dispose();

      // Post-dispose: no further dispatches even though the mock still has
      // its (now empty) bucket. This is the listener-leak fix.
      expect(() =>
        nodeWs.push({ event: "after", data: {}, timestamp: 2 }),
      ).not.toThrow();
      expect(seen).toHaveLength(1);
    });
  });
});
