import { describe, it, expect, vi } from 'vitest';

const { onRequestGet } = await import('../../functions/api/transform.js');

function makeContext(queryString, env = {}) {
  return {
    request: {
      url: `https://cloudcdn.pro/api/transform${queryString}`,
    },
    env: {
      RATE_KV: env.RATE_KV ?? {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
    },
  };
}

// Stub global fetch for transform tests
const originalFetch = globalThis.fetch;

describe('GET /api/transform', () => {
  // --- Missing required param ---
  it('returns 400 when url param is missing', async () => {
    const ctx = makeContext('');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('url');
  });

  // --- Invalid params ---
  it('returns 400 for non-numeric width', async () => {
    const ctx = makeContext('?url=/test.png&w=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('w must be');
  });

  it('returns 400 for non-numeric height', async () => {
    const ctx = makeContext('?url=/test.png&h=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('h must be');
  });

  it('returns 400 for invalid fit value', async () => {
    const ctx = makeContext('?url=/test.png&fit=stretch');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('fit');
  });

  it('returns 400 for invalid format', async () => {
    const ctx = makeContext('?url=/test.png&format=gif');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('format');
  });

  it('returns 400 for non-numeric quality', async () => {
    const ctx = makeContext('?url=/test.png&q=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('q must be');
  });

  it('returns 400 for non-numeric blur', async () => {
    const ctx = makeContext('?url=/test.png&blur=nope');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('blur must be');
  });

  it('returns 400 for non-numeric sharpen', async () => {
    const ctx = makeContext('?url=/test.png&sharpen=abc');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('sharpen must be');
  });

  it('returns 400 for invalid gravity', async () => {
    const ctx = makeContext('?url=/test.png&gravity=leftish');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('gravity');
  });

  // --- Rate limiting ---
  it('returns 429 when monthly limit reached', async () => {
    const ctx = makeContext('?url=/test.png', {
      RATE_KV: {
        get: vi.fn().mockResolvedValue('50000'),
        put: vi.fn(),
      },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe('limit_reached');
  });

  it('works without RATE_KV binding', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png', { RATE_KV: null });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles RATE_KV.get error gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png', {
        RATE_KV: {
          get: vi.fn().mockRejectedValue(new Error('KV down')),
          put: vi.fn(),
        },
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles RATE_KV.put error gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png', {
        RATE_KV: {
          get: vi.fn().mockResolvedValue('5'),
          put: vi.fn().mockRejectedValue(new Error('KV write fail')),
        },
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Valid params: happy path ---
  it('returns 200 with all valid params and relative URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('imgdata', {
      status: 200,
      headers: { 'Content-Type': 'image/webp' },
    }));
    try {
      const ctx = makeContext('?url=/kura/images/test.png&w=100&h=200&fit=cover&format=webp&q=80&blur=5&sharpen=2&gravity=center');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('Vary')).toBe('Accept');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      // Verify fetch was called with correct cf.image options
      const fetchCall = globalThis.fetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://cloudcdn.pro/kura/images/test.png');
      expect(fetchCall[1].cf.image).toEqual({
        width: 100,
        height: 200,
        fit: 'cover',
        format: 'webp',
        quality: 80,
        blur: 5,
        sharpen: 2,
        gravity: 'center',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles format=auto by omitting format from options', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&format=auto');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.format).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clamps valid numeric params to range', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      // q=999 → 100, blur=999 → 250, sharpen=999 → 10, w=0 → 1
      const ctx = makeContext('?url=/test.png&q=999&blur=999&sharpen=999&w=0');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.quality).toBe(100);
      expect(opts.blur).toBe(250);
      expect(opts.sharpen).toBe(10);
      expect(opts.width).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles absolute http:// URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=http://example.com/pic.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(globalThis.fetch.mock.calls[0][0]).toBe('http://example.com/pic.png');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('handles absolute https:// URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=https://example.com/pic.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(globalThis.fetch.mock.calls[0][0]).toBe('https://example.com/pic.png');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Upstream errors ---
  it('returns 400 for upstream 4xx error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));
    try {
      const ctx = makeContext('?url=/test.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain('Upstream returned 404');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 502 for upstream 5xx error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('Error', { status: 502 }));
    try {
      const ctx = makeContext('?url=/test.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('Upstream returned 502');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns 500 when fetch throws', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    try {
      const ctx = makeContext('?url=/test.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Failed to transform image');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
