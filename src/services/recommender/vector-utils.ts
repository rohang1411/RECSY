/**
 * Parse `pgvector` / Drizzle `vector` column values from the driver.
 */
export function parseVectorColumn(value: unknown): readonly number[] | null {
  if (value == null) return null;
  if (Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number')) {
    return value as number[];
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t) as unknown;
        if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) {
          return arr;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? dot / d : 0;
}
