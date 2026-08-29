// Pure statistics helpers, no Zotero dependency -- unit-testable in
// isolation. Used by pilotService.ts to compute AI-human agreement for
// PIL-03 (advisory only, see REQUIREMENTS.md 2.5.3/PIL-07: no automatic
// pass/fail threshold, locking the Codebook is always a human decision).

function buildConfusionMatrix<T>(
  pairs: [T, T][],
  categories: T[],
): { count: number[][]; n: number } {
  const index = new Map<T, number>();
  categories.forEach((c, i) => index.set(c, i));
  const k = categories.length;
  const count: number[][] = Array.from({ length: k }, () =>
    new Array(k).fill(0),
  );
  for (const [a, b] of pairs) {
    count[index.get(a)!][index.get(b)!]++;
  }
  return { count, n: pairs.length };
}

function marginals(
  count: number[][],
  n: number,
): { row: number[]; col: number[] } {
  const k = count.length;
  const row = new Array(k).fill(0);
  const col = new Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      row[i] += count[i][j];
      col[j] += count[i][j];
    }
  }
  return { row: row.map((v) => v / n), col: col.map((v) => v / n) };
}

/**
 * Unweighted Cohen's Kappa, for categorical/text variables. Returns null
 * for an empty input (nothing to compare) and 1 for the degenerate case
 * where every pair used the same single category (observed agreement is
 * trivially 100% and there's no meaningful "chance" baseline to subtract).
 */
export function cohenKappa(pairs: [string, string][]): number | null {
  if (pairs.length === 0) return null;
  const categories = Array.from(new Set(pairs.flatMap(([a, b]) => [a, b])));
  const { count, n } = buildConfusionMatrix(pairs, categories);
  const { row, col } = marginals(count, n);

  let po = 0;
  for (let i = 0; i < categories.length; i++) po += count[i][i];
  po /= n;

  let pe = 0;
  for (let i = 0; i < categories.length; i++) pe += row[i] * col[i];

  if (pe >= 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * Quadratic-weighted Cohen's Kappa, for numeric/ordinal variables. Values
 * are treated as ordered categories (their sorted distinct set), weighted
 * by squared distance between categories rather than exact match/no-match.
 * Same null/degenerate-case handling as cohenKappa.
 */
export function weightedCohenKappa(pairs: [number, number][]): number | null {
  if (pairs.length === 0) return null;
  const categories = Array.from(
    new Set(pairs.flatMap(([a, b]) => [a, b])),
  ).sort((a, b) => a - b);
  const k = categories.length;
  if (k <= 1) return 1;

  const { count, n } = buildConfusionMatrix(pairs, categories);
  const { row, col } = marginals(count, n);

  const maxDistSq = (k - 1) * (k - 1);
  const weight = (i: number, j: number) => 1 - ((i - j) * (i - j)) / maxDistSq;

  let poW = 0;
  let peW = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      const w = weight(i, j);
      poW += w * count[i][j];
      peW += w * row[i] * col[j];
    }
  }
  poW /= n;

  if (peW >= 1) return 1;
  return (poW - peW) / (1 - peW);
}
