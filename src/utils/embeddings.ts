import { pipeline } from '@xenova/transformers';

const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
  quantized: true,
});

export async function embedDocument(q: string): Promise<number[]> {
  const out = await extractor(q, { pooling: 'mean', normalize: true });
  return out.tolist()[0];
}

export async function embedDocuments(q: string[]): Promise<number[][]> {
  const out = await extractor(q, { pooling: 'mean', normalize: true });
  return out.tolist();
}
