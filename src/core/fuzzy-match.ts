/**
 * Levenshtein distance and fuzzy text matching utilities.
 *
 * Provides edit-distance-based string comparison for element queries that
 * need to tolerate minor text differences (typos, whitespace variations,
 * truncation, etc.).
 */

// ---------------------------------------------------------------------------
// Levenshtein distance
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 *
 * Uses the classic dynamic programming approach with a single-row
 * optimisation to reduce memory from O(m*n) to O(min(m,n)).
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns The minimum number of single-character edits (insertions,
 *          deletions, substitutions) required to transform `a` into `b`.
 */
export function levenshteinDistance(a: string, b: string): number {
  // Ensure `a` is the shorter string so the row array is minimal.
  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  // Trivial cases
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Single-row DP
  const row = new Array<number>(aLen + 1);
  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0]!;
    row[0] = j;

    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const current = row[i]!;
      row[i] = Math.min(
        current + 1,       // deletion
        row[i - 1]! + 1,   // insertion
        prev + cost,        // substitution
      );
      prev = current;
    }
  }

  return row[aLen]!;
}

// ---------------------------------------------------------------------------
// Similarity
// ---------------------------------------------------------------------------

/**
 * Compute a normalised similarity score between two strings.
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns A value in `[0.0, 1.0]` where 1.0 means identical and 0.0
 *          means completely different.
 */
export function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1.0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
}

// ---------------------------------------------------------------------------
// Fuzzy match predicate
// ---------------------------------------------------------------------------

/**
 * Check whether two strings are similar within a given threshold.
 *
 * Includes a fast early-exit: if the absolute length difference alone
 * would push the similarity below the threshold, the full Levenshtein
 * computation is skipped.
 *
 * @param a - First string.
 * @param b - Second string.
 * @param threshold - Minimum similarity score to consider a match
 *                    (0.0-1.0, default 0.7).
 * @returns `true` if the similarity is >= `threshold`.
 */
export function isFuzzyMatch(
  a: string,
  b: string,
  threshold: number = 0.7,
): boolean {
  // Fast early-exit: length difference alone exceeds threshold
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;

  const lenDiff = Math.abs(a.length - b.length);
  const bestPossibleSimilarity = 1.0 - lenDiff / maxLen;
  if (bestPossibleSimilarity < threshold) return false;

  return similarity(a, b) >= threshold;
}

// ---------------------------------------------------------------------------
// Best fuzzy match
// ---------------------------------------------------------------------------

/**
 * Find the best fuzzy match for a needle in a list of candidates.
 *
 * Compares the needle (case-insensitive) against every candidate and
 * returns the one with the highest similarity score, or `null` if the
 * list is empty.
 *
 * @param needle - The string to search for.
 * @param candidates - List of candidate strings.
 * @returns The best match with its score and index, or `null` if no
 *          candidates are provided.
 */
export function bestFuzzyMatch(
  needle: string,
  candidates: string[],
): { value: string; score: number; index: number } | null {
  if (candidates.length === 0) return null;

  const lowerNeedle = needle.toLowerCase();
  let bestScore = -1;
  let bestIndex = -1;

  for (let i = 0; i < candidates.length; i++) {
    const score = similarity(lowerNeedle, candidates[i]!.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return null;

  return {
    value: candidates[bestIndex]!,
    score: bestScore,
    index: bestIndex,
  };
}

// ---------------------------------------------------------------------------
// Token-based matching
// ---------------------------------------------------------------------------

/**
 * Token-based matching: check if all words in `needle` appear somewhere
 * in `haystack`, regardless of order.
 *
 * Both strings are lowercased and split on whitespace. Every token from
 * the needle must be a substring of at least one token in the haystack.
 *
 * @param needle - The search phrase.
 * @param haystack - The text to search within.
 * @returns `true` if every needle token appears in the haystack.
 */
export function tokenMatch(needle: string, haystack: string): boolean {
  const needleTokens = needle.toLowerCase().split(/\s+/).filter(Boolean);
  if (needleTokens.length === 0) return true;

  const haystackLower = haystack.toLowerCase();

  for (const token of needleTokens) {
    if (!haystackLower.includes(token)) return false;
  }

  return true;
}
