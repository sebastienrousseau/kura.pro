import { describe, it, expect } from 'vitest';

const { onRequestGet, onRequestOptions } = await import('../../functions/api/health.js');

function makeCtx(bindings = {}) {
  return {
    env: {
      ASSETS: 'assets' in bindings ? bindings.assets : true,
      RATE_KV: 'kv' in bindings ? bindings.kv : true,
      AI: 'ai' in bindings ? bindings.ai : true,
      VECTOR_INDEX: 'vectorize' in bindings ? bindings.vectorize : true,
    },
  };
}

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  it('includes timestamp', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('reports all bindings as available', async () => {
    const res = await onRequestGet(makeCtx());
    const json = await res.json();
    expect(json.bindings.assets).toBe(true);
    expect(json.bindings.kv).toBe(true);
    expect(json.bindings.ai).toBe(true);
    expect(json.bindings.vectorize).toBe(true);
  });

  it('reports missing bindings as false', async () => {
    const res = await onRequestGet(makeCtx({ ai: null, vectorize: null }));
    const json = await res.json();
    expect(json.bindings.ai).toBe(false);
    expect(json.bindings.vectorize).toBe(false);
    expect(json.bindings.assets).toBe(true);
  });

  it('has CORS header', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('has no-cache header', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store');
  });

  it('returns JSON content type', async () => {
    const res = await onRequestGet(makeCtx());
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

describe('OPTIONS /api/health', () => {
  it('returns 204', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
  });
});
