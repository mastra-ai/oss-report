const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_MODEL = 'openai/text-embedding-3-small';
const BATCH_SIZE = 100;

interface EmbeddingResponse {
  data: Array<{ index: number; embedding: number[] }>;
}

/**
 * Embed a batch of texts via OpenRouter's OpenAI-compatible embeddings
 * endpoint. Returns one vector per input, in input order.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set; cannot embed signals.');
  }

  const vectors: number[][] = new Array(texts.length);

  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter embeddings failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const json = (await response.json()) as EmbeddingResponse;
    for (const item of json.data) {
      vectors[start + item.index] = item.embedding;
    }
  }

  return vectors;
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
