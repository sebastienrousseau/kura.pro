import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import sharp from 'sharp';
import { formatBytes, walk, main } from '../convert.mjs';

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(2 * 1048576)).toBe('2.0 MB');
  });

  it('formats exact boundary (1024)', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('formats exact boundary (1048576)', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });
});

describe('walk', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-test-'));
    // Create a real PNG using sharp
    await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
      .png()
      .toFile(path.join(tmpDir, 'test.png'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('converts PNG to WebP and AVIF', async () => {
    const stats = await walk(tmpDir, tmpDir);
    expect(stats.converted).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, 'test.webp'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'test.avif'))).toBe(true);
  });

  it('skips already converted files', async () => {
    // First run
    await walk(tmpDir, tmpDir);
    // Second run — should skip existing files
    const stats = await walk(tmpDir, tmpDir, { converted: 0, savedBytes: 0 });
    // Still increments converted (counts the PNG), but doesn't re-create files
    expect(stats.converted).toBe(1);
  });

  it('recurses into subdirectories', async () => {
    const subDir = path.join(tmpDir, 'sub');
    fs.mkdirSync(subDir);
    await sharp({ create: { width: 5, height: 5, channels: 3, background: 'blue' } })
      .png()
      .toFile(path.join(subDir, 'nested.png'));

    const stats = await walk(tmpDir, tmpDir);
    expect(stats.converted).toBe(2);
    expect(fs.existsSync(path.join(subDir, 'nested.webp'))).toBe(true);
  });

  it('skips non-PNG files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'not a png');
    fs.writeFileSync(path.join(tmpDir, 'file.jpg'), 'fake jpg');
    const stats = await walk(tmpDir, tmpDir);
    expect(stats.converted).toBe(1); // Only test.png
  });

  it('handles sharp conversion error gracefully', async () => {
    // Create a "PNG" that isn't actually valid image data
    fs.writeFileSync(path.join(tmpDir, 'bad.png'), 'not-actually-png-data');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stats = await walk(tmpDir, tmpDir);
    // test.png should succeed, bad.png should fail gracefully
    expect(stats.converted).toBeGreaterThanOrEqual(1);
    consoleSpy.mockRestore();
  });
});

describe('main', () => {
  const originalExit = process.exit;

  beforeEach(() => {
    process.exit = vi.fn((code) => { throw new Error(`process.exit(${code})`); });
  });

  afterEach(() => {
    process.exit = originalExit;
  });

  it('exits when no directory argument', async () => {
    await expect(main(undefined)).rejects.toThrow('process.exit(1)');
  });

  it('exits when directory does not exist', async () => {
    await expect(main('/nonexistent-dir-xyz')).rejects.toThrow('process.exit(1)');
  });

  it('converts files in a valid directory', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-main-'));
    await sharp({ create: { width: 5, height: 5, channels: 3, background: 'green' } })
      .png()
      .toFile(path.join(tmpDir, 'img.png'));

    try {
      const stats = await main(tmpDir);
      expect(stats.converted).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
