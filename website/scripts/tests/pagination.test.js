/**
 * Pagination contract — verifies the paginated assets endpoint honors all pagination params.
 *
 * Tests: defaults, page 2, per_page boundaries, clamping, empty pages, Pagination object shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clearManifestCache } from '../../../functions/api/_shared.js';

const assetsModule = await import('../../../functions/api/assets.js');

// Generate 15 manifest entries for pagination testing
const manifestData = Array.from({ length: 15 }, (_, i) => ({
  name: `asset-${String(i).padStart(2, '0')}.svg`,
  path: `project/v1/logos/asset-${String(i).padStart(2, '0')}.svg`,
  project: 'project',
  category: 'logos',
  format: 'svg',
  size: 1000 + i * 100,
}));

function makeCtx(url) {
  return {
    request: {
      url: `https://cloudcdn.pro${url}`,
      headers: new Headers({ AccessKey: 'test-key' }),
    },
    env: {
      STORAGE_KEY: 'test-key',
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifestData), { status: 200 })),
      },
    },
  };
}

beforeEach(() => clearManifestCache());

describe('Pagination — Default page=1, per_page=50', () => {
  it('returns page 1 with default per_page when no params', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.Pagination.Page).toBe(1);
    expect(json.Pagination.PerPage).toBe(50);
    // All 15 items fit in default page size
    expect(json.Data).toHaveLength(15);
  });
});

describe('Pagination — Page 2 returns different items', () => {
  it('page 2 with per_page=5 returns items 6-10', async () => {
    const page1Res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=1'));
    const page1 = await page1Res.json();

    clearManifestCache();
    const page2Res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=2'));
    const page2 = await page2Res.json();

    expect(page2.Pagination.Page).toBe(2);
    expect(page2.Data).toHaveLength(5);
    // Items should be different between pages
    const page1Names = page1.Data.map(d => d.name);
    const page2Names = page2.Data.map(d => d.name);
    expect(page1Names).not.toEqual(page2Names);
  });
});

describe('Pagination — per_page=1 returns 1 item', () => {
  it('returns exactly 1 item', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=1'));
    const json = await res.json();
    expect(json.Data).toHaveLength(1);
    expect(json.Pagination.PerPage).toBe(1);
    expect(json.Pagination.TotalPages).toBe(15);
  });
});

describe('Pagination — per_page=200 accepted', () => {
  it('accepts 200 as per_page', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=200'));
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(200);
    expect(json.Data).toHaveLength(15); // only 15 items total
  });
});

describe('Pagination — per_page=999 clamped to 200', () => {
  it('clamps to MAX_PER_PAGE of 200', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=999'));
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(200);
  });
});

describe('Pagination — Page beyond total returns empty Data', () => {
  it('page 100 returns empty Data array', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=100'));
    const json = await res.json();
    expect(json.Data).toEqual([]);
    expect(json.Pagination.Page).toBe(100);
    expect(json.Pagination.TotalItems).toBe(15);
  });
});

describe('Pagination — Pagination object has Page, PerPage, TotalItems, TotalPages', () => {
  it('Pagination object shape is correct', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=1'));
    const json = await res.json();
    expect(json.Pagination).toHaveProperty('Page');
    expect(json.Pagination).toHaveProperty('PerPage');
    expect(json.Pagination).toHaveProperty('TotalItems');
    expect(json.Pagination).toHaveProperty('TotalPages');
    expect(json.Pagination.Page).toBe(1);
    expect(json.Pagination.PerPage).toBe(5);
    expect(json.Pagination.TotalItems).toBe(15);
    expect(json.Pagination.TotalPages).toBe(3);
  });

  it('TotalPages is calculated correctly for various per_page values', async () => {
    // per_page=7 with 15 items should give 3 total pages (ceil(15/7)=3)
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=7'));
    const json = await res.json();
    expect(json.Pagination.TotalPages).toBe(3);
  });

  it('TotalPages is at least 1 even when no items match', async () => {
    // Filter that matches nothing
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?project=nonexistent'));
    const json = await res.json();
    expect(json.Pagination.TotalItems).toBe(0);
    expect(json.Pagination.TotalPages).toBe(1);
  });
});

describe('Pagination — Extended boundary tests', () => {
  it('per_page=0 clamped to 1', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=0'));
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(1);
    expect(json.Data).toHaveLength(1);
  });

  it('negative per_page clamped to 1', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=-10'));
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(1);
  });

  it('negative page clamped to 1', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?page=-5'));
    const json = await res.json();
    expect(json.Pagination.Page).toBe(1);
  });

  it('page=0 clamped to 1', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?page=0'));
    const json = await res.json();
    expect(json.Pagination.Page).toBe(1);
  });

  it('non-numeric page is handled gracefully', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?page=abc'));
    expect(res.status).toBe(200);
    const json = await res.json();
    // Should not crash, page may be NaN or default
    expect(json).toHaveProperty('Pagination');
  });

  it('non-numeric per_page is handled gracefully', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=abc'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('Pagination');
  });

  it('last page has correct number of items', async () => {
    // 15 items with per_page=4: page 4 should have 3 items (15 - 4*3 = 3)
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=4&page=4'));
    const json = await res.json();
    expect(json.Data).toHaveLength(3);
    expect(json.Pagination.TotalPages).toBe(4);
  });

  it('first page with per_page=15 returns all items', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=15'));
    const json = await res.json();
    expect(json.Data).toHaveLength(15);
    expect(json.Pagination.TotalPages).toBe(1);
  });

  it('per_page larger than total returns all items in one page', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=100'));
    const json = await res.json();
    expect(json.Data).toHaveLength(15);
    expect(json.Pagination.TotalPages).toBe(1);
    expect(json.Pagination.Page).toBe(1);
  });

  it('Pagination.TotalItems is consistent across pages', async () => {
    const p1 = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=1'));
    const p1json = await p1.json();

    clearManifestCache();
    const p2 = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5&page=2'));
    const p2json = await p2.json();

    expect(p1json.Pagination.TotalItems).toBe(p2json.Pagination.TotalItems);
    expect(p1json.Pagination.TotalPages).toBe(p2json.Pagination.TotalPages);
  });

  it('float page is parsed to integer', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?page=2.7'));
    const json = await res.json();
    expect(json.Pagination.Page).toBe(2);
  });

  it('float per_page is parsed to integer', async () => {
    const res = await assetsModule.onRequestGet(makeCtx('/api/assets?per_page=5.9'));
    const json = await res.json();
    expect(json.Pagination.PerPage).toBe(5);
  });
});
