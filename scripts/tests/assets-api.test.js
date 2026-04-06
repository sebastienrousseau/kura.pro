import { describe, it, expect, vi } from 'vitest';

const assetsModule = await import('../../functions/api/assets.js');
const metadataModule = await import('../../functions/api/assets/metadata.js');

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
  { name: 'banner.svg', path: 'akande/v1/banners/banner.svg', project: 'akande', category: 'banners', format: 'svg', size: 5600 },
  { name: 'icon.png', path: 'shokunin/v1/icons/icon.png', project: 'shokunin', category: 'icons', format: 'png', size: 8800 },
  { name: 'photo.webp', path: 'stocks/images/photo.webp', project: 'stocks', category: 'images', format: 'webp', size: 12000 },
  { name: 'logo.png', path: 'akande/v1/logos/logo.png', project: 'akande', category: 'logos', format: 'png', size: 15000 },
];

function makeCtx(url, options = {}) {
  const h = new Headers();
  if (options.accessKey) h.set('AccessKey', options.accessKey);
  return {
    request: { url: `https://cloudcdn.pro${url}`, headers: h },
    env: {
      STORAGE_KEY: options.storageKey ?? 'test-key',
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })),
      },
    },
  };
}

describe('Assets API — /api/assets', () => {
  it('returns paginated assets', async () => {
    const ctx = makeCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Data).toHaveLength(5);
    expect(json.Pagination.TotalItems).toBe(5);
    expect(json.Pagination.Page).toBe(1);
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('filters by project', async () => {
    const ctx = makeCtx('/api/assets?project=akande', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.every(a => a.project === 'akande')).toBe(true);
    expect(json.Filters.Project).toBe('akande');
  });

  it('filters by format', async () => {
    const ctx = makeCtx('/api/assets?format=svg', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.every(a => a.format === 'svg')).toBe(true);
  });

  it('searches by text query', async () => {
    const ctx = makeCtx('/api/assets?q=logo', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.every(a => a.name.includes('logo') || a.path.includes('logo'))).toBe(true);
  });

  it('paginates correctly', async () => {
    const ctx = makeCtx('/api/assets?per_page=2&page=2', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.length).toBeLessThanOrEqual(2);
    expect(json.Pagination.Page).toBe(2);
    expect(json.Pagination.TotalPages).toBe(3);
  });

  it('sorts by size descending', async () => {
    const ctx = makeCtx('/api/assets?sort=size&order=desc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].size).toBeGreaterThanOrEqual(json.Data[i].size);
    }
  });

  it('returns 401 without auth', async () => {
    const ctx = makeCtx('/api/assets');
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(401);
  });
});

describe('Assets API — /api/assets/metadata', () => {
  it('returns metadata for an asset', async () => {
    const ctx = makeCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Path).toBe('akande/v1/logos/logo.svg');
    expect(json.Name).toBe('logo.svg');
    expect(json.Format).toBe('svg');
    expect(json.SizeHuman).toContain('KB');
    expect(json.CdnUrl).toContain('cloudcdn.pro');
    expect(json.TransformUrl).toContain('/api/transform');
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns 400 without path param', async () => {
    const ctx = makeCtx('/api/assets/metadata', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown path', async () => {
    const ctx = makeCtx('/api/assets/metadata?path=nonexistent/file.png', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(404);
  });

  it('discovers available formats', async () => {
    const ctx = makeCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    // logo.svg and logo.png both exist for akande/v1/logos/logo
    expect(json.AvailableFormats).toContain('svg');
    expect(json.AvailableFormats).toContain('png');
  });
});

// --- Extended tests ---

describe('Assets API — sorting', () => {
  it('sorts by name ascending', async () => {
    const ctx = makeCtx('/api/assets?sort=name&order=asc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].name.localeCompare(json.Data[i].name)).toBeLessThanOrEqual(0);
    }
  });

  it('sorts by name descending', async () => {
    const ctx = makeCtx('/api/assets?sort=name&order=desc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].name.localeCompare(json.Data[i].name)).toBeGreaterThanOrEqual(0);
    }
  });

  it('sorts by size ascending', async () => {
    const ctx = makeCtx('/api/assets?sort=size&order=asc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].size).toBeLessThanOrEqual(json.Data[i].size);
    }
  });

  it('sorts by project ascending', async () => {
    const ctx = makeCtx('/api/assets?sort=project&order=asc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].project.localeCompare(json.Data[i].project)).toBeLessThanOrEqual(0);
    }
  });
});

describe('Assets API — combined filters', () => {
  it('filters by project and format combined', async () => {
    const ctx = makeCtx('/api/assets?project=akande&format=svg', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.every(a => a.project === 'akande' && a.format === 'svg')).toBe(true);
  });

  it('search is case insensitive', async () => {
    const ctx = makeCtx('/api/assets?q=LOGO', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.length).toBeGreaterThan(0);
    expect(json.Data.every(a => a.name.toLowerCase().includes('logo') || a.path.toLowerCase().includes('logo'))).toBe(true);
  });

  it('returns empty data for non-matching format filter', async () => {
    const ctx = makeCtx('/api/assets?format=gif', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data).toHaveLength(0);
  });
});

describe('Assets API — pagination edge cases', () => {
  it('page beyond total returns empty data', async () => {
    const ctx = makeCtx('/api/assets?page=999', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data).toHaveLength(0);
  });

  it('per_page=1 returns exactly 1 item', async () => {
    const ctx = makeCtx('/api/assets?per_page=1', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data).toHaveLength(1);
    expect(json.Pagination.TotalPages).toBe(5);
  });
});

describe('Assets API — response headers', () => {
  it('GET has Content-Type JSON', async () => {
    const ctx = makeCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('GET has CORS header', async () => {
    const ctx = makeCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('401 has CORS header', async () => {
    const ctx = makeCtx('/api/assets');
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('OPTIONS returns 204', async () => {
    const res = await assetsModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('response includes DateFetched', async () => {
    const ctx = makeCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.DateFetched).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('response includes Filters object', async () => {
    const ctx = makeCtx('/api/assets?project=akande&format=svg&q=logo', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Filters).toBeDefined();
    expect(json.Filters.Project).toBe('akande');
    expect(json.Filters.Format).toBe('svg');
  });

  it('Data items have required fields', async () => {
    const ctx = makeCtx('/api/assets', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (const item of json.Data) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('path');
      expect(item).toHaveProperty('project');
      expect(item).toHaveProperty('format');
      expect(item).toHaveProperty('size');
    }
  });
});

describe('Assets API — edge cases', () => {
  it('filter by category', async () => {
    const ctx = makeCtx('/api/assets?category=logos', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    for (const item of json.Data) {
      expect(item.category).toBe('logos');
    }
  });

  it('combined sort and filter', async () => {
    const ctx = makeCtx('/api/assets?project=akande&sort=size&order=asc', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Data.every(a => a.project === 'akande')).toBe(true);
    for (let i = 1; i < json.Data.length; i++) {
      expect(json.Data[i - 1].size).toBeLessThanOrEqual(json.Data[i].size);
    }
  });

  it('page 1 and page 2 have different items with per_page=2', async () => {
    const ctx1 = makeCtx('/api/assets?per_page=2&page=1', { accessKey: 'test-key' });
    const res1 = await assetsModule.onRequestGet(ctx1);
    const json1 = await res1.json();
    const names1 = json1.Data.map(d => d.name);

    const ctx2 = makeCtx('/api/assets?per_page=2&page=2', { accessKey: 'test-key' });
    const res2 = await assetsModule.onRequestGet(ctx2);
    const json2 = await res2.json();
    const names2 = json2.Data.map(d => d.name);

    expect(names1).not.toEqual(names2);
  });

  it('search query is case insensitive', async () => {
    const ctx1 = makeCtx('/api/assets?q=LOGO', { accessKey: 'test-key' });
    const res1 = await assetsModule.onRequestGet(ctx1);
    const json1 = await res1.json();

    const ctx2 = makeCtx('/api/assets?q=logo', { accessKey: 'test-key' });
    const res2 = await assetsModule.onRequestGet(ctx2);
    const json2 = await res2.json();

    expect(json1.Data.length).toBe(json2.Data.length);
  });

  it('invalid sort field uses default', async () => {
    const ctx = makeCtx('/api/assets?sort=invalid', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });

  it('invalid order field uses default', async () => {
    const ctx = makeCtx('/api/assets?order=invalid', { accessKey: 'test-key' });
    const res = await assetsModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
  });
});

describe('Metadata API — extended', () => {
  it('metadata for webp asset', async () => {
    const ctx = makeCtx('/api/assets/metadata?path=stocks/images/photo.webp', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Format).toBe('webp');
  });

  it('metadata includes project info', async () => {
    const ctx = makeCtx('/api/assets/metadata?path=akande/v1/logos/logo.svg', { accessKey: 'test-key' });
    const res = await metadataModule.onRequestGet(ctx);
    const json = await res.json();
    expect(json.Project).toBe('akande');
    expect(json.Category).toBe('logos');
  });

  it('OPTIONS returns 204', async () => {
    const res = await metadataModule.onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
