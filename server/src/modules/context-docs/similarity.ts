/**
 * `context-docs` top-K cosine-similarity search — pure ranking algorithm
 * (`specs/cross-cutting/pr-why-risk-brief/plan.md` Work Item 3, spec
 * §6.2a/AC-29). Zero DB/network access; hermetically unit-testable. Mirrors
 * this codebase's established pure-function-extraction precedent
 * (`server/INSIGHTS.md`, 2026-08-09/2026-08-20 — "split the algorithm into a
 * pure function… service method stays a thin fetch-then-delegate wrapper").
 *
 * The `source: 'code'` exclusion itself is NOT enforced here — it's a
 * property of which rows `ContextDocsRepository.getEmbeddedChunks` ever
 * hands to this function (source-filtered at the query). This function
 * ranks whatever it's given; keeping the exclusion at the query layer, not
 * here, is deliberate so a caller can never "forget" the filter by calling
 * this function directly with unfiltered chunks it doesn't have in the
 * first place.
 */

export interface EmbeddedChunk {
  id: string;
  path: string;
  content: string;
  embedding: number[];
}

export interface RankedChunk extends EmbeddedChunk {
  /** Cosine similarity to the query embedding, in [-1, 1]. */
  score: number;
}

/**
 * Ranks `chunks` by cosine similarity against `queryEmbedding`, descending,
 * and returns the top `k`. A chunk whose embedding has zero magnitude (or
 * mismatched dimensionality with `queryEmbedding`) scores `0` rather than
 * throwing — defensive against malformed stored data, not expected in
 * practice since `embedding` is only ever written by this same module's
 * embedder.
 */
export function rankBySimilarity(queryEmbedding: number[], chunks: EmbeddedChunk[], k: number): RankedChunk[] {
  const scored: RankedChunk[] = chunks.map((chunk) => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
