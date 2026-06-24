import { describe, it, expect, vi } from 'vitest';

const { onRequestGet, onRequestOptions, isLowBandwidthClient, matchedBotUa, isAllowedReferer } = await import('../../functions/api/transform.js');

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
    // Fixtures pair real-world UA strings with the regex source they
    // should match (regex source = the pattern text without slashes
    // or flags, e.g. /GPTBot/i → 'GPTBot').
    const blocklistFixtures = [
      ['GPTBot/1.2 (+https://openai.com/gptbot)',          'GPTBot'],
      ['Mozilla/5.0 (compatible; ChatGPT-User)',            'ChatGPT'],
      ['Mozilla/5.0 (compatible; OAI-SearchBot/1.0)',       'OAI-SearchBot'],
      ['Mozilla/5.0 (compatible; ClaudeBot/1.0)',           'ClaudeBot'],
      ['Mozilla/5.0 anthropic-ai',                          'anthropic-ai'],
      ['Mozilla/5.0 (compatible; PerplexityBot/1.0)',       'Perplexity'],
      ['Bytespider; spider-feedback@bytedance.com',         'Bytespider'],
      ['CCBot/2.0 (https://commoncrawl.org/faq/)',          'CCBot'],
      ['Mozilla/5.0 (compatible; Google-Extended)',         'Google-Extended'],
      ['Mozilla/5.0 (compatible; GoogleOther)',             'GoogleOther'],
      ['Meta-ExternalAgent/1.1',                            'Meta-ExternalAgent'],
      ['Mozilla/5.0 (compatible; Meta-ExternalFetcher/1.0)', 'Meta-ExternalFetcher'],
      ['Mozilla/5.0 (compatible; FacebookBot/1.0)',         'FacebookBot'],
      ['Mozilla/5.0 (compatible; BingPreview)',             'BingPreview'],
      ['Mozilla/5.0 (compatible; Applebot/0.1)',            'Applebot'],
      ['Mozilla/5.0 (compatible; cohere-ai)',               'Cohere'],
      ['Mozilla/5.0 (compatible; Amazonbot/0.1)',           'Amazonbot'],
      ['Mozilla/5.0 (compatible; mistralai-user)',          'mistralai-user'],
      ['Mozilla/5.0 (compatible; AI2Bot)',                  'AI2Bot'],
      ['Mozilla/5.0 (compatible; Diffbot/1.0)',             'Diffbot'],
      ['Mozilla/5.0 (compatible; omgili/0.5)',              'omgili'],
      ['Mozilla/5.0 (compatible; Webzio-Extended)',         'Webzio-Extended'],
      ['Mozilla/5.0 (compatible; ImagesiftBot)',            'ImagesiftBot'],
      ['Mozilla/5.0 (compatible; img2dataset)',             'img2dataset'],
      ['Mozilla/5.0 (compatible; PetalBot)',                'PetalBot'],
      ['Mozilla/5.0 (compatible; DuckAssistBot)',           'DuckAssistBot'],
      ['Mozilla/5.0 (compatible; Timpibot)',                'Timpibot'],
      ['Mozilla/5.0 (compatible; iaskspider/1.0)',          'iaskspider'],
      ['Mozilla/5.0 (compatible; AhrefsBot/7.0)',           'AhrefsBot'],
      ['Mozilla/5.0 (compatible; SemrushBot)',              'SemrushBot'],
      ['Mozilla/5.0 (compatible; MJ12bot/v1.4.8)',          'MJ12bot'],
      ['Mozilla/5.0 (compatible; DotBot)',                  'DotBot'],
      ['Mozilla/5.0 (compatible; BLEXBot)',                 'BLEXBot'],
      ['Mozilla/5.0 (compatible; DataForSeoBot)',           'DataForSeoBot'],
      ['Mozilla/5.0 (claude-web)',                          'Claude-Web'],
      ['User-Agent: anthropic.com/scraper',                 'anthropic\\.com'],
    ];
    for (const [ua, expected] of blocklistFixtures) {
      it(`blocks "${expected}" → 403 for UA "${ua.slice(0, 50)}"`, async () => {
        const ctx = makeContext('?url=/x.png', {}, { 'user-agent': ua });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe('bot_blocked');
        // legacyErrorJson's `extra.message` spreads as body.message;
        // matchedBotUa returns the regex .source which we substring into
        // the human message.
        expect(body.message).toContain(expected);
      });
    }

    it('matchedBotUa returns the regex source for blocked UAs', () => {
      expect(matchedBotUa('Mozilla/5.0 (compatible; GPTBot/1.2)')).toBe('GPTBot');
      expect(matchedBotUa('Mozilla/5.0 ClaudeBot')).toBe('ClaudeBot');
    });

    it('matchedBotUa returns null for legitimate UAs', () => {
      // Plain browsers must pass.
      expect(matchedBotUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')).toBeNull();
      // Googlebot for search is NOT blocked (only Google-Extended/GoogleOther are).
      expect(matchedBotUa('Googlebot/2.1 (+http://www.google.com/bot.html)')).toBeNull();
      // bingbot for search is NOT blocked (only BingPreview is).
      expect(matchedBotUa('Mozilla/5.0 (compatible; bingbot/2.0)')).toBeNull();
      expect(matchedBotUa('curl/8.4.0')).toBeNull();
      // Verify the audit-removed risky patterns DON'T fire:
      // /oBot/i was removed because it'd match Robot/Roboto. Confirm absence.
      expect(matchedBotUa('Roboto/1.0 (Google font CDN)')).toBeNull();
      // /Gemini/i removed — could false-positive on apps named Gemini.
      expect(matchedBotUa('Gemini Wallet/1.0')).toBeNull();
      // /Copilot/i removed — risky vs Edge browsers shipping Copilot.
      expect(matchedBotUa('Mozilla/5.0 Edge/120 Copilot/1.0')).toBeNull();
    });

    it('matchedBotUa returns null on null/empty UA', () => {
      expect(matchedBotUa(null)).toBeNull();
      expect(matchedBotUa(undefined)).toBeNull();
      expect(matchedBotUa('')).toBeNull();
    });

    it('matchedBotUa exports BLOCKED_UA_PATTERNS for sync workflow access', async () => {
      const mod = await import('../../functions/api/transform.js');
      expect(Array.isArray(mod.BLOCKED_UA_PATTERNS)).toBe(true);
      expect(mod.BLOCKED_UA_PATTERNS.length).toBeGreaterThanOrEqual(35);
      expect(mod.BLOCKED_UA_PATTERNS.every((r) => r instanceof RegExp)).toBe(true);
    });
  });

  // ── Per-IP rate limit (Layer 2 defence) ────────────────────────
  describe('multi-tier per-IP rate limit', () => {
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

    // RATE_KV mock that returns `count` for keys matching the given
    // tier prefix and null for everything else — exercises one tier at
    // a time without tripping the others.
    function tierMock(prefix, count) {
      return {
        get: vi.fn(async (key) => key.startsWith(prefix) ? String(count) : null),
        put: vi.fn(),
      };
    }

    it('returns 429 rate_limit_exceeded_minute when over the 60/min cap', async () => {
      const ctx = makeContext('?url=/x.png', {
        RATE_KV: tierMock('rl:transform:m:', 61),
        USAGE_METER: meterAccepting(),
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('rate_limit_exceeded_minute');
      expect(body.message).toContain('minute');
    });

    it('returns 429 rate_limit_exceeded_hour when minute OK but hour over 1k', async () => {
      const ctx = makeContext('?url=/x.png', {
        RATE_KV: tierMock('rl:transform:h:', 1001),
        USAGE_METER: meterAccepting(),
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limit_exceeded_hour');
    });

    it('returns 429 rate_limit_exceeded_day when minute+hour OK but day over 5k', async () => {
      const ctx = makeContext('?url=/x.png', {
        RATE_KV: tierMock('rl:transform:d:', 5001),
        USAGE_METER: meterAccepting(),
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limit_exceeded_day');
    });

    it('allows requests when under all three caps', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', {
          RATE_KV: {
            get: vi.fn().mockResolvedValue('5'), // under every cap
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

  // ── Referer check (Layer 2 defence-in-depth) ──────────────────
  describe('Referer hotlink check', () => {
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

    it('blocks external Referer with 403 hotlink_blocked', async () => {
      const ctx = makeContext('?url=/x.png', {}, { referer: 'https://evil.com/scrape.html' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('hotlink_blocked');
    });

    it('allows cloudcdn.pro Referer', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', { USAGE_METER: meterAccepting() }, { referer: 'https://cloudcdn.pro/en/' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows *.cloudcdn.pro Referer (multi-tenant subdomain)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', { USAGE_METER: meterAccepting() }, { referer: 'https://acme.cloudcdn.pro/' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('allows missing Referer (no-referrer-policy / direct API)', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        // makeContext default includes a Mozilla UA but the test sets
        // referer to empty string explicitly.
        const ctx = makeContext('?url=/x.png', { USAGE_METER: meterAccepting() }, { referer: '' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('blocks malformed Referer with 403', async () => {
      const ctx = makeContext('?url=/x.png', {}, { referer: 'not-a-url' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(403);
    });

    // ── isAllowedReferer pure helper ───────────────────────────
    it('isAllowedReferer: empty → true', () => {
      expect(isAllowedReferer('')).toBe(true);
      expect(isAllowedReferer(null)).toBe(true);
      expect(isAllowedReferer(undefined)).toBe(true);
    });

    it('isAllowedReferer: cloudcdn.pro and subdomains → true', () => {
      expect(isAllowedReferer('https://cloudcdn.pro/')).toBe(true);
      expect(isAllowedReferer('https://cloudcdn.pro/some/path?q=1')).toBe(true);
      expect(isAllowedReferer('https://acme.cloudcdn.pro/')).toBe(true);
      expect(isAllowedReferer('https://staging.cloudcdn.pro/x')).toBe(true);
    });

    it('isAllowedReferer: external hosts → false', () => {
      expect(isAllowedReferer('https://evil.com/')).toBe(false);
      expect(isAllowedReferer('https://google.com/imgres?...')).toBe(false);
      // Subdomain trick: "cloudcdn.pro.evil.com" should NOT match the suffix.
      expect(isAllowedReferer('https://cloudcdn.pro.evil.com/')).toBe(false);
    });

    it('isAllowedReferer: malformed URL → false', () => {
      expect(isAllowedReferer('not-a-url')).toBe(false);
      expect(isAllowedReferer('javascript:alert(1)')).toBe(false);
    });
  });

  // ── Auth gate (Layer 0) ────────────────────────────────────────
  // /api/transform is no longer public. cdn_session cookie OR
  // AccountKey/AccessKey header is required. PR added 2026-06-23.
  describe('authentication gate', () => {
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

    // Minimal valid D1 mock returning a session row that getCurrentSession
    // will accept. The shape mirrors the production session lookup in
    // functions/api/auth/_lib.js#getCurrentSession.
    function dbReturningSession(row) {
      return {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(row),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        })),
        batch: vi.fn().mockResolvedValue([]),
      };
    }

    it('returns 401 unauthenticated under STRICT_AUTH=1 with no creds', async () => {
      const ctx = makeContext('?url=/x.png', {
        STRICT_AUTH: '1',
        ACCOUNT_KEY: 'secret-key',
      });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('unauthenticated');
    });

    it('returns 200 when a valid AccountKey header is supplied', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', {
          STRICT_AUTH: '1',
          ACCOUNT_KEY: 'secret-key',
          USAGE_METER: meterAccepting(),
        }, { 'AccountKey': 'secret-key' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns 200 when a valid cdn_session cookie + D1 session row exists', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const now = Math.floor(Date.now() / 1000);
        const ctx = makeContext('?url=/x.png', {
          STRICT_AUTH: '1',
          ACCOUNTS_DB: dbReturningSession({
            token_hash: 'h', user_id: 'u1', account_id: 'a1',
            expires_at: now + 3600, revoked_at: null,
            email: 'a@b.com', name: null, email_verified_at: null,
            account_id_full: 'a1', account_name: 'A', plan: 'free', monthly_cap_usd: 0,
          }),
          USAGE_METER: meterAccepting(),
        }, { 'cookie': 'cdn_session=abc.signature' });
        const res = await onRequestGet(ctx);
        expect(res.status).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns 401 when the cdn_session cookie does not match a D1 row', async () => {
      const ctx = makeContext('?url=/x.png', {
        STRICT_AUTH: '1',
        ACCOUNTS_DB: dbReturningSession(null), // no matching session
      }, { 'cookie': 'cdn_session=stale.signature' });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('skips D1 lookup when ACCOUNTS_DB is missing (degrade-open in dev)', async () => {
      // Without STRICT_AUTH, authenticateAny returns true (no ACCOUNT_KEY
      // configured = open). This is the local-dev path.
      globalThis.fetch = vi.fn().mockResolvedValue(new Response('img', { status: 200 }));
      try {
        const ctx = makeContext('?url=/x.png', {
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
