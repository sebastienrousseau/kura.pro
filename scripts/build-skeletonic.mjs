#!/usr/bin/env node
/**
 * Vendor Skeletonic Stylus compiled CSS into the static deploy.
 *
 * Reads from node_modules/@sebastienrousseau/skeletonic-stylus/css/
 * and writes a minimal subset into cdn/shared/vendor/skeletonic/ so the
 * Pages deploy can serve it at /shared/vendor/skeletonic/* via the
 * existing /shared/ middleware rewrite.
 *
 * Exposes build() as a named export so vitest can drive the same code
 * paths the CLI entry exercises, using a temp directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILES = [
  ['core/skeletonic.min.css',    'skeletonic.min.css'],
  ['core/skeletonic-ui.min.css', 'skeletonic-ui.min.css'],
];

export function build({ srcDir, outDir, version, log = console.log } = {}) {
  fs.mkdirSync(outDir, { recursive: true });

  for (const [from, to] of FILES) {
    const src = path.join(srcDir, from);
    const dst = path.join(outDir, to);
    fs.copyFileSync(src, dst);
    log(`vendor: ${from} → ${path.relative(process.cwd(), dst)}`);
  }

  fs.writeFileSync(
    path.join(outDir, 'VERSION'),
    `@sebastienrousseau/skeletonic-stylus ${version}\n`,
  );
  log(`vendor: pinned to v${version}`);
  return { outDir, files: FILES.map(([, to]) => to), version };
}

// CLI entry — only runs when invoked directly via `node` / npm script.
// Guarded so importing the module in tests is a pure no-op. Excluded
// from coverage because driving it would require spawning a subprocess
// against a real node_modules layout; the build() function above is
// exercised directly by the unit tests instead.
/* v8 ignore start -- CLI entry; tests exercise build() directly */
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const __dirname = path.dirname(__filename);
  const ROOT = path.resolve(__dirname, '..');
  const SRC = path.join(ROOT, 'node_modules/@sebastienrousseau/skeletonic-stylus/css');
  const OUT = path.join(ROOT, 'cdn/shared/vendor/skeletonic');
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, 'node_modules/@sebastienrousseau/skeletonic-stylus/package.json'),
      'utf8',
    ),
  );
  build({ srcDir: SRC, outDir: OUT, version: pkg.version });
}
/* v8 ignore stop */
