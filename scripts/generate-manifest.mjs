import fs from 'fs';
import path from 'path';

const SKIP = new Set(['.git', '.github', 'dashboard', 'scripts', 'node_modules']);
const EXTS = new Set(['.png', '.webp', '.avif', '.svg', '.ico']);

const getFiles = (dir) => {
  let results = [];
  let list;
  try { list = fs.readdirSync(dir); } catch { return results; }
  for (const file of list) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (SKIP.has(file)) continue;
        results = results.concat(getFiles(full));
      } else {
        const ext = path.extname(file).toLowerCase();
        if (!EXTS.has(ext)) continue;
        const rel = path.relative(process.cwd(), full);
        const parts = rel.split('/');
        results.push({
          name: path.basename(file),
          path: rel,
          project: parts[0] || 'root',
          category: parts.length >= 3 ? parts[2] : 'general',
          format: ext.slice(1),
          size: stat.size
        });
      }
    } catch { /* skip unreadable */ }
  }
  return results;
};

const manifest = getFiles('.');
manifest.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Manifest generated: ${manifest.length} assets`);
