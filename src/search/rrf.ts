/** Reciprocal Rank Fusion. `lists` are ranked id arrays (best first). score = Σ 1 / (k + rank), rank is 1-based. */
export function rrf(lists: Record<string, string[]>, k = 60): { id: string; score: number; ranks: Record<string, number> }[] {
  const acc = new Map<string, { score: number; ranks: Record<string, number> }>();
  for (const [name, ids] of Object.entries(lists)) {
    ids.forEach((id, i) => {
      const e = acc.get(id) ?? { score: 0, ranks: {} };
      e.score += 1 / (k + i + 1);
      e.ranks[name] = i + 1;
      acc.set(id, e);
    });
  }
  return [...acc.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score);
}
