/**
 * IndexedDB Baseline Store
 *
 * Persistent baseline storage using the browser's IndexedDB API.
 * Baselines survive page reloads and browser restarts, making this
 * suitable for long-running visual regression test suites.
 *
 * @example
 * ```ts
 * const store = new IndexedDBBaselineStore();
 * const manager = new ScreenshotAssertionManager(store);
 *
 * // Baselines persist across page reloads
 * await manager.captureBaseline("btn-1", buttonElement);
 * // ... later, even after reload ...
 * const result = await manager.assertMatchesBaseline("btn-1", buttonElement);
 * ```
 */

import type { MediaSnapshotData } from "@qontinui/ui-bridge";
import type { BaselineStore } from "./types";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for configuring the IndexedDB baseline store. */
export interface IndexedDBStoreOptions {
  /** Database name. Default: 'ui-bridge-auto-baselines'. */
  dbName?: string;
  /** Object store name. Default: 'baselines'. */
  storeName?: string;
}

// ---------------------------------------------------------------------------
// IndexedDBBaselineStore
// ---------------------------------------------------------------------------

/**
 * Persistent baseline store backed by IndexedDB.
 *
 * The database connection is lazily opened on the first operation.
 * Call {@link close} to release the connection when no longer needed.
 */
export class IndexedDBBaselineStore implements BaselineStore {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;
  private readonly storeName: string;

  constructor(options?: IndexedDBStoreOptions) {
    this.dbName = options?.dbName ?? "ui-bridge-auto-baselines";
    this.storeName = options?.storeName ?? "baselines";
  }

  /**
   * Open (or reuse) the IndexedDB connection.
   * Creates the object store on first open (version 1 upgrade).
   */
  private async open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.openPromise) return this.openPromise;

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onerror = () => {
        this.openPromise = null;
        reject(new Error(`Failed to open IndexedDB "${this.dbName}": ${request.error?.message}`));
      };
    });

    return this.openPromise;
  }

  /** Save a snapshot under the given key. */
  async save(key: string, snapshot: MediaSnapshotData): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(snapshot, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save baseline "${key}": ${request.error?.message}`));
    });
  }

  /** Load a snapshot by key, or null if not found. */
  async load(key: string): Promise<MediaSnapshotData | null> {
    const db = await this.open();
    return new Promise<MediaSnapshotData | null>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as MediaSnapshotData) ?? null);
      request.onerror = () => reject(new Error(`Failed to load baseline "${key}": ${request.error?.message}`));
    });
  }

  /** Check whether a key exists. */
  async exists(key: string): Promise<boolean> {
    const db = await this.open();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getKey(key);
      request.onsuccess = () => resolve(request.result !== undefined);
      request.onerror = () => reject(new Error(`Failed to check baseline "${key}": ${request.error?.message}`));
    });
  }

  /** Delete a snapshot by key. Returns true if deleted, false if not found. */
  async delete(key: string): Promise<boolean> {
    const existed = await this.exists(key);
    if (!existed) return false;

    const db = await this.open();
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(new Error(`Failed to delete baseline "${key}": ${request.error?.message}`));
    });
  }

  /** List all stored keys. */
  async listKeys(): Promise<string[]> {
    const db = await this.open();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(new Error(`Failed to list baseline keys: ${request.error?.message}`));
    });
  }

  /**
   * Close the database connection.
   *
   * The store can still be used after closing — the connection will
   * be re-opened on the next operation.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.openPromise = null;
    }
  }
}
