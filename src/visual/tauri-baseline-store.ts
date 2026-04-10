/**
 * Tauri/PostgreSQL Baseline Store
 *
 * Persistent baseline storage backed by the runner's PostgreSQL database
 * via Tauri IPC commands (`sm_save_baseline`, `sm_get_baseline`,
 * `sm_list_baselines`, `sm_delete_baseline`). Baselines survive runner
 * restarts and are shared across all windows of the same runner instance.
 *
 * Requires the runner's Tauri IPC to be available (`window.__TAURI__`).
 * Falls back gracefully if Tauri is not present — all operations return
 * empty/null results with a console warning.
 *
 * @example
 * ```ts
 * const store = new TauriBaselineStore();
 * const manager = new ScreenshotAssertionManager(store);
 *
 * // Baselines persist in PostgreSQL across restarts
 * await manager.captureBaseline("btn-1", buttonElement);
 * // ... later, even after runner restart ...
 * const result = await manager.assertMatchesBaseline("btn-1", buttonElement);
 * ```
 */

import type { MediaSnapshotData } from "@qontinui/ui-bridge";
import type { BaselineStore } from "./types";

// ---------------------------------------------------------------------------
// Tauri IPC helpers
// ---------------------------------------------------------------------------

/** Get the Tauri invoke function, or null if not in a Tauri context. */
function getTauriInvoke(): ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tauri = (globalThis as any).__TAURI__;
  return tauri?.core?.invoke ?? tauri?.invoke ?? null;
}

// ---------------------------------------------------------------------------
// TauriBaselineStore
// ---------------------------------------------------------------------------

/**
 * Persistent baseline store backed by PostgreSQL via Tauri IPC.
 *
 * Each baseline is stored as a row in `runner.ui_bridge_baselines` with
 * the PNG bytes in a BYTEA column. The Tauri commands handle
 * authoritative PNG decode (width/height are always correct).
 */
export class TauriBaselineStore implements BaselineStore {
  private readonly targetScope: string;

  /**
   * @param targetScope — prefix for all keys to namespace baselines.
   *   Default: `"visual-regression"`. The full baseline ID is
   *   `${targetScope}:${key}`.
   */
  constructor(targetScope = "visual-regression") {
    this.targetScope = targetScope;
  }

  private fullKey(key: string): string {
    return `${this.targetScope}:${key}`;
  }

  /** Save a snapshot under the given key. */
  async save(key: string, snapshot: MediaSnapshotData): Promise<void> {
    const invoke = getTauriInvoke();
    if (!invoke) {
      console.warn("[TauriBaselineStore] Tauri not available — save is a no-op");
      return;
    }

    // Strip the data URL prefix if present — the Rust command expects raw base64.
    const pngBase64 = snapshot.data.replace(/^data:image\/[^;]+;base64,/, "");

    await invoke("sm_save_baseline", {
      id: this.fullKey(key),
      targetScope: this.targetScope,
      pngBase64,
      fingerprint: null,
      metadataJson: JSON.stringify({
        elementId: snapshot.elementId,
        mediaType: snapshot.mediaType,
        width: snapshot.width,
        height: snapshot.height,
        timestamp: snapshot.timestamp,
      }),
      ttlDays: null,
    });
  }

  /** Load a snapshot by key, or null if not found. */
  async load(key: string): Promise<MediaSnapshotData | null> {
    const invoke = getTauriInvoke();
    if (!invoke) {
      console.warn("[TauriBaselineStore] Tauri not available — load returns null");
      return null;
    }

    try {
      const result = (await invoke("sm_get_baseline", {
        id: this.fullKey(key),
      })) as {
        png_base64: string;
        width: number;
        height: number;
        metadata_json?: string;
      } | null;

      if (!result) return null;

      // Reconstruct MediaSnapshotData from the stored fields
      const metadata = result.metadata_json
        ? JSON.parse(result.metadata_json)
        : {};

      return {
        data: `data:image/png;base64,${result.png_base64}`,
        width: result.width,
        height: result.height,
        mediaType: metadata.mediaType ?? "image/png",
        elementId: metadata.elementId ?? key,
        timestamp: metadata.timestamp ?? Date.now(),
      };
    } catch {
      return null;
    }
  }

  /** Check whether a key exists. */
  async exists(key: string): Promise<boolean> {
    const loaded = await this.load(key);
    return loaded !== null;
  }

  /** Delete a snapshot by key. Returns true if deleted, false if not found. */
  async delete(key: string): Promise<boolean> {
    const invoke = getTauriInvoke();
    if (!invoke) return false;

    try {
      const deleted = (await invoke("sm_delete_baseline", {
        id: this.fullKey(key),
      })) as boolean;
      return deleted;
    } catch {
      return false;
    }
  }

  /** List all stored keys (with the target scope prefix stripped). */
  async listKeys(): Promise<string[]> {
    const invoke = getTauriInvoke();
    if (!invoke) return [];

    try {
      const metas = (await invoke("sm_list_baselines", {
        targetScope: this.targetScope,
      })) as Array<{ id: string }>;

      const prefix = `${this.targetScope}:`;
      return metas.map((m) =>
        m.id.startsWith(prefix) ? m.id.slice(prefix.length) : m.id,
      );
    } catch {
      return [];
    }
  }
}
