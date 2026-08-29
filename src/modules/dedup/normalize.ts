// Pure, Zotero-independent helpers so they can be unit tested with plain mocha.

/**
 * Normalizes a DOI for exact-match comparison: strips URL/prefix wrappers,
 * lowercases, trims. Prefers Zotero.Utilities.cleanDOI when running inside
 * Zotero (handles more edge cases than the fallback regex below).
 */
export function normalizeDOI(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (typeof Zotero !== "undefined" && Zotero?.Utilities?.cleanDOI) {
    const cleaned = Zotero.Utilities.cleanDOI(trimmed);
    return cleaned ? cleaned.toLowerCase() : null;
  }

  const stripped = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
  return stripped ? stripped.toLowerCase() : null;
}

/**
 * Normalizes a title for fuzzy comparison: lowercase, strip punctuation,
 * collapse whitespace.
 */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes an author's last name for fuzzy comparison.
 */
export function normalizeAuthorLastName(
  raw: string | null | undefined,
): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const currRow = new Array(b.length + 1);
    currRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

/**
 * Similarity ratio in [0, 1] between two already-normalized strings, based
 * on Levenshtein distance (1 = identical, 0 = completely different).
 */
export function similarityRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}
