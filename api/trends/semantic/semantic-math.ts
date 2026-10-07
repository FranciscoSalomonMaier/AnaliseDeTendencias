export function cosineSimilarity(a: number[], b: number[]): number {
  if (
    !a.length ||
    a.length !== b.length ||
    a.some((v) => !Number.isFinite(v)) ||
    b.some((v) => !Number.isFinite(v))
  )
    return 0;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] ** 2;
    bb += b[i] ** 2;
  }
  return aa && bb ? Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb))) : 0;
}
export function centroid(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const dimensions = vectors[0].length;
  if (
    !dimensions ||
    vectors.some(
      (v) => v.length !== dimensions || v.some((x) => !Number.isFinite(x)),
    )
  )
    throw new Error('Invalid embedding dimensions');
  const result = Array.from(
    { length: dimensions },
    (_, i) => vectors.reduce((sum, v) => sum + v[i], 0) / vectors.length,
  );
  const norm = Math.sqrt(result.reduce((sum, v) => sum + v ** 2, 0));
  return norm ? result.map((v) => v / norm) : result;
}
export function clusterDistribution(sizes: number[]) {
  const videos = sizes.reduce((sum, size) => sum + size, 0);
  return {
    videos,
    clusters: sizes.length,
    singletons: sizes.filter((n) => n === 1).length,
    pairs: sizes.filter((n) => n === 2).length,
    threeOrMore: sizes.filter((n) => n >= 3).length,
    largest: Math.max(0, ...sizes),
    average: sizes.length ? videos / sizes.length : 0,
  };
}
