#!/usr/bin/env node
/**
 * Vendor Skeletonic Stylus compiled CSS into the static deploy.
 *
 * Reads from node_modules/@sebastienrousseau/skeletonic-stylus/css/
 * and writes a minimal subset into cdn/vendor/skeletonic/ so the
 * Pages deploy can serve it at /vendor/skeletonic/*.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules/@sebastienrousseau/skeletonic-stylus/css');
// Under cdn/shared/ so the Pages middleware /shared/ rewrite picks it up.
const OUT = path.join(ROOT, 'cdn/shared/vendor/skeletonic');

const FILES = [
  ['core/skeletonic.min.css',    'skeletonic.min.css'],
  ['core/skeletonic-ui.min.css', 'skeletonic-ui.min.css'],
];

fs.mkdirSync(OUT, { recursive: true });

const pkg = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'node_modules/@sebastienrousseau/skeletonic-stylus/package.json'),
    'utf8',
  ),
);

for (const [from, to] of FILES) {
  const src = path.join(SRC, from);
  const dst = path.join(OUT, to);
  fs.copyFileSync(src, dst);
  console.log(`vendor: ${from} → cdn/shared/vendor/skeletonic/${to}`);
}

fs.writeFileSync(
  path.join(OUT, 'VERSION'),
  `@sebastienrousseau/skeletonic-stylus ${pkg.version}\n`,
);
console.log(`vendor: pinned to v${pkg.version}`);
