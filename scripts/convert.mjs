import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export async function walk(dir, projectDir, stats = { converted: 0, savedBytes: 0 }) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const promises = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      promises.push(walk(full, projectDir, stats));
    } else if (entry.name.toLowerCase().endsWith('.png')) {
      const base = full.replace(/\.png$/i, '');
      const webpOut = `${base}.webp`;
      const avifOut = `${base}.avif`;

      promises.push(
        (async () => {
          const originalSize = fs.statSync(full).size;
          try {
            if (!fs.existsSync(webpOut)) {
              await sharp(full).webp({ quality: 80 }).toFile(webpOut);
              const webpSize = fs.statSync(webpOut).size;
              stats.savedBytes += originalSize - webpSize;
              console.log(`  WebP: ${path.relative(projectDir, webpOut)} (${formatBytes(webpSize)})`);
            }
            if (!fs.existsSync(avifOut)) {
              await sharp(full).avif({ quality: 65 }).toFile(avifOut);
              const avifSize = fs.statSync(avifOut).size;
              console.log(`  AVIF: ${path.relative(projectDir, avifOut)} (${formatBytes(avifSize)})`);
            }
            stats.converted++;
          } catch (err) {
            console.error(`  Error: ${entry.name} — ${err.message}`);
          }
        })()
      );
    }
  }

  await Promise.all(promises);
  return stats;
}

export async function main(projectDir) {
  if (!projectDir) {
    console.error('Usage: node convert.mjs <project_directory>');
    console.error('Example: node convert.mjs ../akande');
    process.exit(1);
  }

  if (!fs.existsSync(projectDir)) {
    console.error(`Directory not found: ${projectDir}`);
    process.exit(1);
  }

  console.log(`\nConverting PNGs in: ${path.resolve(projectDir)}\n`);
  const stats = await walk(projectDir, projectDir);
  console.log(`\nDone! Converted ${stats.converted} files.`);
  console.log(`Estimated WebP savings: ${formatBytes(stats.savedBytes)}\n`);
  return stats;
}

/* v8 ignore start */
const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('convert.mjs');
if (isMain) {
  main(process.argv[2]);
}
/* v8 ignore stop */
