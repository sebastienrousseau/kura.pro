import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getFiles, generateManifest } from '../generate-manifest.mjs';

describe('generate-manifest', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
    fs.mkdirSync(path.join(tmpDir, 'kura', 'images', 'logos'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'kura', 'images', 'icons'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'kura', 'images', 'logos', 'logo.webp'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'kura', 'images', 'logos', 'logo.png'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'kura', 'images', 'icons', 'icon.svg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'kura', 'images', 'readme.txt'), 'skip me');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getFiles', () => {
    it('finds image files recursively', () => {
      const files = getFiles(tmpDir, tmpDir);
      expect(files.length).toBe(3);
      const formats = files.map((f) => f.format);
      expect(formats).toContain('webp');
      expect(formats).toContain('png');
      expect(formats).toContain('svg');
    });

    it('skips non-image files', () => {
      const files = getFiles(tmpDir, tmpDir);
      const formats = files.map((f) => f.format);
      expect(formats).not.toContain('txt');
    });

    it('skips directories in SKIP set', () => {
      fs.mkdirSync(path.join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'node_modules', 'pkg', 'file.png'), 'skip');
      fs.mkdirSync(path.join(tmpDir, '.git', 'objects'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.git', 'objects', 'file.png'), 'skip');
      fs.mkdirSync(path.join(tmpDir, 'dashboard'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'dashboard', 'file.png'), 'skip');
      fs.mkdirSync(path.join(tmpDir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'scripts', 'file.png'), 'skip');
      fs.mkdirSync(path.join(tmpDir, '.github'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.github', 'file.png'), 'skip');

      const files = getFiles(tmpDir, tmpDir);
      // Should still only find the original 3 files
      expect(files.length).toBe(3);
    });

    it('returns correct structure for each entry', () => {
      const files = getFiles(tmpDir, tmpDir);
      for (const entry of files) {
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('path');
        expect(entry).toHaveProperty('project');
        expect(entry).toHaveProperty('category');
        expect(entry).toHaveProperty('format');
        expect(entry).toHaveProperty('size');
        expect(typeof entry.size).toBe('number');
      }
    });

    it('returns empty array for unreadable directory', () => {
      const files = getFiles('/nonexistent-dir-abc123', '/nonexistent-dir-abc123');
      expect(files).toEqual([]);
    });

    it('sets category to general when path depth < 3', () => {
      // File at root level: tmpDir/file.ico
      fs.writeFileSync(path.join(tmpDir, 'file.ico'), 'fake');
      const files = getFiles(tmpDir, tmpDir);
      const rootFile = files.find((f) => f.name === 'file.ico');
      expect(rootFile.category).toBe('general');
    });

    it('skips unreadable files (broken symlink)', () => {
      // Create a broken symlink that fs.readdirSync will list but fs.statSync will throw on
      fs.symlinkSync('/nonexistent-target-xyz', path.join(tmpDir, 'broken.png'));
      const files = getFiles(tmpDir, tmpDir);
      // Should still find the original 3 files, ignoring the broken symlink
      expect(files.length).toBe(3);
    });

    it('handles .ico and .avif extensions', () => {
      fs.writeFileSync(path.join(tmpDir, 'favicon.ico'), 'ico');
      fs.writeFileSync(path.join(tmpDir, 'photo.avif'), 'avif');
      const files = getFiles(tmpDir, tmpDir);
      const formats = files.map((f) => f.format);
      expect(formats).toContain('ico');
      expect(formats).toContain('avif');
    });
  });

  describe('generateManifest', () => {
    it('generates manifest.json sorted by path', () => {
      const manifest = generateManifest(tmpDir);
      expect(Array.isArray(manifest)).toBe(true);
      expect(manifest.length).toBe(3);

      const paths = manifest.map((e) => e.path);
      const sorted = [...paths].sort();
      expect(paths).toEqual(sorted);

      // File should exist
      const content = JSON.parse(fs.readFileSync(path.join(tmpDir, 'manifest.json'), 'utf-8'));
      expect(content).toEqual(manifest);
    });

    it('handles empty directory', () => {
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-test-'));
      try {
        const manifest = generateManifest(emptyDir);
        expect(manifest).toEqual([]);
      } finally {
        fs.rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
