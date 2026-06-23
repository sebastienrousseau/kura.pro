/**
 * Unit tests for the pure helpers in
 * scripts/dist/generate-responsive-stocks.mjs. The sharp IO + CLI
 * main() are intentionally not unit-tested (covered by the manual
 * `npm run dist:responsive:check` rehearsal and CI gate).
 */
import { describe, it, expect } from 'vitest';

const mod = await import('../../scripts/dist/generate-responsive-stocks.mjs');

describe('isSourceImage', () => {
  it('accepts plain .webp filenames', () => {
    expect(mod.isSourceImage('photo.webp')).toBe(true);
    expect(mod.isSourceImage('markus-spiske-FXFz-sW0uwo.webp')).toBe(true);
    expect(mod.isSourceImage('1781699463498.webp')).toBe(true);
  });

  it('rejects width-variant suffixes (any width in the configured set)', () => {
    expect(mod.isSourceImage('photo-320.webp')).toBe(false);
    expect(mod.isSourceImage('photo-640.webp')).toBe(false);
    expect(mod.isSourceImage('photo-1200.webp')).toBe(false);
    expect(mod.isSourceImage('photo-1920.webp')).toBe(false);
  });

  it('accepts filenames that incidentally end in digits but not a configured width', () => {
    // Year-suffixed names should be processable as sources.
    expect(mod.isSourceImage('annual-report-2026.webp')).toBe(true);
    // A 4-digit suffix that ISN'T in the configured WIDTHS set is fine.
    expect(mod.isSourceImage('image-1234.webp')).toBe(true);
    expect(mod.isSourceImage('image-9999.webp')).toBe(true);
  });

  it('rejects non-.webp files', () => {
    expect(mod.isSourceImage('photo.jpg')).toBe(false);
    expect(mod.isSourceImage('photo.png')).toBe(false);
    expect(mod.isSourceImage('photo')).toBe(false);
  });
});

describe('variantPath', () => {
  it('appends -<width> before the .webp extension', () => {
    expect(mod.variantPath('stocks/images/photo.webp', 320)).toBe('stocks/images/photo-320.webp');
    expect(mod.variantPath('stocks/images/photo.webp', 1920)).toBe('stocks/images/photo-1920.webp');
  });

  it('preserves the directory path', () => {
    expect(mod.variantPath('a/b/c/x.webp', 640)).toBe('a/b/c/x-640.webp');
  });

  it('handles names with multiple dots', () => {
    // basename(extname) strips only the LAST extension — desirable.
    expect(mod.variantPath('stocks/images/foo.v2.webp', 1200)).toBe('stocks/images/foo.v2-1200.webp');
  });
});

describe('missingVariants (against the live stocks/images/ tree)', () => {
  it('returns empty array for a known source whose variants are all present', async () => {
    // The 2026-06-23 PR generated variants for every source. If this
    // test fails the most likely cause is someone added a source image
    // without running `npm run dist:responsive` — which is exactly
    // what the CI gate (`npm run dist:responsive:check`) catches.
    const missing = await mod.missingVariants('stocks/images/7eaven-HkA-V2dw9yA.webp');
    expect(missing).toEqual([]);
  });
});

describe('SOURCE_SETS config', () => {
  it('includes the stocks/images flat scan', () => {
    const stocks = mod.SOURCE_SETS.find((s) => s.name === 'stocks');
    expect(stocks).toBeDefined();
    expect(stocks.baseDir).toBe('stocks/images');
    expect(stocks.recursive).toBe(false);
  });

  it('includes the recursive clients/**/banners scan', () => {
    const banners = mod.SOURCE_SETS.find((s) => s.name === 'client-banners');
    expect(banners.recursive).toBe(true);
    expect(banners.baseDir).toBe('clients');
    expect(banners.matches('clients/x/v1/banners/foo.webp')).toBe(true);
    expect(banners.matches('clients/x/v1/logos/foo.webp')).toBe(false);
    expect(banners.matches('clients/x/v1/banners/foo.svg')).toBe(false);
  });

  it('includes the recursive clients/**/titles scan', () => {
    const titles = mod.SOURCE_SETS.find((s) => s.name === 'client-titles');
    expect(titles.matches('clients/x/v1/titles/hero.webp')).toBe(true);
    expect(titles.matches('clients/x/v1/banners/hero.webp')).toBe(false);
    expect(titles.matches('clients/x/v1/titles/hero.png')).toBe(false);
  });
});

describe('walkSources (recursive walker)', () => {
  it('finds banner webps under the live clients/ tree', async () => {
    const banners = mod.SOURCE_SETS.find((s) => s.name === 'client-banners');
    const found = [];
    for await (const p of mod.walkSources(banners.baseDir, banners.matches)) found.push(p);
    // We committed at least 6 banner webps in PR #106; the count may
    // grow, but should never drop below 6 without an explicit removal.
    expect(found.length).toBeGreaterThanOrEqual(6);
    expect(found.every((p) => /\/banners\//.test(p))).toBe(true);
    expect(found.every((p) => p.endsWith('.webp'))).toBe(true);
  });

  it('skips dotfiles (.DS_Store)', async () => {
    const banners = mod.SOURCE_SETS.find((s) => s.name === 'client-banners');
    const found = [];
    for await (const p of mod.walkSources(banners.baseDir, banners.matches)) found.push(p);
    expect(found.every((p) => !p.includes('/.'))).toBe(true);
  });

  it('returns nothing for a non-existent base directory (silent skip)', async () => {
    const found = [];
    const noop = () => true;
    for await (const p of mod.walkSources('does-not-exist-anywhere', noop)) found.push(p);
    expect(found).toEqual([]);
  });
});
