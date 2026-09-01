// Pure statistics helpers, no Zotero dependency -- unit-testable in
// isolation. Used by consistencyService.ts to compare AI vs. human
// screening decisions (advisory only: nothing here blocks or auto-decides
// anything, the result is just handed back for the UI to display).

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

export interface CategoryKappa {
  category: string;
  observedAgreement: number;
  kappa: number | null;
}

/**
 * Per-category (conditional) Kappa: each category is collapsed to a binary
 * "this category vs. everything else" 2x2 table, so a category can be
 * flagged as low-agreement even when the overall Kappa looks fine. Reuses
 * the same confusion matrix as cohenKappa rather than rebuilding it, so
 * the two always agree on which categories exist and how they're counted.
 */
export function cohenKappaByCategory(
  pairs: [string, string][],
): CategoryKappa[] {
  if (pairs.length === 0) return [];
  const categories = Array.from(new Set(pairs.flatMap(([a, b]) => [a, b])));
  const { count, n } = buildConfusionMatrix(pairs, categories);
  const { row, col } = marginals(count, n);

  return categories.map((category, i) => {
    const bothThis = count[i][i] / n;
    const bothOther = 1 - row[i] - col[i] + bothThis;
    const po = bothThis + bothOther;
    const pe = row[i] * col[i] + (1 - row[i]) * (1 - col[i]);
    const kappa = pe >= 1 ? 1 : (po - pe) / (1 - pe);
    return { category, observedAgreement: po, kappa };
  });
}
