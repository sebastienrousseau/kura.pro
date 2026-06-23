#!/usr/bin/env node
/**
 * Generate responsive webp variants for /stocks/images/*.webp.
 *
 * For each source image, produces four width variants in the same
 * directory:
 *     <name>-320.webp   (mobile)
 *     <name>-640.webp   (mid)
 *     <name>-1200.webp  (desktop)
 *     <name>-1920.webp  (retina / full-bleed)
 *
 * Why this exists
 * ---------------
 * Marketing pages (sebastienrousseau.com, cloudcdn.pro docs, etc.)
 * previously referenced images via /api/transform?url=…&w=N&format=
 * webp — which invoked the Worker on every uncached request and was
 * the confirmed source of the 2026-06-23 6 GB UTC-midnight bandwidth
 * spike. With pre-generated variants, the same `<picture>`/`srcset`
 * markup hits /stocks/images/<name>-<w>.webp directly:
 *   - Zero transform work at the edge (no Workers AI / image-resize)
 *   - Static-asset cache TTL (long)
 *   - Attack surface limited to "files that already exist" — no more
 *     "spin arbitrary ?w= values to evade cache" abuse
 *
 * Behaviour
 * ---------
 *   - Idempotent: skips variants whose mtime is newer than the source.
 *   - No upscaling: sharp's withoutEnlargement=true means a 600px-wide
 *     source produces -1200.webp + -1920.webp capped at 600px (the
 *     browser still picks correctly based on the srcset width hint;
 *     the file is just smaller than the label suggests).
 *   - Source-image detection uses an explicit suffix denylist so files
 *     that already end in `-320.webp` / `-640.webp` / etc. aren't
 *     treated as new sources to re-process (avoids infinite recursion
 *     on a clean re-run).
 *
 * Usage
 * -----
 *     npm run dist:responsive          # generate all missing variants
 *     npm run dist:responsive -- --check  # exit 1 if any variant is missing (CI gate)
 *
 * After adding a new image to stocks/images/, run the bare command
 * locally and commit the generated files alongside the source.
 */

import { readdir, stat } from "node:fs/promises";
import { join, basename, dirname, extname } from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const STOCKS_DIR = "stocks/images";
const WIDTHS = [320, 640, 1200, 1920];
const QUALITY = 80;

// A file is a "source" when it ends in .webp AND does NOT end in a
// recognised width-variant suffix. Using an exact-width allowlist
// rather than a generic `-\d+.webp` pattern avoids false positives
// from filenames that incidentally end in digits (e.g. years).
const WIDTH_SUFFIX_RE = new RegExp(`-(?:${WIDTHS.join("|")})\\.webp$`);

export function isSourceImage(filename) {
  if (!filename.endsWith(".webp")) return false;
  if (WIDTH_SUFFIX_RE.test(filename)) return false;
  return true;
}

export function variantPath(sourcePath, width) {
  const dir = dirname(sourcePath);
  const stem = basename(sourcePath, extname(sourcePath));
  return join(dir, `${stem}-${width}.webp`);
}

async function fileExists(path) {
  try { await stat(path); return true; }
  catch { return false; }
}

async function variantIsFresh(variant, source) {
  try {
    const [v, s] = await Promise.all([stat(variant), stat(source)]);
    return v.mtimeMs >= s.mtimeMs;
  } catch {
    return false;
  }
}

/**
 * Returns the list of variant paths that need to be generated for the
 * given source. Empty array = source is fully covered.
 */
export async function missingVariants(sourcePath) {
  const missing = [];
  for (const width of WIDTHS) {
    const target = variantPath(sourcePath, width);
    if (!(await fileExists(target)) || !(await variantIsFresh(target, sourcePath))) {
      missing.push({ target, width });
    }
  }
  return missing;
}

async function generateVariants(sourcePath, opts = {}) {
  const missing = await missingVariants(sourcePath);
  if (missing.length === 0) return { generated: 0, skipped: WIDTHS.length };

  /* v8 ignore start — sharp IO + CLI output, exercised by the manual
     `npm run dist:responsive` rehearsal rather than the unit tests. */
  for (const { target, width } of missing) {
    if (opts.dryRun) continue;
    await sharp(sourcePath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(target);
  }
  /* v8 ignore stop */

  return { generated: missing.length, skipped: WIDTHS.length - missing.length, missing };
}

/* v8 ignore start — main() is a CLI entry point; covered by the
   manual `--check` rehearsal. Pure helpers above are unit-tested. */
async function main() {
  const { values } = parseArgs({
    options: {
      check:   { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const entries = await readdir(STOCKS_DIR);
  const sources = entries.filter(isSourceImage).sort();

  console.log(`Scanning ${STOCKS_DIR} — found ${sources.length} source images`);

  let totalGenerated = 0;
  let totalMissing = 0;
  const missingFiles = [];

  for (const filename of sources) {
    const sourcePath = join(STOCKS_DIR, filename);
    const result = await generateVariants(sourcePath, { dryRun: values.check || values["dry-run"] });
    if (result.generated > 0) {
      totalGenerated += result.generated;
      if (values.check || values["dry-run"]) {
        totalMissing += result.generated;
        for (const m of result.missing) missingFiles.push(m.target);
      } else {
        console.log(`${filename}: generated ${result.generated} variant(s)`);
      }
    }
  }

  if (values.check) {
    if (totalMissing > 0) {
      console.error(`\n✘ ${totalMissing} responsive variant(s) missing or stale:`);
      for (const f of missingFiles.slice(0, 20)) console.error(`  - ${f}`);
      if (missingFiles.length > 20) console.error(`  … and ${missingFiles.length - 20} more`);
      console.error(`\nRun \`npm run dist:responsive\` to regenerate, then commit.`);
      process.exit(1);
    }
    console.log(`\n✓ All ${sources.length * WIDTHS.length} variants present and fresh.`);
    return;
  }

  console.log(`\nDone — generated ${totalGenerated} variant(s) across ${sources.length} sources.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
