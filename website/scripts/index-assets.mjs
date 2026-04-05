/**
 * Index asset metadata into Vectorize for semantic search.
 *
 * Reads manifest.json, generates embeddings via the Cloudflare AI REST API,
 * and upserts vectors to the "cloudcdn-knowledge" Vectorize index
 * with namespace "assets".
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx node scripts/index-assets.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_NAME = 'cloudcdn-knowledge';
const BATCH_SIZE = 20;

/**
 * Build a text description from an asset's metadata for embedding.
 */
export function describeAsset(asset) {
  return `${asset.name} - ${asset.project} project, ${asset.category} category, ${asset.format} format`;
}

/**
 * Generate embeddings for an array of texts via the Cloudflare AI REST API.
 */
export async function embedTexts(texts, cfApi, headers) {
  const res = await fetch(`${cfApi}/ai/run/@cf/baai/bge-base-en-v1.5`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: texts }),
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(`Embedding failed: ${JSON.stringify(json.errors)}`);
  }
  return json.result.data;
}

/**
 * Upsert vectors to the Vectorize index (NDJSON format).
 */
export async function upsertVectors(vectors, cfApi, apiToken) {
  const ndjson = vectors.map((v) => JSON.stringify(v)).join('\n');
  const res = await fetch(
    `${cfApi}/vectorize/v2/indexes/${INDEX_NAME}/upsert`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
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

/**
 * Main indexing function.
 */
export async function main() {
  const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
  const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;

  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error(
      'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables'
    );
    process.exit(1);
  }

  const CF_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
  const headers = {
    Authorization: `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const manifestPath = path.resolve(__dirname, '..', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(
      `manifest.json not found at ${manifestPath}. Run generate-manifest.mjs first.`
    );
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`Loaded ${manifest.length} assets from manifest.json\n`);

  // Build descriptions
  const descriptions = manifest.map(describeAsset);

  // Generate embeddings in batches
  console.log('Generating embeddings...\n');
  const vectors = [];

  for (let i = 0; i < descriptions.length; i += BATCH_SIZE) {
    const batchDescs = descriptions.slice(i, i + BATCH_SIZE);
    const batchAssets = manifest.slice(i, i + BATCH_SIZE);
    const embeddings = await embedTexts(batchDescs, CF_API, headers);

    for (let j = 0; j < batchAssets.length; j++) {
      const asset = batchAssets[j];
      vectors.push({
        id: `asset-${i + j}`,
        values: embeddings[j],
        namespace: 'assets',
        metadata: {
          name: asset.name,
          path: asset.path,
          project: asset.project,
          category: asset.category,
          format: asset.format,
          size: asset.size,
        },
      });
    }

    console.log(
      `  Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(descriptions.length / BATCH_SIZE)}`
    );
  }

  // Upsert in batches of 100
  console.log(`\nUpserting ${vectors.length} vectors to Vectorize...`);

  for (let i = 0; i < vectors.length; i += 100) {
    const batch = vectors.slice(i, i + 100);
    await upsertVectors(batch, CF_API, API_TOKEN);
    console.log(
      `  Upserted batch ${Math.floor(i / 100) + 1}/${Math.ceil(vectors.length / 100)}`
    );
  }

  console.log('\nAsset indexing complete!');
  return vectors.length;
}

/* v8 ignore next 7 */
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('index-assets.mjs');
if (isMain) {
  main().catch((err) => {
    console.error('Indexing failed:', err.message);
    process.exit(1);
  });
}
