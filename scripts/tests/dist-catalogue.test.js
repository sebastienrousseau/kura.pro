import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CATALOGUE_PATH = path.join(process.cwd(), 'scripts/dist/packages-catalogue.json');

describe('packages-catalogue.json (structural)', () => {
  const cat = JSON.parse(fs.readFileSync(CATALOGUE_PATH, 'utf-8'));

  it('declares at least one category and the featured slug exists in packages', () => {
    expect(cat.categories.length).toBeGreaterThan(0);
    expect(cat.packages.find((p) => p.slug === cat.featured)).toBeDefined();
  });

  it('every package has a unique slug', () => {
    const slugs = cat.packages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('every package references a real category', () => {
    const ids = new Set(cat.categories.map((c) => c.id));
    for (const pkg of cat.packages) {
      expect(ids.has(pkg.category), `package ${pkg.slug} has unknown category ${pkg.category}`).toBe(true);
    }
  });

  it('every package declares at least one registry of a known type', () => {
    const knownTypes = new Set(['npm', 'crates.io', 'pypi', 'github-releases']);
    for (const pkg of cat.packages) {
      expect(pkg.registries?.length, `package ${pkg.slug} has no registries`).toBeGreaterThan(0);
      for (const r of pkg.registries) {
        expect(knownTypes.has(r.type), `package ${pkg.slug} has unknown registry type ${r.type}`).toBe(true);
        if (r.type === 'github-releases') expect(r.repo).toBeDefined();
        else expect(r.name).toBeDefined();
      }
    }
  });

  it('every package declares at least one install command', () => {
    for (const pkg of cat.packages) {
      expect(pkg.install && Object.keys(pkg.install).length > 0,
        `package ${pkg.slug} has no install commands`).toBe(true);
    }
  });

  it('every package has a tagline that fits on one line', () => {
    for (const pkg of cat.packages) {
      expect(typeof pkg.tagline).toBe('string');
      expect(pkg.tagline.length, `${pkg.slug} tagline too long`).toBeLessThanOrEqual(160);
    }
  });
});

describe('generate-dist-catalogue.mjs', () => {
  let tmpDir;
  let tmpSpec;
  let tmpOut;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-catalogue-'));
    tmpSpec = path.join(tmpDir, 'catalogue.json');
    tmpOut = path.join(tmpDir, 'out.json');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('augments packages with the latest version per registry', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'demo',
      categories: [{ id: 'cli', name: 'CLI', tagline: 't' }],
      packages: [
        {
          name: 'Demo',
          slug: 'demo',
          category: 'cli',
          tagline: 'Just a demo',
          registries: [{ type: 'npm', name: 'demo' }],
          install: { npm: 'npm install demo' },
        },
      ],
    }));

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '4.2.1' }, description: 'x' }), {
        headers: { 'content-type': 'application/json' },
      })
    );

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);

    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));
    expect(out.packages[0].primary_version).toBe('4.2.1');
    expect(out.packages[0].primary_registry).toBe('npm');
    expect(out.packages[0].registries[0].page).toContain('npmjs.com/package/demo');
  });

  it('routes each registry type to the right endpoint + response parser', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'a',
      categories: [{ id: 'cli', name: 'CLI', tagline: 't' }],
      packages: [
        { name: 'A', slug: 'a', category: 'cli', tagline: '.',
          registries: [{ type: 'crates.io', name: 'a' }], install: { cargo: 'x' } },
        { name: 'B', slug: 'b', category: 'cli', tagline: '.',
          registries: [{ type: 'pypi', name: 'b' }], install: { pip: 'x' } },
        { name: 'C', slug: 'c', category: 'cli', tagline: '.',
          registries: [{ type: 'github-releases', repo: 'me/c' }], install: { macos: 'x' } },
      ],
    }));

    globalThis.fetch = vi.fn().mockImplementation((url) => {
      const u = String(url);
      let body;
      if (u.includes('crates.io')) body = { crate: { newest_version: '1.0.0' } };
      else if (u.includes('pypi.org')) body = { info: { version: '2.0.0' } };
      else if (u.includes('api.github.com')) body = { tag_name: 'v3.0.0' };
      else body = {};
      return Promise.resolve(new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }));
    });

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);
    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));

    expect(out.packages.find((p) => p.slug === 'a').primary_version).toBe('1.0.0');
    expect(out.packages.find((p) => p.slug === 'b').primary_version).toBe('2.0.0');
    // github-releases versions are stripped of the leading 'v' for parity.
    expect(out.packages.find((p) => p.slug === 'c').primary_version).toBe('3.0.0');
  });

  it('records primary_version=null when no registry returns a hit', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'missing',
      categories: [{ id: 'cli', name: 'CLI', tagline: 't' }],
      packages: [
        { name: 'Missing', slug: 'missing', category: 'cli', tagline: '.',
          registries: [{ type: 'npm', name: 'missing-pkg-404' }], install: { npm: 'x' } },
      ],
    }));

    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);
    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));
    expect(out.packages[0].primary_version).toBeNull();
    expect(out.packages[0].registries[0].ok).toBe(false);
    expect(out.packages[0].registries[0].error).toBe('HTTP 404');
  });

  it('records error text when fetch throws (network failure)', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'flaky',
      categories: [{ id: 'cli', name: 'CLI', tagline: 't' }],
      packages: [
        { name: 'Flaky', slug: 'flaky', category: 'cli', tagline: '.',
          registries: [{ type: 'crates.io', name: 'flaky' }], install: { cargo: 'x' } },
      ],
    }));

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('socket hang up'));

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);
    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));
    expect(out.packages[0].registries[0].error).toBe('socket hang up');
  });

  it('prefers npm over other registries when both are present', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'multi',
      categories: [{ id: 'cli', name: 'CLI', tagline: 't' }],
      packages: [
        { name: 'Multi', slug: 'multi', category: 'cli', tagline: '.',
          registries: [
            { type: 'crates.io', name: 'multi' },
            { type: 'npm', name: 'multi' },
          ],
          install: { cargo: 'x', npm: 'x' },
        },
      ],
    }));

    globalThis.fetch = vi.fn().mockImplementation((url) => {
      const u = String(url);
      const body = u.includes('crates.io')
        ? { crate: { newest_version: '0.1.0' } }
        : { 'dist-tags': { latest: '9.9.9' } };
      return Promise.resolve(new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      }));
    });

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);
    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));
    expect(out.packages[0].primary_registry).toBe('npm');
    expect(out.packages[0].primary_version).toBe('9.9.9');
  });

  it('emits the categories and featured slug verbatim from the input', async () => {
    fs.writeFileSync(tmpSpec, JSON.stringify({
      featured: 'foo',
      categories: [
        { id: 'one', name: 'One', tagline: 'first' },
        { id: 'two', name: 'Two', tagline: 'second' },
      ],
      packages: [{ name: 'Foo', slug: 'foo', category: 'one', tagline: '.',
        registries: [{ type: 'npm', name: 'foo' }], install: { npm: 'x' } }],
    }));

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ 'dist-tags': { latest: '0.0.1' } }),
        { headers: { 'content-type': 'application/json' } })
    );

    const { main } = await import('../dist/generate-dist-catalogue.mjs');
    await main(tmpSpec, tmpOut);
    const out = JSON.parse(fs.readFileSync(tmpOut, 'utf-8'));
    expect(out.featured).toBe('foo');
    expect(out.categories).toHaveLength(2);
    expect(out.categories[0].id).toBe('one');
    expect(out.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
