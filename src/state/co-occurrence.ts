/**
 * Element co-occurrence analysis.
 *
 * Tracks which elements appear together across DOM snapshots. Elements that
 * consistently co-occur define a state — e.g., a login form always shows
 * username input + password input + submit button together.
 *
 * The matrix records, for each pair (A, B), how many snapshots contained
 * both A and B. The score is `pairCount / min(countA, countB)`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Serialisable representation of the co-occurrence data. */
export interface CoOccurrenceData {
  /** Pair counts: matrix[a][b] = number of snapshots containing both a and b. */
  matrix: Record<string, Record<string, number>>;
  /** Per-element counts: how many snapshots each element appeared in. */
  counts: Record<string, number>;
  /** Total number of snapshots recorded. */
  totalSnapshots: number;
}

// ---------------------------------------------------------------------------
// CoOccurrenceMatrix
// ---------------------------------------------------------------------------

/**
 * Track which elements appear together across snapshots.
 *
 * The matrix is symmetric — `score(a, b) === score(b, a)`. Internal storage
 * uses the lexicographically smaller ID as the first key to avoid duplication.
 */
export class CoOccurrenceMatrix {
  /** matrix[a][b] = number of snapshots where both a and b were visible. */
  private matrix = new Map<string, Map<string, number>>();

  /** Per-element snapshot count. */
  private counts = new Map<string, number>();

  /** Total snapshots recorded. */
  private _snapshotCount = 0;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Record a snapshot of element IDs that are currently visible. */
  record(elementIds: string[]): void {
    this._snapshotCount++;

    const sorted = [...new Set(elementIds)].sort();

    // Increment individual counts
    for (const id of sorted) {
      this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    }

    // Increment pair counts (only upper triangle — i < j)
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        this.incrementPair(sorted[i], sorted[j]);
      }
    }
  }

  /**
   * Get the co-occurrence score between two elements (0.0-1.0).
   *
   * Formula: `pairCount / min(countA, countB)`.
   * Returns 0 if either element has never been observed.
   */
  score(elementA: string, elementB: string): number {
    if (elementA === elementB) return 1.0;

    const countA = this.counts.get(elementA) ?? 0;
    const countB = this.counts.get(elementB) ?? 0;
    if (countA === 0 || countB === 0) return 0;

    const pairCount = this.getPairCount(elementA, elementB);
    return pairCount / Math.min(countA, countB);
  }

  /**
   * Find groups of elements that always appear together.
   *
   * Uses greedy clustering: start with the highest co-occurrence pair, then
   * add elements that co-occur with ALL current members above the threshold.
   *
   * @param minCoOccurrence - Minimum co-occurrence score to cluster (default 0.8).
   * @returns Array of element ID groups.
   */
  findGroups(minCoOccurrence = 0.8): string[][] {
    const allElements = Array.from(this.counts.keys());
    const assigned = new Set<string>();
    const groups: string[][] = [];

    // Build all pair scores above threshold
    const pairs: Array<{ a: string; b: string; score: number }> = [];
    for (let i = 0; i < allElements.length; i++) {
      for (let j = i + 1; j < allElements.length; j++) {
        const s = this.score(allElements[i], allElements[j]);
        if (s >= minCoOccurrence) {
          pairs.push({ a: allElements[i], b: allElements[j], score: s });
        }
      }
    }

    // Sort descending by score
    pairs.sort((x, y) => y.score - x.score);

    for (const pair of pairs) {
      if (assigned.has(pair.a) && assigned.has(pair.b)) continue;

      // Seed a new group with this pair
      const group: string[] = [];
      if (!assigned.has(pair.a)) group.push(pair.a);
      if (!assigned.has(pair.b)) group.push(pair.b);

      if (group.length === 0) continue;

      // If only one is unassigned, seed from the pair anyway
      if (group.length === 1) {
        // Still need both for seeding
        group.length = 0;
        group.push(pair.a, pair.b);
      }

      // Try to expand: add elements that co-occur with ALL group members
      for (const candidate of allElements) {
        if (assigned.has(candidate)) continue;
        if (group.includes(candidate)) continue;

        const coOccursWithAll = group.every(
          (member) => this.score(member, candidate) >= minCoOccurrence,
        );
        if (coOccursWithAll) {
          group.push(candidate);
        }
      }

      // Only emit groups with 2+ elements
      if (group.length >= 2) {
        for (const id of group) assigned.add(id);
        groups.push(group.sort());
      }
    }

    return groups;
  }

  /** Get the total number of snapshots recorded. */
  get snapshotCount(): number {
    return this._snapshotCount;
  }

  /** Get all observed element IDs. */
  get elementIds(): string[] {
    return Array.from(this.counts.keys());
  }

  /** Get the observation count for a single element. */
  elementCount(elementId: string): number {
    return this.counts.get(elementId) ?? 0;
  }

  /** Reset all data. */
  clear(): void {
    this.matrix.clear();
    this.counts.clear();
    this._snapshotCount = 0;
  }

  /** Export as JSON-serialisable data. */
  toJSON(): CoOccurrenceData {
    const matrixObj: Record<string, Record<string, number>> = {};
    for (const [a, inner] of this.matrix) {
      const innerObj: Record<string, number> = {};
      for (const [b, count] of inner) {
        innerObj[b] = count;
      }
      matrixObj[a] = innerObj;
    }

    const countsObj: Record<string, number> = {};
    for (const [id, count] of this.counts) {
      countsObj[id] = count;
    }

    return {
      matrix: matrixObj,
      counts: countsObj,
      totalSnapshots: this._snapshotCount,
    };
  }

  /** Import from JSON data. */
  static fromJSON(data: CoOccurrenceData): CoOccurrenceMatrix {
    const instance = new CoOccurrenceMatrix();
    instance._snapshotCount = data.totalSnapshots;

    for (const [id, count] of Object.entries(data.counts)) {
      instance.counts.set(id, count);
    }

    for (const [a, inner] of Object.entries(data.matrix)) {
      const innerMap = new Map<string, number>();
      for (const [b, count] of Object.entries(inner)) {
        innerMap.set(b, count);
      }
      instance.matrix.set(a, innerMap);
    }

    return instance;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Increment pair count, using canonical key ordering. */
  private incrementPair(a: string, b: string): void {
    const [first, second] = a < b ? [a, b] : [b, a];
    let inner = this.matrix.get(first);
    if (!inner) {
      inner = new Map();
      this.matrix.set(first, inner);
    }
    inner.set(second, (inner.get(second) ?? 0) + 1);
  }

  /** Get pair count using canonical key ordering. */
  private getPairCount(a: string, b: string): number {
    const [first, second] = a < b ? [a, b] : [b, a];
    return this.matrix.get(first)?.get(second) ?? 0;
  }
}
