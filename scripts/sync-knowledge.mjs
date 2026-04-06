import fs from 'fs';
import path from 'path';

const INDEX_NAME = 'cloudcdn-knowledge';

// --- Chunking ---
export function chunkText(text, source, maxTokens = 500, overlap = 100) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).length;
    if (currentLen + words > maxTokens && current.length > 0) {
      chunks.push({
        content: current.join(' '),
        source,
      });
      // Overlap: keep last few sentences
      const overlapSentences = [];
      let overlapLen = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const sLen = current[i].split(/\s+/).length;
        if (overlapLen + sLen > overlap) break;
        overlapSentences.unshift(current[i]);
        overlapLen += sLen;
      }
      current = overlapSentences;
      currentLen = overlapLen;
    }
    current.push(sentence);
    currentLen += words;
  }

  /* v8 ignore next -- defensive: loop always pushes ≥1 item */
  if (current.length > 0) {
    chunks.push({ content: current.join(' '), source });
  }

  return chunks;
}

// --- Embedding via Workers AI REST API ---
export async function embedTexts(texts, CF_API, headers) {
  const res = await fetch(
    `${CF_API}/ai/run/@cf/baai/bge-base-en-v1.5`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: texts }),
    }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Embedding failed: ${JSON.stringify(json.errors)}`);
  }
  return json.result.data;
}

// --- Upsert to Vectorize ---
export async function upsertVectors(vectors, CF_API, API_TOKEN) {
  // Vectorize expects NDJSON format for upsert
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n');

  const res = await fetch(
    `${CF_API}/vectorize/v2/indexes/${INDEX_NAME}/upsert`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    }
  );
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Upsert failed: ${JSON.stringify(json.errors)}`);
  }
  return json.result;
}

// --- Main ---
export async function main() {
  const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
  const CONTENT_DIR = path.resolve(process.argv[2] || '../content');

  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables');
    process.exit(1);
  }

  const CF_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
  const headers = {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  if (!fs.existsSync(CONTENT_DIR)) {
    console.error(`Content directory not found: ${CONTENT_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md'));
  console.log(`Found ${files.length} content files in ${CONTENT_DIR}\n`);

  const allChunks = [];

  for (const file of files) {
    const text = fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8');
    const chunks = chunkText(text, file);
    allChunks.push(...chunks);
    console.log(`  ${file}: ${chunks.length} chunks`);
  }

  console.log(`\nTotal chunks: ${allChunks.length}`);
  console.log('Generating embeddings...\n');

  // Process in batches of 20 (API limit)
  const BATCH_SIZE = 20;
  const vectors = [];

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);
    const embeddings = await embedTexts(texts, CF_API, headers);

    for (let j = 0; j < batch.length; j++) {
      vectors.push({
        id: `chunk-${i + j}`,
        values: embeddings[j],
        metadata: {
          source: batch[j].source,
          content: batch[j].content.slice(0, 9000), // Vectorize metadata limit ~10KB
        },
      });
    }

    console.log(`  Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)}`);
  }

  console.log(`\nUpserting ${vectors.length} vectors to Vectorize...`);

  // Upsert in batches of 100
  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    await upsertVectors(batch, CF_API, API_TOKEN);
    console.log(`  Upserted batch ${Math.floor(i / 100) + 1}/${Math.ceil(vectors.length / 100)}`);
  }

  console.log('\nKnowledge sync complete!');
}

/* v8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('sync-knowledge.mjs');
if (isMain) {
  main().catch((err) => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
}
/* v8 ignore stop */
