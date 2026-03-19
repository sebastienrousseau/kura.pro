import fs from 'fs';
import path from 'path';

const SKIP = new Set(['.git', '.github', 'dashboard', 'scripts', 'node_modules']);
const EXTS = new Set(['.png', '.webp', '.avif', '.svg', '.ico']);

export const getFiles = (dir, baseCwd = dir) => {
  let results = [];
  let list;
  try { list = fs.readdirSync(dir); } catch { return results; }
  for (const file of list) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (SKIP.has(file)) continue;
        results = results.concat(getFiles(full, baseCwd));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (!EXTS.has(ext)) continue;
        const rel = path.relative(baseCwd, full);
        const parts = rel.split('/');
        results.push({
          name: path.basename(file),
          path: rel,
          project: /* v8 ignore next */ parts[0] || 'root',
          category: parts.length >= 3 ? parts[2] : 'general',
          format: ext.slice(1),
          size: stat.size
        });
      }
    } catch { /* skip unreadable */ }
  }
  return results;
};

export function generateManifest(cwd) {
  const manifest = getFiles(cwd, cwd);
  manifest.sort((a, b) => a.path.localeCompare(b.path));
  const outPath = path.join(cwd, 'manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
  console.log(`Manifest generated: ${manifest.length} assets`);
  return manifest;
}

/* v8 ignore next 4 */
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('generate-manifest.mjs');
if (isMain) {
  generateManifest(process.cwd());
}
