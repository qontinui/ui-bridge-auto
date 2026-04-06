import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { MediaSnapshotData } from "@qontinui/ui-bridge";
import { IndexedDBBaselineStore } from "../../visual/indexed-db-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSnapshot(id: string, width = 100, height = 50): MediaSnapshotData {
  return {
    data: `base64-${id}`,
    width,
    height,
    mediaType: "image/png",
    elementId: id,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndexedDBBaselineStore", () => {
  let store: IndexedDBBaselineStore;

  beforeEach(() => {
    store = new IndexedDBBaselineStore({
      dbName: `test-baselines-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
  });

  afterEach(() => {
    store.close();
  });

  describe("save and load", () => {
    it("saves and loads a snapshot", async () => {
      const snap = createSnapshot("el-1");
      await store.save("key-1", snap);

      const loaded = await store.load("key-1");
      expect(loaded).toEqual(snap);
    });

    it("returns null for non-existent key", async () => {
      const loaded = await store.load("nonexistent");
      expect(loaded).toBeNull();
    });

    it("overwrites existing key on save", async () => {
      const snap1 = createSnapshot("el-1", 100, 50);
      const snap2 = createSnapshot("el-1", 200, 100);

      await store.save("key-1", snap1);
      await store.save("key-1", snap2);

      const loaded = await store.load("key-1");
      expect(loaded?.width).toBe(200);
      expect(loaded?.height).toBe(100);
    });
  });

  describe("exists", () => {
    it("returns false for non-existent key", async () => {
      expect(await store.exists("key-1")).toBe(false);
    });

    it("returns true after save", async () => {
      await store.save("key-1", createSnapshot("el-1"));
      expect(await store.exists("key-1")).toBe(true);
    });
  });

  describe("delete", () => {
    it("deletes existing key and returns true", async () => {
      await store.save("key-1", createSnapshot("el-1"));
      const deleted = await store.delete("key-1");

      expect(deleted).toBe(true);
      expect(await store.exists("key-1")).toBe(false);
    });

    it("returns false for non-existent key", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("listKeys", () => {
    it("returns empty array when no keys", async () => {
      const keys = await store.listKeys();
      expect(keys).toEqual([]);
    });

    it("lists all stored keys", async () => {
      await store.save("a", createSnapshot("1"));
      await store.save("b", createSnapshot("2"));
      await store.save("c", createSnapshot("3"));

      const keys = await store.listKeys();
      expect(keys).toHaveLength(3);
      expect(keys.sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("close", () => {
    it("allows re-opening after close", async () => {
      await store.save("key-1", createSnapshot("el-1"));
      store.close();

      // Should re-open transparently
      const loaded = await store.load("key-1");
      expect(loaded).not.toBeNull();
    });

    it("is a no-op when not open", () => {
      expect(() => store.close()).not.toThrow();
    });
  });

  describe("lazy initialization", () => {
    it("does not open DB until first operation", async () => {
      // Just constructing should not throw or open anything
      const lazyStore = new IndexedDBBaselineStore({
        dbName: `lazy-test-${Date.now()}`,
      });

      // First operation triggers open
      const keys = await lazyStore.listKeys();
      expect(keys).toEqual([]);
      lazyStore.close();
    });
  });
});
