/** Rank metrics. `ranked` = result ids best-first; `rel` = set of relevant ids. */
export function firstRelevantRank(ranked: string[], rel: Set<string>): number | null {
  for (let i = 0; i < ranked.length; i++) if (rel.has(ranked[i]!)) return i + 1;
  return null;
}
export const recallAt = (ranks: (number | null)[], k: number): number => (ranks.length ? ranks.filter((r) => r !== null && r <= k).length / ranks.length : 0);
export const mrr = (ranks: (number | null)[]): number => (ranks.length ? ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / ranks.length : 0);
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
