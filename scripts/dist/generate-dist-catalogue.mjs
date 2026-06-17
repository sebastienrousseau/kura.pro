#!/usr/bin/env node

/**
 * generate-dist-catalogue.mjs
 *
 * Reads scripts/dist/packages-catalogue.json (the hand-curated source of
 * truth for every published software product) and emits
 * cdn/en/dist/_dist.json with each package augmented by:
 *
 *   - The latest version from every declared registry (crates.io / npm /
 *     PyPI / GitHub Releases), fetched in parallel.
 *   - A primary version (chosen by registry priority) for display.
 *   - The registry endpoint URLs so the page can deep-link to each.
 *
 * The output is committed alongside the catalogue so the page can serve
 * statically; a Cron-triggered Action will eventually run this on a
 * schedule to keep versions fresh without a developer commit.
 *
 * Usage:
 *   node scripts/dist/generate-dist-catalogue.mjs
 *
 * @module scripts/dist/generate-dist-catalogue
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, 'packages-catalogue.json');
const OUT_PATH = resolve(__dirname, '../../cdn/en/dist/_dist.json');

// Registry priority when choosing the displayed "primary" version of a
// package that's published to more than one registry.
const REGISTRY_PRIORITY = ['npm', 'crates.io', 'pypi', 'github-releases'];

const REGISTRY_ENDPOINTS = {
  npm:               (n) => `https://registry.npmjs.org/${encodeURIComponent(n)}`,
  'crates.io':       (n) => `https://crates.io/api/v1/crates/${n}`,
  pypi:              (n) => `https://pypi.org/pypi/${n}/json`,
  'github-releases': (r) => `https://api.github.com/repos/${r}/releases/latest`,
};

const REGISTRY_PAGES = {
  npm:               (n) => `https://www.npmjs.com/package/${n}`,
  'crates.io':       (n) => `https://crates.io/crates/${n}`,
  pypi:              (n) => `https://pypi.org/project/${n}/`,
  'github-releases': (r) => `https://github.com/${r}/releases/latest`,
};

const USER_AGENT = 'cloudcdn-dist-catalogue (+https://cloudcdn.pro)';
const FETCH_TIMEOUT_MS = 12_000;
const PER_PKG_CONCURRENCY = 8;

/** Pull the latest version from a single registry. Returns null on miss. */
async function fetchLatestVersion({ type, name, repo }) {
  const lookup = type === 'github-releases' ? repo : name;
  const url = REGISTRY_ENDPOINTS[type]?.(lookup);
  if (!url) return null;
  const headers = { 'user-agent': USER_AGENT };
  // GitHub API is happier with an Accept header for the releases endpoint.
  if (type === 'github-releases') headers.Accept = 'application/vnd.github+json';

  let res;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { type, name: lookup, ok: false, error: err.message };
  }

  if (!res.ok) return { type, name: lookup, ok: false, status: res.status };

  const data = await res.json();
  let version = null;
  if (type === 'npm')               version = data['dist-tags']?.latest ?? null;
  else if (type === 'crates.io')    version = data.crate?.newest_version ?? data.crate?.max_version ?? null;
  else if (type === 'pypi')         version = data.info?.version ?? null;
  else if (type === 'github-releases') {
    const raw = data.tag_name ?? data.name ?? null;
    // Strip a leading `v` for display consistency with other registries.
    version = raw ? raw.replace(/^v/, '') : null;
  }
  return {
    type,
    name: lookup,
    ok: !!version,
    version,
    page: REGISTRY_PAGES[type]?.(lookup) ?? null,
  };
}

/** Augment a single package with per-registry version info + primary. */
async function augment(pkg) {
  const registries = pkg.registries || [];
  const results = await Promise.all(registries.map(fetchLatestVersion));
  // Pick the primary version following REGISTRY_PRIORITY; fall back to the
  // first registry with a hit.
  let primary = null;
  for (const rt of REGISTRY_PRIORITY) {
    primary = results.find((r) => r?.ok && r.type === rt);
    if (primary) break;
  }
  if (!primary) primary = results.find((r) => r?.ok) ?? null;

  return {
    ...pkg,
    primary_version: primary?.version ?? null,
    primary_registry: primary?.type ?? null,
    registries: registries.map((r, i) => ({
      ...r,
      version: results[i]?.version ?? null,
      ok: !!results[i]?.ok,
      page: results[i]?.page ?? null,
      error: results[i]?.error ?? (results[i]?.status ? `HTTP ${results[i].status}` : null),
    })),
  };
}

/** Run an async map with a bounded concurrency. */
async function mapConcurrent(items, fn, concurrency) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

/**
 * Read the catalogue, fetch every version in parallel (bounded), and
 * write the augmented output.
 *
 * @param {string} [specPathOverride]
 * @param {string} [outPathOverride]
 * @returns {Promise<{ packages: number, registries: number }>}
 */
export async function main(specPathOverride, outPathOverride) {
  const specFile = specPathOverride || SPEC_PATH;
  const outFile = outPathOverride || OUT_PATH;
  const spec = JSON.parse(readFileSync(specFile, 'utf-8'));

  const augmented = await mapConcurrent(spec.packages, augment, PER_PKG_CONCURRENCY);

  const out = {
    generated_at: new Date().toISOString(),
    featured: spec.featured ?? null,
    categories: spec.categories,
    packages: augmented,
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');

  const regCount = augmented.reduce((s, p) => s + (p.registries?.length ?? 0), 0);
  console.log(`wrote ${outFile}`);
  console.log(`  ${augmented.length} packages, ${regCount} registry lookups`);
  const missing = augmented.filter((p) => !p.primary_version);
  if (missing.length > 0) {
    console.log(`  WARNING: ${missing.length} package(s) have no primary version:`);
    for (const p of missing) console.log(`    - ${p.slug}`);
  }
  return { packages: augmented.length, registries: regCount };
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith('generate-dist-catalogue.mjs') ||
  process.argv[1] === fileURLToPath(import.meta.url)
);
if (isMain) main().catch((err) => {
  console.error(err);
  process.exit(1);
});
