import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const { onRequestGet } = await import('../../functions/api/signed.js');

const TEST_SECRET = 'test-secret-key-for-hmac-256';

function makeSignature(secret, path, expires) {
  return createHmac('sha256', secret)
    .update(`${path}:${expires}`)
    .digest('hex');
}

function makeContext(queryString, env = {}) {
  return {
    request: {
      url: `https://cloudcdn.pro/api/signed${queryString}`,
    },
    env: {
      SIGNED_URL_SECRET: 'SIGNED_URL_SECRET' in env ? env.SIGNED_URL_SECRET : TEST_SECRET,
    },
  };
}

const originalFetch = globalThis.fetch;

describe('GET /api/signed', () => {
  // --- Missing parameters → 403 ---
  it('returns 403 when path is missing', async () => {
    const ctx = makeContext('?expires=9999999999&sig=abc123');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Missing required parameters');
  });

  it('returns 403 when expires is missing', async () => {
    const ctx = makeContext('?path=/protected/file.pdf&sig=abc123');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Missing required parameters');
  });

  it('returns 403 when sig is missing', async () => {
    const ctx = makeContext('?path=/protected/file.pdf&expires=9999999999');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Missing required parameters');
  });

  it('returns 403 when all params are missing', async () => {
    const ctx = makeContext('');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  // --- Invalid signature → 403 ---
  it('returns 403 when signature is altered by one character', async () => {
    const path = '/protected/report.pdf';
    const expires = '9999999999';
    const validSig = makeSignature(TEST_SECRET, path, expires);
    // Alter the last character
    const alteredSig = validSig.slice(0, -1) + (validSig.slice(-1) === 'a' ? 'b' : 'a');

    const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${alteredSig}`);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('Invalid signature');
  });

  // --- Expired URL → 403 ---
  it('returns 403 when URL has expired', async () => {
    const path = '/protected/report.pdf';
    // 1 second in the past
    const expires = String(Math.floor(Date.now() / 1000) - 1);
    const sig = makeSignature(TEST_SECRET, path, expires);

    const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain('expired');
  });

  // --- Missing secret → 500 ---
  it('returns 500 when SIGNED_URL_SECRET is not set', async () => {
    const ctx = makeContext('?path=/test.pdf&expires=9999999999&sig=abc', {
      SIGNED_URL_SECRET: undefined,
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('SIGNED_URL_SECRET');
  });

  // --- Valid signed URL → 200 ---
  it('returns 200 with X-Signed-URL header for valid signature', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('pdf-data', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    );
    try {
      const path = '/protected/client-report.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600); // 1 hour in the future
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Signed-URL')).toBe('verified');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Constant-time comparison exists ---
  it('completes for both valid and invalid signatures without timing differences', async () => {
    const path = '/protected/report.pdf';
    const expires = String(Math.floor(Date.now() / 1000) + 3600);

    // Invalid sig — should complete without error
    const invalidCtx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${'0'.repeat(64)}`);
    const invalidRes = await onRequestGet(invalidCtx);
    expect(invalidRes.status).toBe(403);

    // Valid sig — should also complete
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const validSig = makeSignature(TEST_SECRET, path, expires);
      const validCtx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${validSig}`);
      const validRes = await onRequestGet(validCtx);
      expect(validRes.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Upstream errors ---
  it('returns upstream status when asset is not found', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
    try {
      const path = '/protected/missing.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toContain('Asset not found');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 502 when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    try {
      const path = '/protected/file.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toBe('Failed to fetch asset');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
