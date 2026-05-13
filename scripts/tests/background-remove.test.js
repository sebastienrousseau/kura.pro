import { describe, it, expect } from 'vitest';

const { onRequestGet, onRequestPost, onRequestOptions } = await import(
  '../../functions/api/ai/background-remove.js'
);

describe('GET /api/ai/background-remove', () => {
  it('returns 501 Not Implemented', async () => {
    const res = await onRequestGet();
    expect(res.status).toBe(501);
  });

  it('explains the dependency in the response body', async () => {
    const res = await onRequestGet();
    const json = await res.json();
    expect(json.error.code).toBe('NotImplemented');
    expect(json.Message).toContain('segmentation model');
    expect(json.Message).toContain('Workers AI');
  });

  it('reports the blocking dependency in details[]', async () => {
    const res = await onRequestGet();
    const json = await res.json();
    expect(Array.isArray(json.error.details)).toBe(true);
    expect(json.error.details[0].code).toBe('BlockedByDependency');
    expect(json.error.details[0].target).toContain('segmentation');
  });

  it('returns the standard envelope (HttpCode, requestId, apiVersion)', async () => {
    const res = await onRequestGet();
    const json = await res.json();
    expect(json.HttpCode).toBe(501);
    expect(json.requestId).toMatch(/^[0-9a-f]{8}-/);
    expect(json.apiVersion).toBeTruthy();
  });

  it('attaches CORS + tracing headers', async () => {
    const res = await onRequestGet();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('X-Request-ID')).toMatch(/^[0-9a-f]{8}-/);
    expect(res.headers.get('X-API-Version')).toBeTruthy();
  });
});

describe('POST /api/ai/background-remove', () => {
  it('returns 501 Not Implemented (same as GET)', async () => {
    const res = await onRequestPost();
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.error.code).toBe('NotImplemented');
  });
});

describe('OPTIONS /api/ai/background-remove', () => {
  it('returns 204 with preflight CORS headers', async () => {
    const res = await onRequestOptions();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });
});
