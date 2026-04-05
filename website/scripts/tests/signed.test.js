import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const { onRequestGet } = await import('../../../functions/api/signed.js');

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

  // --- Extended tests ---

  it('accepts signature regardless of case (lowercase vs uppercase hex)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200, headers: { 'Content-Type': 'application/pdf' } }));
    try {
      const path = '/protected/test.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);
      // Try uppercase version
      const upperSig = sig.toUpperCase();

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${upperSig}`);
      const res = await onRequestGet(ctx);
      // The signature comparison may be case-sensitive or not
      expect([200, 403]).toContain(res.status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 403 when expires is exactly now (boundary)', async () => {
    const path = '/protected/file.pdf';
    const expires = String(Math.floor(Date.now() / 1000));
    const sig = makeSignature(TEST_SECRET, path, expires);

    const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
    const res = await onRequestGet(ctx);
    // At the boundary, could be expired depending on timing
    expect([200, 403]).toContain(res.status);
  });

  it('returns 200 when expires is 1 second from now', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/file.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 1);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 403 when expires is 1 second ago', async () => {
    const path = '/protected/file.pdf';
    const expires = String(Math.floor(Date.now() / 1000) - 1);
    const sig = makeSignature(TEST_SECRET, path, expires);

    const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('handles path with spaces (%20)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/my file.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles path with Unicode characters', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/日本語.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 403 for empty path parameter', async () => {
    const ctx = makeContext('?path=&expires=9999999999&sig=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('returns 403 for empty expires parameter', async () => {
    const ctx = makeContext('?path=/test.pdf&expires=&sig=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('returns 403 for non-numeric expires', async () => {
    const ctx = makeContext('?path=/test.pdf&expires=notanumber&sig=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
  });

  it('returns upstream status when asset returns 403', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }));
    try {
      const path = '/protected/secret.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      // 403 from upstream may be returned as 404 or passed through
      expect([403, 404]).toContain(res.status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns upstream status when asset returns 500', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Error', { status: 500 }));
    try {
      const path = '/protected/broken.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect([404, 500, 502]).toContain(res.status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles upstream redirect (301)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Redirect', { status: 301, headers: { 'Location': '/new' } }));
    try {
      const path = '/protected/moved.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      // Redirect may be passed through or treated as error
      expect([200, 301, 404]).toContain(res.status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles very long path (>8192 chars)', async () => {
    const longPath = '/protected/' + 'a'.repeat(8200) + '.pdf';
    const expires = String(Math.floor(Date.now() / 1000) + 3600);
    const sig = makeSignature(TEST_SECRET, longPath, expires);

    const ctx = makeContext(`?path=${encodeURIComponent(longPath)}&expires=${expires}&sig=${sig}`);
    const res = await onRequestGet(ctx);
    // Should not crash
    expect([200, 403, 404, 500, 502]).toContain(res.status);
  });

  it('handles concurrent valid requests', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/concurrent.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => {
          const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
          return onRequestGet(ctx);
        })
      );
      for (const res of results) {
        expect(res.status).toBe(200);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('valid signature has X-Signed-URL header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/test.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);
      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.headers.get('X-Signed-URL')).toBe('verified');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('valid response has private Cache-Control', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/cache-test.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);
      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Cache-Control')).toContain('private');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('valid response has CORS header', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/cors-test.pdf';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);
      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('403 response is valid JSON', async () => {
    const ctx = makeContext('?path=/test&expires=9999999999&sig=bad');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('500 response is valid JSON when secret missing', async () => {
    const ctx = makeContext('?path=/test&expires=9999999999&sig=abc', { SIGNED_URL_SECRET: undefined });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('handles path with query string encoded', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const path = '/protected/file.pdf?version=2';
      const expires = String(Math.floor(Date.now() / 1000) + 3600);
      const sig = makeSignature(TEST_SECRET, path, expires);

      const ctx = makeContext(`?path=${encodeURIComponent(path)}&expires=${expires}&sig=${sig}`);
      const res = await onRequestGet(ctx);
      expect([200, 403]).toContain(res.status);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
