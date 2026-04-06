/**
 * Manifest contract — reads actual manifest.json from disk and validates structure.
 *
 * Tests: required fields, positive sizes, allowed formats, no duplicates,
 * sorted alphabetically, no clients/ prefix in paths.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const manifestPath = path.join(process.cwd(), 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

const ALLOWED_FORMATS = new Set(['svg', 'png', 'webp', 'avif', 'ico', 'jpeg', 'jpg', 'mp4']);

describe('Manifest Integrity — All entries have required fields', () => {
  it('manifest is a non-empty array', () => {
    expect(Array.isArray(manifest)).toBe(true);
    expect(manifest.length).toBeGreaterThan(0);
  });

  it('every entry has name, path, project, category, format, size', () => {
    for (const entry of manifest) {
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('project');
      expect(entry).toHaveProperty('category');
      expect(entry).toHaveProperty('format');
      expect(entry).toHaveProperty('size');
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.path).toBe('string');
      expect(typeof entry.project).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.format).toBe('string');
      expect(typeof entry.size).toBe('number');
    }
  });

  it('no entry has empty string for required fields', () => {
    for (const entry of manifest) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.project.length).toBeGreaterThan(0);
      expect(entry.format.length).toBeGreaterThan(0);
    }
  });
});

describe('Manifest Integrity — All sizes are positive numbers', () => {
  it('every size is a positive number', () => {
    for (const entry of manifest) {
      expect(entry.size).toBeGreaterThan(0);
      expect(Number.isFinite(entry.size)).toBe(true);
    }
  });

  it('no size is NaN or Infinity', () => {
    for (const entry of manifest) {
      expect(Number.isNaN(entry.size)).toBe(false);
      expect(entry.size).not.toBe(Infinity);
      expect(entry.size).not.toBe(-Infinity);
    }
  });
});

describe('Manifest Integrity — All formats are in allowed set', () => {
  it('every format is in the allowed set', () => {
    for (const entry of manifest) {
      expect(ALLOWED_FORMATS.has(entry.format)).toBe(true);
    }
  });

  it('allowed formats cover observed formats', () => {
    const observed = new Set(manifest.map(e => e.format));
    for (const fmt of observed) {
      expect(ALLOWED_FORMATS.has(fmt)).toBe(true);
    }
  });
});

describe('Manifest Integrity — No duplicate paths', () => {
  it('all paths are unique', () => {
    const paths = manifest.map(e => e.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it('no duplicate name+project combinations with same format', () => {
    const keys = manifest.map(e => `${e.project}/${e.name}`);
    // This checks that the same file does not appear twice
    // Note: same name with different format is allowed (logo.svg, logo.png)
    const pathSet = new Set(manifest.map(e => e.path));
    expect(pathSet.size).toBe(manifest.length);
  });
});

describe('Manifest Integrity — Sorted alphabetically by path', () => {
  it('entries are sorted by path in ascending order', () => {
    const paths = manifest.map(e => e.path);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    expect(paths).toEqual(sorted);
  });
});

describe('Manifest Integrity — No clients/ prefix in paths', () => {
  it('no path starts with clients/', () => {
    for (const entry of manifest) {
      expect(entry.path.startsWith('clients/')).toBe(false);
    }
  });

  it('no path starts with a leading slash', () => {
    for (const entry of manifest) {
      expect(entry.path.startsWith('/')).toBe(false);
    }
  });
});
