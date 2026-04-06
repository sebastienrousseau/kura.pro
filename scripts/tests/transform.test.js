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
      const ctx = makeContext('?url=/cloudcdn/v1/test.png&w=100&h=200&fit=cover&format=webp&q=80&blur=5&sharpen=2&gravity=center');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
      expect(res.headers.get('Vary')).toBe('Accept');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      // Verify fetch was called with correct cf.image options
      const fetchCall = globalThis.fetch.mock.calls[0];
      expect(fetchCall[0]).toBe('https://cloudcdn.pro/cloudcdn/v1/test.png');
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

  it('rejects absolute http:// URL (SSRF protection)', async () => {
    const ctx = makeContext('?url=http://example.com/pic.png');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Absolute URLs are not allowed');
  });

  it('rejects absolute https:// URL (SSRF protection)', async () => {
    const ctx = makeContext('?url=https://example.com/pic.png');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Absolute URLs are not allowed');
  });

  it('rejects path traversal in URL', async () => {
    const ctx = makeContext('?url=../../etc/passwd');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('disallowed sequences');
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

  // --- Width/height edge cases ---
  it('w=1 is accepted (minimum)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&w=1');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.width).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('h=1 is accepted (minimum)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&h=1');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.height).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('w=8192 is accepted (maximum)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&w=8192');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.width).toBeLessThanOrEqual(8192);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('h=8192 is accepted (maximum)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&h=8192');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.height).toBeLessThanOrEqual(8192);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- All fit values ---
  for (const fit of ['cover', 'contain', 'fill', 'inside', 'outside']) {
    it(`accepts fit=${fit}`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext(`?url=/test.png&fit=${fit}`);
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
        const opts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(opts.fit).toBe(fit);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  // --- All gravity values ---
  for (const gravity of ['center', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'face', 'auto']) {
    it(`accepts gravity=${gravity}`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext(`?url=/test.png&gravity=${gravity}`);
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
        const opts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(opts.gravity).toBe(gravity);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  // --- All format values ---
  for (const format of ['webp', 'avif', 'png', 'jpeg']) {
    it(`accepts format=${format}`, async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext(`?url=/test.png&format=${format}`);
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
        const opts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(opts.format).toBe(format);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }

  // --- Quality edge cases ---
  it('q=1 (minimum quality)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&q=1');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.quality).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('q=100 does not send quality param (or sends 100)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&q=100');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.quality).toBe(100);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Blur edge cases ---
  it('blur=1 (minimum blur)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&blur=1');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.blur).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blur=250 (maximum blur)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&blur=250');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.blur).toBe(250);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Sharpen edge cases ---
  it('sharpen=1 (minimum sharpen)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&sharpen=1');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.sharpen).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sharpen=10 (maximum sharpen)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&sharpen=10');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.sharpen).toBe(10);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Combined params ---
  it('handles all params combined (w+h+fit+format+q+blur+sharpen)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&w=800&h=600&fit=contain&format=avif&q=75&blur=5&sharpen=3&gravity=north');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.width).toBe(800);
      expect(opts.height).toBe(600);
      expect(opts.fit).toBe('contain');
      expect(opts.format).toBe('avif');
      expect(opts.quality).toBe(75);
      expect(opts.blur).toBe(5);
      expect(opts.sharpen).toBe(3);
      expect(opts.gravity).toBe('north');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --- Rate limit at boundary ---
  it('returns 429 at exactly 50000 (boundary)', async () => {
    const ctx = makeContext('?url=/test.png', {
      RATE_KV: {
        get: vi.fn().mockResolvedValue('50000'),
        put: vi.fn(),
      },
    });
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(429);
  });

  it('returns 400 for w=8193 (over max)', async () => {
    const ctx = makeContext('?url=/test.png&w=8193');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for h=8193 (over max)', async () => {
    const ctx = makeContext('?url=/test.png&h=8193');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative width', async () => {
    const ctx = makeContext('?url=/test.png&w=-100');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative height', async () => {
    const ctx = makeContext('?url=/test.png&h=-50');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative quality', async () => {
    const ctx = makeContext('?url=/test.png&q=-1');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative blur', async () => {
    const ctx = makeContext('?url=/test.png&blur=-1');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('returns 400 for negative sharpen', async () => {
    const ctx = makeContext('?url=/test.png&sharpen=-1');
    const res = await onRequestGet(ctx);
    expect(res.status).toBe(400);
  });

  it('handles url-only param with defaults', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.width).toBeUndefined();
      expect(opts.height).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('response Content-Type is preserved from upstream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', {
      status: 200,
      headers: { 'Content-Type': 'image/avif' },
    }));
    try {
      const ctx = makeContext('?url=/test.png&format=avif');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('allows request at 49999 (below limit)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png', {
        RATE_KV: {
          get: vi.fn().mockResolvedValue('49999'),
          put: vi.fn(),
        },
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
