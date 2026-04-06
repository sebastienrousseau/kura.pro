#!/usr/bin/env node
/**
 * Normalize all client directory structures to a consistent layout:
 *
 *   clients/{name}/v1/banners/
 *   clients/{name}/v1/github/
 *   clients/{name}/v1/icons/
 *   clients/{name}/v1/logos/
 *   clients/{name}/v1/titles/
 *   clients/{name}/v1/favicon.ico
 *
 * Also handles:
 *   - Existing images/* → v1/*
 *   - Existing v1/v2 at root level (pain001, dotfiles)
 *   - Flat dirs at root (skeletonic: icon/, logo/, title/)
 *   - Loose files (cs50x: *.svg at root)
 *   - Stray Icon/README.md files (cleanup)
 *   - Extra subdirs (promos, collections, actions, screenshots, youtube) → v1/
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const CLIENTS_DIR = path.join(process.cwd(), 'clients');
const STANDARD_DIRS = ['banners', 'github', 'icons', 'logos', 'titles'];
const DRY_RUN = process.argv.includes('--dry-run');

function gitMv(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  if (DRY_RUN) {
    console.log(`  mv ${path.relative(process.cwd(), src)} → ${path.relative(process.cwd(), dest)}`);
  } else {
    try {
      execSync(`git mv "${src}" "${dest}"`, { stdio: 'pipe' });
    } catch {
      // Fallback for untracked files
      fs.renameSync(src, dest);
    }
  }
}

function gitRm(filePath) {
  if (DRY_RUN) {
    console.log(`  rm ${path.relative(process.cwd(), filePath)}`);
  } else {
    try {
      execSync(`git rm -f "${filePath}"`, { stdio: 'pipe' });
    } catch {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      removeEmptyDirs(full);
    }
  }
  // Re-check after recursive cleanup
  const remaining = fs.readdirSync(dir).filter(f => f !== '.DS_Store');
  if (remaining.length === 0) {
    // Remove DS_Store if it's the only thing left
    const ds = path.join(dir, '.DS_Store');
    if (fs.existsSync(ds)) fs.unlinkSync(ds);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
}

const clients = fs.readdirSync(CLIENTS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort();

let moved = 0, removed = 0;

for (const client of clients) {
  const clientDir = path.join(CLIENTS_DIR, client);
  const imagesDir = path.join(clientDir, 'images');
  const v1Dir = path.join(clientDir, 'v1');

  console.log(`\n${client}/`);

  // 1. Remove stray files: Icon, README.md, .DS_Store at client root
  for (const junk of ['Icon', 'Icon\r', 'README.md']) {
    const junkPath = path.join(clientDir, junk);
    if (fs.existsSync(junkPath)) {
      gitRm(junkPath);
      removed++;
    }
  }

  // 2. Handle loose files at root (cs50x pattern: SVGs at root)
  const rootFiles = fs.readdirSync(clientDir, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && e.name !== 'Icon' && e.name !== 'README.md');
  if (rootFiles.length > 0 && !fs.existsSync(imagesDir) && !fs.existsSync(v1Dir)) {
    // Move loose files into v1/general/
    const generalDir = path.join(v1Dir, 'general');
    for (const f of rootFiles) {
      gitMv(path.join(clientDir, f.name), path.join(generalDir, f.name));
      moved++;
    }
  }

  // 3. Handle flat dirs at client root (skeletonic pattern: icon/, logo/, title/)
  const flatDirMap = { icon: 'icons', logo: 'logos', title: 'titles' };
  for (const [flatName, stdName] of Object.entries(flatDirMap)) {
    const flatDir = path.join(clientDir, flatName);
    if (fs.existsSync(flatDir) && fs.statSync(flatDir).isDirectory()) {
      const files = fs.readdirSync(flatDir).filter(f => !f.startsWith('.'));
      const destDir = path.join(v1Dir, stdName);
      for (const f of files) {
        gitMv(path.join(flatDir, f), path.join(destDir, f));
        moved++;
      }
    }
  }

  // 4. Move images/* → v1/*
  if (fs.existsSync(imagesDir)) {
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const src = path.join(imagesDir, entry.name);

      if (entry.isDirectory()) {
        // Move entire subdir: images/banners/ → v1/banners/
        const destDir = path.join(v1Dir, entry.name);
        const files = fs.readdirSync(src).filter(f => !f.startsWith('.'));
        for (const f of files) {
          const srcFile = path.join(src, f);
          if (fs.statSync(srcFile).isDirectory()) {
            // Nested dir (rare) — move contents
            const nestedFiles = fs.readdirSync(srcFile).filter(nf => !nf.startsWith('.'));
            for (const nf of nestedFiles) {
              gitMv(path.join(srcFile, nf), path.join(destDir, entry.name, nf));
              moved++;
            }
          } else {
            gitMv(srcFile, path.join(destDir, f));
            moved++;
          }
        }
      } else {
        // Loose file in images/ (e.g., favicon.ico, sequence-diagram.webp)
        gitMv(src, path.join(v1Dir, entry.name));
        moved++;
      }
    }
  }

  // 5. Handle existing v1/v2 at client root (pain001, dotfiles pattern)
  //    These already have the right name — just ensure they exist
  for (const vDir of ['v1', 'v2']) {
    const existingV = path.join(clientDir, vDir);
    if (fs.existsSync(existingV) && existingV !== v1Dir) {
      // v2 stays as v2 — already correctly named
    }
  }

  // 6. Handle videos/ at client root (audioanalyser)
  const videosDir = path.join(clientDir, 'videos');
  if (fs.existsSync(videosDir)) {
    const files = fs.readdirSync(videosDir).filter(f => !f.startsWith('.'));
    for (const f of files) {
      gitMv(path.join(videosDir, f), path.join(v1Dir, 'videos', f));
      moved++;
    }
  }

  // 7. Ensure standard directories exist in v1
  if (!DRY_RUN && fs.existsSync(v1Dir)) {
    for (const dir of STANDARD_DIRS) {
      const stdDir = path.join(v1Dir, dir);
      if (!fs.existsSync(stdDir)) {
        fs.mkdirSync(stdDir, { recursive: true });
        // Add .gitkeep so empty dirs are tracked
        fs.writeFileSync(path.join(stdDir, '.gitkeep'), '');
      }
    }
  }
}

// Cleanup empty directories
if (!DRY_RUN) {
  for (const client of clients) {
    removeEmptyDirs(path.join(CLIENTS_DIR, client));
  }
}

console.log(`\nDone: ${moved} files moved, ${removed} files removed${DRY_RUN ? ' (DRY RUN)' : ''}`);
