/**
 * Streaming JSON contract — verifies streamJsonArray from _shared.js.
 *
 * Tests: empty/1/100/10000 items, envelope preservation, Content-Type, nested objects.
 */
import { describe, it, expect } from 'vitest';
import { streamJsonArray } from '../../functions/api/_shared.js';

describe('Streaming — Empty items produces valid JSON', () => {
  it('returns valid JSON with empty array', async () => {
    const res = streamJsonArray({
      envelope: { Count: 0, Status: 'ok' },
      arrayKey: 'Data',
      items: [],
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const json = JSON.parse(text);
    expect(json.Data).toEqual([]);
    expect(json.Count).toBe(0);
  });
});

describe('Streaming — 1 item produces valid JSON', () => {
  it('single item round-trips correctly', async () => {
    const res = streamJsonArray({
      envelope: { Total: 1 },
      arrayKey: 'Items',
      items: [{ id: 42, name: 'only-one' }],
    });
    const json = await res.json();
    expect(json.Items).toHaveLength(1);
    expect(json.Items[0].id).toBe(42);
    expect(json.Items[0].name).toBe('only-one');
    expect(json.Total).toBe(1);
  });
});

describe('Streaming — 100 items produces valid JSON with all items', () => {
  it('all 100 items present in output', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ index: i, value: `item-${i}` }));
    const res = streamJsonArray({
      envelope: { Size: 100 },
      arrayKey: 'Results',
      items,
    });
    const json = await res.json();
    expect(json.Results).toHaveLength(100);
    expect(json.Results[0].index).toBe(0);
    expect(json.Results[99].index).toBe(99);
    expect(json.Size).toBe(100);
  });
});

describe('Streaming — 10000 items does not crash (memory test)', () => {
  it('handles 10000 items without error', async () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({ i }));
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Data',
      items,
    });
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
    const json = JSON.parse(text);
    expect(json.Data).toHaveLength(10000);
  });
});

describe('Streaming — Envelope fields preserved', () => {
  it('preserves all envelope fields in output', async () => {
    const res = streamJsonArray({
      envelope: {
        Pagination: { Page: 1, PerPage: 50, TotalItems: 3, TotalPages: 1 },
        Filters: { Project: 'akande', Format: 'svg' },
        DateFetched: '2026-01-01T00:00:00.000Z',
      },
      arrayKey: 'Data',
      items: [{ a: 1 }, { a: 2 }, { a: 3 }],
    });
    const json = await res.json();
    expect(json.Pagination.Page).toBe(1);
    expect(json.Pagination.PerPage).toBe(50);
    expect(json.Pagination.TotalItems).toBe(3);
    expect(json.Filters.Project).toBe('akande');
    expect(json.Filters.Format).toBe('svg');
    expect(json.DateFetched).toBe('2026-01-01T00:00:00.000Z');
    expect(json.Data).toHaveLength(3);
  });

  it('empty envelope produces valid JSON', async () => {
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Items',
      items: [{ x: 1 }],
    });
    const json = await res.json();
    expect(json.Items).toHaveLength(1);
  });
});

describe('Streaming — Content-Type is application/json', () => {
  it('response has correct Content-Type', () => {
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Data',
      items: [],
    });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('response has CORS header', () => {
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Data',
      items: [],
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('response has Transfer-Encoding: chunked', () => {
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Data',
      items: [],
    });
    expect(res.headers.get('Transfer-Encoding')).toBe('chunked');
  });
});

describe('Streaming — Nested objects survive serialization', () => {
  it('deeply nested objects round-trip correctly', async () => {
    const nested = {
      level1: {
        level2: {
          level3: { value: 'deep', arr: [1, 2, 3] },
        },
      },
      tags: ['a', 'b'],
    };
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Items',
      items: [nested],
    });
    const json = await res.json();
    expect(json.Items[0].level1.level2.level3.value).toBe('deep');
    expect(json.Items[0].level1.level2.level3.arr).toEqual([1, 2, 3]);
    expect(json.Items[0].tags).toEqual(['a', 'b']);
  });

  it('items with special characters survive', async () => {
    const items = [
      { name: 'test"quotes', path: 'path/with spaces' },
      { name: 'unicode-\u00e9\u00e8\u00ea', emoji: '\ud83d\ude00' },
      { name: 'backslash\\test', newline: 'line1\nline2' },
    ];
    const res = streamJsonArray({
      envelope: {},
      arrayKey: 'Data',
      items,
    });
    const json = await res.json();
    expect(json.Data).toHaveLength(3);
    expect(json.Data[0].name).toBe('test"quotes');
    expect(json.Data[1].name).toContain('\u00e9');
    expect(json.Data[2].name).toBe('backslash\\test');
  });
});

describe('Streaming — Extended edge cases', () => {
  it('handles items with null values', async () => {
    const items = [{ id: 1, name: null, data: undefined }];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items[0].id).toBe(1);
    expect(json.Items[0].name).toBeNull();
  });

  it('handles items with boolean values', async () => {
    const items = [{ active: true, deleted: false }];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items[0].active).toBe(true);
    expect(json.Items[0].deleted).toBe(false);
  });

  it('handles items with number values', async () => {
    const items = [{ int: 42, float: 3.14, negative: -1, zero: 0 }];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items[0].int).toBe(42);
    expect(json.Items[0].float).toBe(3.14);
    expect(json.Items[0].negative).toBe(-1);
    expect(json.Items[0].zero).toBe(0);
  });

  it('handles items that are arrays themselves', async () => {
    const items = [{ tags: ['a', 'b', 'c'] }, { tags: [] }];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items[0].tags).toEqual(['a', 'b', 'c']);
    expect(json.Items[1].tags).toEqual([]);
  });

  it('handles envelope with array values', async () => {
    const res = streamJsonArray({
      envelope: { Tags: ['x', 'y'], Nested: { arr: [1] } },
      arrayKey: 'Items',
      items: [{ id: 1 }],
    });
    const json = await res.json();
    expect(json.Tags).toEqual(['x', 'y']);
    expect(json.Nested.arr).toEqual([1]);
  });

  it('handles large envelope', async () => {
    const envelope = {};
    for (let i = 0; i < 50; i++) {
      envelope[`key${i}`] = `value${i}`;
    }
    const res = streamJsonArray({ envelope, arrayKey: 'Items', items: [{ id: 1 }] });
    const json = await res.json();
    expect(json.key0).toBe('value0');
    expect(json.key49).toBe('value49');
    expect(json.Items).toHaveLength(1);
  });

  it('produces JSON that can be parsed multiple times from text', async () => {
    const res = streamJsonArray({
      envelope: { total: 2 },
      arrayKey: 'Data',
      items: [{ a: 1 }, { a: 2 }],
    });
    const text = await res.text();
    const json1 = JSON.parse(text);
    const json2 = JSON.parse(text);
    expect(json1).toEqual(json2);
  });

  it('handles 5000 items with complex objects', async () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      meta: { tags: ['a', 'b'], created: '2026-01-01' },
    }));
    const res = streamJsonArray({ envelope: { Total: 5000 }, arrayKey: 'Data', items });
    const json = await res.json();
    expect(json.Data).toHaveLength(5000);
    expect(json.Total).toBe(5000);
  });

  it('handles items with empty objects', async () => {
    const items = [{}, {}, {}];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items).toHaveLength(3);
  });

  it('arrayKey appears after envelope keys', async () => {
    const res = streamJsonArray({
      envelope: { First: 1, Second: 2 },
      arrayKey: 'Items',
      items: [{ id: 1 }],
    });
    const text = await res.text();
    const json = JSON.parse(text);
    const keys = Object.keys(json);
    const itemsIndex = keys.indexOf('Items');
    const firstIndex = keys.indexOf('First');
    expect(itemsIndex).toBeGreaterThan(firstIndex);
  });

  it('status code is 200', () => {
    const res = streamJsonArray({ envelope: {}, arrayKey: 'D', items: [] });
    expect(res.status).toBe(200);
  });

  it('handles items with very long string values', async () => {
    const items = [{ data: 'x'.repeat(100000) }];
    const res = streamJsonArray({ envelope: {}, arrayKey: 'Items', items });
    const json = await res.json();
    expect(json.Items[0].data.length).toBe(100000);
  });
});
