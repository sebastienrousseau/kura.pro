import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions, isLowBandwidthClient, matchedBotUa } = await import('../../functions/api/transform.js');

function makeContext(queryString, env = {}, headerOverrides = {}) {
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (test browser)',
    'cf-connecting-ip': '203.0.113.1',
    ...headerOverrides,
  });
  return {
    request: {
      url: `https://cloudcdn.pro/api/transform${queryString}`,
      headers,
    },
    env: {
      RATE_KV: env.RATE_KV ?? {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
      },
      ...env,
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

  // --- Rate limiting (UsageMeterDO) ---
  // The previous KV-based check (RATE_KV.get('transforms:YYYY-MM'))
  // was an ADR-11 banned per-request counter. Production now goes
  // through UsageMeterDO.addIfBelow; the mock returns
  // { accepted: false } to trigger 429.
  function meterReturning(body) {
    return {
      idFromName: vi.fn(() => 'do-id'),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
      })),
    };
  }
  it('returns 429 when monthly limit reached', async () => {
    const ctx = makeContext('?url=/test.png', {
      USAGE_METER: meterReturning({ accepted: false, units: 50000, period: '2026-06', limit: 50000 }),
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
      expect(res.headers.get('Vary')).toContain('Accept');
      expect(res.headers.get('Vary')).toContain('Save-Data');
      expect(res.headers.get('Vary')).toContain('Sec-CH-Effective-Connection-Type');
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

  it('accepts params at their maximum allowed values', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
    try {
      const ctx = makeContext('?url=/test.png&q=100&blur=250&sharpen=10&w=8192');
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
      const opts = globalThis.fetch.mock.calls[0][1].cf.image;
      expect(opts.quality).toBe(100);
      expect(opts.blur).toBe(250);
      expect(opts.sharpen).toBe(10);
      expect(opts.width).toBe(8192);
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
      USAGE_METER: meterReturning({ accepted: false, units: 50000, period: '2026-06', limit: 50000 }),
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
      // After the ADR-11 migration: monthly cap is enforced by
      // UsageMeterDO (accepted: true at 49999). Per-IP rate limit
      // uses a different RATE_KV key prefix and gets null = 0.
      const ctx = makeContext('?url=/test.png', {
        RATE_KV: {
          get: vi.fn(async (key) => key.startsWith('rl:transform:') ? null : null),
          put: vi.fn(),
        },
        USAGE_METER: meterReturning({ accepted: true, units: 49999, period: '2026-06', limit: 50000 }),
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('OPTIONS', () => {
    it('returns 204 with CORS preflight headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  describe('network-aware delivery', () => {
    function makeNetworkCtx(query, requestHeaders = {}, env = {}) {
      const h = new Headers(requestHeaders);
      return {
        request: { url: `https://cloudcdn.pro/api/transform${query}`, headers: h, cf: env.cf },
        env: {
          RATE_KV: env.RATE_KV ?? { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
        },
      };
    }

    describe('isLowBandwidthClient', () => {
      it('detects Save-Data: on', () => {
        const req = { headers: new Headers({ 'save-data': 'on' }) };
        expect(isLowBandwidthClient(req)).toBe(true);
      });
      it('detects Save-Data: ON (case-insensitive)', () => {
        const req = { headers: new Headers({ 'save-data': 'ON' }) };
        expect(isLowBandwidthClient(req)).toBe(true);
      });
      it('does not flag Save-Data: off', () => {
        const req = { headers: new Headers({ 'save-data': 'off' }) };
        expect(isLowBandwidthClient(req)).toBe(false);
      });
      it('detects slow ECT values', () => {
        for (const ect of ['slow-2g', '2g', '3g']) {
          const req = { headers: new Headers({ 'sec-ch-effective-connection-type': ect }) };
          expect(isLowBandwidthClient(req)).toBe(true);
        }
      });
      it('does not flag fast ECT values', () => {
        for (const ect of ['4g', '5g']) {
          const req = { headers: new Headers({ 'sec-ch-effective-connection-type': ect }) };
          expect(isLowBandwidthClient(req)).toBe(false);
        }
      });
      it('returns false when no headers exist', () => {
        expect(isLowBandwidthClient({})).toBe(false);
        expect(isLowBandwidthClient(null)).toBe(false);
      });
    });

    it('clamps quality to 60 when Save-Data is on', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png&q=95', { 'save-data': 'on' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get('X-Network-Aware')).toBe('slow');
        const cfOpts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(cfOpts.quality).toBe(60);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('keeps a caller-supplied quality lower than the ceiling', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png&q=40', { 'save-data': 'on' });
        await onRequestGet(ctx);
        const cfOpts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(cfOpts.quality).toBe(40);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('forces WebP when format is unspecified and network is slow', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png', { 'sec-ch-effective-connection-type': '3g' });
        await onRequestGet(ctx);
        const cfOpts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(cfOpts.format).toBe('webp');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does NOT override explicit format=avif even on slow networks', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png&format=avif', { 'save-data': 'on' });
        await onRequestGet(ctx);
        const cfOpts = globalThis.fetch.mock.calls[0][1].cf.image;
        expect(cfOpts.format).toBe('avif');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does not stamp X-Network-Aware when client is on a fast connection', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png', { 'sec-ch-effective-connection-type': '4g' });
        const res = await onRequestGet(ctx);
        expect(res.headers.get('X-Network-Aware')).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('reads connection type from request.cf when present', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeNetworkCtx('?url=/test.png', {}, { cf: { clientAcceptEncoding: 'gzip', connectionType: '2g' } });
        const res = await onRequestGet(ctx);
        expect(res.headers.get('X-Network-Aware')).toBe('slow');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── Bot blocklist (Layer 1 defence) ────────────────────────────
  describe('AI-crawler User-Agent blocklist', () => {
    const blocklistFixtures = [
      ['GPTBot/1.2 (+https://openai.com/gptbot)', 'gptbot'],
      ['Mozilla/5.0 (compatible; ClaudeBot/1.0)', 'claudebot'],
      ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'perplexitybot'],
      ['Bytespider; spider-feedback@bytedance.com', 'bytespider'],
      ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'ccbot'],
      ['Mozilla/5.0 (compatible; Google-Extended)', 'google-extended'],
      ['meta-externalagent/1.1', 'meta-externalagent'],
    ];
    for (const [ua, expected] of blocklistFixtures) {
      it(`blocks ${expected} with 403`, async () => {
        const ctx = makeContext('?url=/x.png', {}, { 'user-agent': ua });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('bot_blocked');
        // legacyErrorJson's `extra.message` spreads as body.message
        // (lowercase) — body.Message (capital M) is the short error code.
        expect(body.message).toContain(expected);
      });
    }

    it('matchedBotUa returns the matched substring for blocked UAs', () => {
      expect(matchedBotUa('Mozilla/5.0 (compatible; GPTBot/1.2)')).toBe('gptbot');
      expect(matchedBotUa('Mozilla/5.0 ClaudeBot')).toBe('claudebot');
    });

    it('matchedBotUa returns null for legitimate UAs', () => {
      expect(matchedBotUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBeNull();
      expect(matchedBotUa('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBeNull();
      expect(matchedBotUa('curl/8.4.0')).toBeNull();
    });

    it('matchedBotUa returns null on null/empty UA', () => {
      expect(matchedBotUa(null)).toBeNull();
      expect(matchedBotUa(undefined)).toBeNull();
      expect(matchedBotUa('')).toBeNull();
    });
  });

  // ── Per-IP rate limit (Layer 2 defence) ────────────────────────
  describe('per-IP rate limit', () => {
    function meterAccepting() {
      return {
        idFromName: vi.fn(() => 'do-id'),
        get: vi.fn(() => ({
          fetch: vi.fn(async () => new Response(
            JSON.stringify({ accepted: true, units: 1, period: '2026-06', limit: 50000 }),
            { status: 200 },
          )),
        })),
      };
    }

    it('returns 429 when the per-IP cap is hit (mock RATE_KV returns over-limit count)', async () => {
      // checkRateLimit (KV path) reads counter, compares to limit. Set
      // the mock to return a count of 61 which is > the 60/min cap.
      const ctx = makeContext('?url=/x.png', {
        RATE_KV: {
          get: vi.fn(async (key) => key.startsWith('rl:transform:') ? '61' : null),
          put: vi.fn(),
        },
        USAGE_METER: meterAccepting(),
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('rate_limit_exceeded');
      expect(body.message).toContain('60');
    });

    it('allows requests when under the per-IP cap', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', {
          RATE_KV: {
            get: vi.fn().mockResolvedValue('5'), // under the 60/min cap
            put: vi.fn(),
          },
          USAGE_METER: meterAccepting(),
        });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
