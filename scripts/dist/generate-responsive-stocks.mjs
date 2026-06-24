#!/usr/bin/env node
/**
 * Generate responsive webp variants for viewport-sized images.
 *
 * Source sets (see SOURCE_SETS below):
 *   - stocks/images/                         (flat)
 *   - clients/**\/banners/*.webp             (recursive, filtered)
 *   - clients/**\/titles/*.webp              (recursive, filtered)
 *
 * Logos / icons / github social cards are deliberately excluded —
 * they render at fixed sizes and don't benefit from <picture> srcsets.
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

const WIDTHS = [320, 640, 1200, 1920];
const QUALITY = 80;

// Image sets to generate variants for. Each entry is either a flat
// directory or a recursive walk filtered by a path-matching predicate.
// The recursive sets are scoped narrowly to "viewport-sized" images
// (banners, titles) and skip logos/icons/social cards because those
// render at fixed sizes and don't benefit from <picture> srcsets.
export const SOURCE_SETS = [
  {
    name: "stocks",
    baseDir: "stocks/images",
    recursive: false,
  },
  {
    name: "client-banners",
    baseDir: "clients",
    recursive: true,
    // Match clients/<project>/<version>/[**/]banners/<file>.webp
    matches: (path) => /\/banners\//.test(path) && path.endsWith(".webp"),
  },
  {
    name: "client-titles",
    baseDir: "clients",
    recursive: true,
    matches: (path) => /\/titles\//.test(path) && path.endsWith(".webp"),
  },
];

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
 * Returns variant paths that don't exist on disk. Used by --check mode
 * and the unit tests — MUST NOT consult mtimes because git checkout
 * sets arbitrary mtimes (and on CI, source and variant can be checked
 * out in any order), which would falsely flag everything as stale.
 *
 * "Source was updated but variants weren't regenerated" is detected by
 * staleVariants() below, called only from local generate mode where
 * mtimes are meaningful.
 */
export async function missingVariants(sourcePath) {
  const missing = [];
  for (const width of WIDTHS) {
    const target = variantPath(sourcePath, width);
    if (!(await fileExists(target))) {
      missing.push({ target, width });
    }
  }
  return missing;
}

/**
 * Returns variant paths that need regeneration: missing OR stale
 * (variant mtime older than source mtime). Local generate mode only —
 * see missingVariants() docstring for why --check can't use this.
 */
export async function staleVariants(sourcePath) {
  const stale = [];
  for (const width of WIDTHS) {
    const target = variantPath(sourcePath, width);
    if (!(await fileExists(target)) || !(await variantIsFresh(target, sourcePath))) {
      stale.push({ target, width });
    }
  }
  return stale;
}

async function generateVariants(sourcePath, opts = {}) {
  // --check uses missingVariants (no mtime); generate uses
  // staleVariants (existence + mtime).
  const todo = opts.check
    ? await missingVariants(sourcePath)
    : await staleVariants(sourcePath);
  if (todo.length === 0) return { generated: 0, skipped: WIDTHS.length };

  /* v8 ignore start — sharp IO + CLI output, exercised by the manual
     `npm run dist:responsive` rehearsal rather than the unit tests. */
  for (const { target, width } of todo) {
    if (opts.dryRun || opts.check) continue;
    await sharp(sourcePath)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(target);
  }
  /* v8 ignore stop */

  return { generated: todo.length, skipped: WIDTHS.length - todo.length, missing: todo };
}

/**
 * Recursively walk a directory and yield absolute file paths that
 * pass the `matches` predicate AND `isSourceImage` (so we never
 * re-process an already-generated variant). Skips .DS_Store + any
 * dotfiles up front for cheap-out.
 */
export async function* walkSources(baseDir, matches) {
  let entries;
  try { entries = await readdir(baseDir, { withFileTypes: true }); }
  catch { return; } // dir doesn't exist — silently skip
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(baseDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkSources(fullPath, matches);
    } else if (entry.isFile() && isSourceImage(entry.name) && matches(fullPath)) {
      yield fullPath;
    }
  }
}

async function collectSources(set) {
  if (!set.recursive) {
    let entries;
    try { entries = await readdir(set.baseDir); }
    catch { return []; }
    return entries.filter(isSourceImage).sort().map((f) => join(set.baseDir, f));
  }
  const out = [];
  for await (const p of walkSources(set.baseDir, set.matches)) out.push(p);
  return out.sort();
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

  let totalGenerated = 0;
  let totalMissing = 0;
  const missingFiles = [];
  let totalSources = 0;

  for (const set of SOURCE_SETS) {
    const sources = await collectSources(set);
    console.log(`[${set.name}] ${set.baseDir} — ${sources.length} source images`);
    totalSources += sources.length;

    for (const sourcePath of sources) {
      const result = await generateVariants(sourcePath, {
        check: values.check,
        dryRun: values["dry-run"],
      });
      if (result.generated > 0) {
        totalGenerated += result.generated;
        if (values.check || values["dry-run"]) {
          totalMissing += result.generated;
          for (const m of result.missing) missingFiles.push(m.target);
        } else {
          console.log(`  ${basename(sourcePath)}: generated ${result.generated} variant(s)`);
        }
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
    console.log(`\n✓ All ${totalSources * WIDTHS.length} variants present and fresh.`);
    return;
  }

  console.log(`\nDone — generated ${totalGenerated} variant(s) across ${totalSources} sources.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
