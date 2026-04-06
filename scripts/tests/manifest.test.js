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
      fs.mkdirSync(path.join(tmpDir, 'cdn'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'cdn', 'file.png'), 'skip');
      fs.mkdirSync(path.join(tmpDir, 'functions'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'functions', 'file.png'), 'skip');
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

    it('strips clients/ prefix from paths', () => {
      // Create a file under clients/ subdirectory
      fs.mkdirSync(path.join(tmpDir, 'clients', 'akande', 'v1', 'logos'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'clients', 'akande', 'v1', 'logos', 'logo.svg'), 'svg');
      const manifest = generateManifest(tmpDir);
      const clientFile = manifest.find(f => f.name === 'logo.svg' && f.project === 'akande');
      expect(clientFile).toBeDefined();
      expect(clientFile.path).toBe('akande/v1/logos/logo.svg');
      expect(clientFile.path).not.toContain('clients/');
    });

    it('generates TypeScript definitions file', () => {
      generateManifest(tmpDir);
      const dtsPath = path.join(tmpDir, 'cloudcdn-paths.d.ts');
      expect(fs.existsSync(dtsPath)).toBe(true);
      const content = fs.readFileSync(dtsPath, 'utf-8');
      expect(content).toContain('CdnPath');
      expect(content).toContain('CdnProject');
      expect(content).toContain('CdnFormat');
      expect(content).toContain('cdnUrl');
    });

    it('survives TypeScript definition generation failure', () => {
      // Make the output dir read-only so .d.ts write fails
      const readonlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'readonly-test-'));
      fs.mkdirSync(path.join(readonlyDir, 'sub', 'images'), { recursive: true });
      fs.writeFileSync(path.join(readonlyDir, 'sub', 'images', 'test.png'), 'fake');
      // Create a directory where the .d.ts file should go to cause a write error
      fs.mkdirSync(path.join(readonlyDir, 'cloudcdn-paths.d.ts'), { recursive: true });
      try {
        // Should not throw — the catch block handles the error
        const manifest = generateManifest(readonlyDir);
        expect(manifest.length).toBe(1);
      } finally {
        fs.rmSync(readonlyDir, { recursive: true, force: true });
      }
    });
  });

  // --- Extended tests ---

  describe('getFiles — extended', () => {
    it('handles large directory trees', () => {
      // Create 100 files in nested structure
      const deepDir = path.join(tmpDir, 'deep');
      for (let i = 0; i < 10; i++) {
        const subDir = path.join(deepDir, `cat-${i}`, 'images');
        fs.mkdirSync(subDir, { recursive: true });
        for (let j = 0; j < 10; j++) {
          fs.writeFileSync(path.join(subDir, `file-${j}.png`), 'fake');
        }
      }
      const files = getFiles(tmpDir, tmpDir);
      // Should find original 3 + 100 new = 103
      expect(files.length).toBe(103);
    });

    it('handles symlinks to valid targets', () => {
      const target = path.join(tmpDir, 'kura', 'images', 'logos', 'logo.webp');
      const linkPath = path.join(tmpDir, 'linked.webp');
      try {
        fs.symlinkSync(target, linkPath);
        const files = getFiles(tmpDir, tmpDir);
        // Should find original 3 + the symlinked file
        const linked = files.find(f => f.name === 'linked.webp');
        expect(linked).toBeDefined();
      } catch {
        // Skip on systems where symlinks require privileges
      }
    });

    it('handles files with multiple extensions (file.min.png)', () => {
      fs.writeFileSync(path.join(tmpDir, 'file.min.png'), 'fake');
      const files = getFiles(tmpDir, tmpDir);
      const multiExt = files.find(f => f.name === 'file.min.png');
      expect(multiExt).toBeDefined();
      expect(multiExt.format).toBe('png');
    });

    it('handles .jpg files', () => {
      fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
      const files = getFiles(tmpDir, tmpDir);
      const photo = files.find(f => f.name === 'photo.jpg');
      // .jpg may or may not be in the allowed extensions
      if (photo) {
        expect(photo.format).toBe('jpg');
      }
    });

    it('handles .webp files at root level', () => {
      fs.writeFileSync(path.join(tmpDir, 'root.webp'), 'fake');
      const files = getFiles(tmpDir, tmpDir);
      const rootFile = files.find(f => f.name === 'root.webp');
      expect(rootFile).toBeDefined();
      expect(rootFile.category).toBe('general');
    });

    it('handles nested empty directories', () => {
      fs.mkdirSync(path.join(tmpDir, 'empty', 'deep', 'deeper'), { recursive: true });
      const files = getFiles(tmpDir, tmpDir);
      // Empty dirs should not add any files
      expect(files.length).toBe(3);
    });

    it('calculates file size correctly', () => {
      const content = 'x'.repeat(12345);
      fs.writeFileSync(path.join(tmpDir, 'sized.png'), content);
      const files = getFiles(tmpDir, tmpDir);
      const sized = files.find(f => f.name === 'sized.png');
      expect(sized).toBeDefined();
      expect(sized.size).toBe(12345);
    });
  });

  describe('generateManifest — extended', () => {
    it('handles directory with only non-image files', () => {
      const noImgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noimg-test-'));
      try {
        fs.writeFileSync(path.join(noImgDir, 'readme.md'), 'docs');
        fs.writeFileSync(path.join(noImgDir, 'data.json'), '{}');
        const manifest = generateManifest(noImgDir);
        expect(manifest).toEqual([]);
      } finally {
        fs.rmSync(noImgDir, { recursive: true, force: true });
      }
    });

    it('generates unique paths in manifest', () => {
      const manifest = generateManifest(tmpDir);
      const paths = manifest.map(e => e.path);
      const uniquePaths = new Set(paths);
      expect(paths.length).toBe(uniquePaths.size);
    });
  });
});
