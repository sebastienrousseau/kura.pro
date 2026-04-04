#!/usr/bin/env node
/**
 * Prune legacy icon variants from all projects.
 *
 * Keeps only the modern minimum set per project:
 *   - *.svg           (scalable vector master)
 *   - 180x180.png     (apple-touch-icon)
 *   - 192x192.png     (Android/Chromium manifest)
 *   - 512x512.png     (Android/Chromium splash)
 *   - {name}-512x512.png (project-specific named variants)
 *
 * Everything else (all @2x/@3x, all .webp/.avif variants of kept sizes,
 * and all other dimensions) is removed — the /api/transform endpoint
 * can generate any size/format on demand.
 */

import fs from 'fs';
import path from 'path';

const KEEP_SIZES = new Set(['180x180', '192x192', '512x512']);

function shouldKeep(filename) {
  // Keep all SVGs
  if (filename.endsWith('.svg')) return true;

  // Keep {size}.png for the essential sizes (no @2x/@3x, no webp/avif)
  for (const size of KEEP_SIZES) {
    if (filename === `${size}.png`) return true;
  }

  // Keep project-named 512 variants (e.g., rssgen-512x512.png)
  if (filename.endsWith('-512x512.png')) return true;

  return false;
}

export function pruneIcons(rootDir, dryRun = false) {
  let kept = 0;
  let removed = 0;
  let savedBytes = 0;

  const projects = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'));

  for (const project of projects) {
    const iconsDir = path.join(rootDir, project.name, 'images', 'icons');
    if (!fs.existsSync(iconsDir)) continue;

    const files = fs.readdirSync(iconsDir);
    for (const file of files) {
      const filePath = path.join(iconsDir, file);
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;

      if (shouldKeep(file)) {
        kept++;
      } else {
        savedBytes += stat.size;
        removed++;
        if (!dryRun) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }

  return { kept, removed, savedBytes };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// CLI execution
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('prune-icons.mjs');
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const rootDir = process.cwd();

  if (dryRun) console.log('DRY RUN — no files will be deleted\n');

  const result = pruneIcons(rootDir, dryRun);

  console.log(`Icons pruned:`);
  console.log(`  Kept:    ${result.kept} files`);
  console.log(`  Removed: ${result.removed} files`);
  console.log(`  Saved:   ${formatBytes(result.savedBytes)}`);
}
