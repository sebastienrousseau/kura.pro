#!/usr/bin/env node
/**
 * Prune redundant format variants across all projects.
 *
 * For each base image name, keeps only the best source file:
 *   - .svg if available (vector, lossless, smallest)
 *   - .png otherwise (highest quality raster source)
 *
 * Removes .webp and .avif derivatives — the /api/transform endpoint
 * generates any format on demand from the source and caches it at the edge.
 *
 * Exception: .ico files are always kept (favicon, special format).
 *
 * Usage:
 *   node scripts/prune-formats.mjs --dry-run   # preview
 *   node scripts/prune-formats.mjs             # execute
 */

import fs from 'fs';
import path from 'path';

const FORMAT_PRIORITY = ['svg', 'png', 'webp', 'avif'];

export function pruneFormats(manifestPath, dryRun = false) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const rootDir = path.dirname(manifestPath);

  // Group by base name (path without extension)
  const groups = {};
  for (const asset of manifest) {
    if (asset.format === 'ico') continue; // never touch .ico files
    const base = asset.path.replace(/\.\w+$/, '');
    if (!groups[base]) groups[base] = [];
    groups[base].push(asset);
  }

  let kept = 0, removed = 0, savedBytes = 0;
  const removedFiles = [];

  for (const [base, files] of Object.entries(groups)) {
    if (files.length <= 1) {
      kept++;
      continue;
    }

    // Sort by format priority — keep the first (best source)
    files.sort((a, b) => FORMAT_PRIORITY.indexOf(a.format) - FORMAT_PRIORITY.indexOf(b.format));

    kept++; // keep the best source
    for (let i = 1; i < files.length; i++) {
      const filePath = path.join(rootDir, files[i].path);
      savedBytes += files[i].size;
      removed++;
      removedFiles.push(files[i].path);

      if (!dryRun) {
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  }

  return { kept, removed, savedBytes, removedFiles };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('prune-formats.mjs');
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const manifestPath = path.join(process.cwd(), 'manifest.json');

  if (dryRun) console.log('DRY RUN — no files will be deleted\n');

  const result = pruneFormats(manifestPath, dryRun);

  console.log(`Format pruning:`);
  console.log(`  Kept:    ${result.kept} source files`);
  console.log(`  Removed: ${result.removed} derivative files`);
  console.log(`  Saved:   ${formatBytes(result.savedBytes)}`);

  if (dryRun && result.removedFiles.length > 0) {
    console.log(`\nFirst 20 files that would be removed:`);
    result.removedFiles.slice(0, 20).forEach(f => console.log(`  ${f}`));
    if (result.removedFiles.length > 20) console.log(`  ... and ${result.removedFiles.length - 20} more`);
  }
}
