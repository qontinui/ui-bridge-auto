/**
 * Reference ID registry for stable snapshot-to-action element targeting.
 *
 * At snapshot time, each element is assigned a ref ID that encodes a
 * structural fingerprint. At action time, the ref is resolved against
 * live DOM elements using a three-pass strategy:
 *
 * 1. Exact registry ID match (element kept its ID).
 * 2. Stable ID match (element changed ID but structural identity held).
 * 3. Fingerprint match (element moved in the DOM but structure matches).
 *
 * A `maxAgeMs` circuit-breaker prevents stale refs from triggering
 * expensive DOM scans after hard re-renders.
 */

import type { QueryableElement } from "../core/element-query";
import type { AutomationElement } from "../types/element";
import {
  computeFingerprint,
  fingerprintMatch,
} from "../discovery/element-fingerprint";
import { generateStableId } from "../discovery/stable-id";
import type { RefId, RefRecord, ResolvedRef } from "./types";
import { RefInvalidatedError } from "./types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default maximum age (ms) before a ref is considered stale. */
const DEFAULT_MAX_AGE_MS = 30_000;

// ---------------------------------------------------------------------------
// RefRegistry
// ---------------------------------------------------------------------------

/** Options for constructing a RefRegistry. */
export interface RefRegistryOptions {
  /** Maximum age (ms) before a ref is considered stale. Default: 30 000. */
  maxAgeMs?: number;
}

/**
 * Assigns and resolves stable reference IDs for snapshot elements.
 *
 * Each instance maintains its own ref map and monotonic counter.
 * Multiple registries can coexist (e.g., one per snapshot session).
 */
export class RefRegistry {
  private readonly refs = new Map<RefId, RefRecord>();
  private readonly maxAgeMs: number;
  private nextSeq = 0;

  constructor(options?: RefRegistryOptions) {
    this.maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  /**
   * Assign a ref ID to a snapshot element.
   *
   * Computes the structural fingerprint from the live DOM element and
   * stores a record that can be resolved later.
   *
   * @param element - The automation element from the snapshot.
   * @param htmlElement - The live DOM element at capture time.
   * @param snapshotTimestamp - The epoch-ms timestamp of the snapshot.
   * @returns A unique ref ID.
   */
  assignRef(
    element: AutomationElement,
    htmlElement: HTMLElement,
    snapshotTimestamp: number,
  ): RefId {
    const seq = this.nextSeq++;
    const refId: RefId = `ref-${snapshotTimestamp}-${seq}`;

    const record: RefRecord = {
      refId,
      fingerprint: computeFingerprint(htmlElement),
      stableId: element.stableId,
      registryIdAtCapture: element.id,
      capturedAt: snapshotTimestamp,
    };

    this.refs.set(refId, record);
    return refId;
  }

  /**
   * Resolve a ref ID to a live DOM element.
   *
   * Three-pass resolution:
   * 1. Exact registry ID match.
   * 2. Stable ID match (via `generateStableId` on live elements).
   * 3. Fingerprint match (structural similarity).
   *
   * @throws {RefInvalidatedError} When the ref cannot be resolved.
   */
  resolve(refId: RefId, liveElements: QueryableElement[]): ResolvedRef {
    const record = this.refs.get(refId);
    if (!record) {
      throw new RefInvalidatedError(refId, "not-found");
    }

    // Circuit-breaker: reject stale snapshots before scanning.
    if (Date.now() - record.capturedAt > this.maxAgeMs) {
      throw new RefInvalidatedError(refId, "stale-snapshot");
    }

    // Pass 1: exact registry ID match.
    const byId = liveElements.find(
      (el) => el.id === record.registryIdAtCapture,
    );
    if (byId) {
      return {
        refId,
        elementId: byId.id,
        stableId: record.stableId,
        element: byId.element,
        resolvedVia: "exact",
      };
    }

    // Pass 2: stable ID match.
    const byStableId = liveElements.find(
      (el) => generateStableId(el.element) === record.stableId,
    );
    if (byStableId) {
      return {
        refId,
        elementId: byStableId.id,
        stableId: record.stableId,
        element: byStableId.element,
        resolvedVia: "stableId",
      };
    }

    // Pass 3: fingerprint match.
    const fpMatches = liveElements.filter((el) =>
      fingerprintMatch(record.fingerprint, computeFingerprint(el.element)),
    );

    if (fpMatches.length === 1) {
      return {
        refId,
        elementId: fpMatches[0].id,
        stableId: generateStableId(fpMatches[0].element),
        element: fpMatches[0].element,
        resolvedVia: "fingerprint",
      };
    }

    if (fpMatches.length > 1) {
      throw new RefInvalidatedError(refId, "ambiguous");
    }

    throw new RefInvalidatedError(refId, "not-found");
  }

  /**
   * Manually invalidate a ref, removing it from the registry.
   */
  invalidate(refId: RefId): void {
    this.refs.delete(refId);
  }

  /**
   * Check whether a ref ID exists in this registry.
   */
  has(refId: RefId): boolean {
    return this.refs.has(refId);
  }

  /**
   * Get the number of refs currently tracked.
   */
  get size(): number {
    return this.refs.size;
  }

  /**
   * Remove all refs from the registry.
   */
  clear(): void {
    this.refs.clear();
    this.nextSeq = 0;
  }
}
