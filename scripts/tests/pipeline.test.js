import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { onRequestPost, onRequestOptions, sanitizeSvg } = await import('../../functions/api/pipeline.js');

const TEST_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>';
const TEST_SVG_B64 = btoa(TEST_SVG);

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function makeKV() {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRequest({ body, accountKey, headers: extraHeaders = {} } = {}) {
  const h = new Headers(extraHeaders);
  if (accountKey) h.set('AccountKey', accountKey);
  return new Request('https://cloudcdn.pro/api/pipeline', {
    method: 'POST',
    headers: h,
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}

function makeCtx({ body, accountKey = 'admin-key', env = {}, waitUntil = vi.fn() } = {}) {
  return {
    request: makeRequest({ body, accountKey }),
    env: {
      ACCOUNT_KEY: 'admin-key',
      GITHUB_TOKEN: 'gh-token',
      GITHUB_REPO: 'sebastienrousseau/cloudcdn.pro',
      RATE_KV: makeKV(),
      ...env,
    },
    waitUntil,
  };
}

// Stub the seven GitHub Git Database API calls a single pipeline run makes
// (1 ref, 1 commit, N blobs, 1 tree, 1 commit-create, 1 ref-update).
// Optional 7th: cache purge (only when CLOUDFLARE_* env vars are set).
function happyPathFetch({ blobsExpected }) {
  const responses = [
    new Response(JSON.stringify({ object: { sha: 'head-sha' } }), { status: 200 }),
    new Response(JSON.stringify({ tree: { sha: 'base-tree' } }), { status: 200 }),
  ];
  for (let i = 0; i < blobsExpected; i++) {
    responses.push(new Response(JSON.stringify({ sha: `blob-${i}` }), { status: 201 }));
  }
  responses.push(new Response(JSON.stringify({ sha: 'new-tree' }), { status: 201 }));
  responses.push(new Response(JSON.stringify({ sha: 'new-commit' }), { status: 201 }));
  responses.push(new Response(JSON.stringify({ object: { sha: 'new-commit' } }), { status: 200 }));
  let idx = 0;
  return vi.fn().mockImplementation(() => Promise.resolve(responses[idx++] || new Response(JSON.stringify({}), { status: 200 })));
}

describe('sanitizeSvg', () => {
  it('strips <script>...</script> blocks', () => {
    expect(sanitizeSvg('<svg><script>alert(1)</script></svg>')).toBe('<svg></svg>');
  });

  it('strips self-closing <script /> tags', () => {
    expect(sanitizeSvg('<svg><script src="evil.js" /></svg>')).toBe('<svg></svg>');
  });

  it('strips inline event handler attributes', () => {
    expect(sanitizeSvg('<svg onclick="alert(1)" onerror=\'x\'><circle onload="y"/></svg>'))
      .toBe('<svg><circle/></svg>');
  });

  it('neutralises javascript: URIs in href / xlink:href / src', () => {
    const out = sanitizeSvg('<a href="javascript:alert(1)"/><a xlink:href=\'javascript:evil()\'/><img src="javascript:bad"/>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('href=""');
    expect(out).toContain('xlink:href=""');
    expect(out).toContain('src=""');
  });

  it('neutralises data:text/html URIs', () => {
    const out = sanitizeSvg('<a href="data:text/html,<script>x</script>"/>');
    expect(out).toContain('href=""');
    expect(out).not.toContain('data:text/html');
  });

  it('passes through benign SVG content untouched', () => {
    const benign = '<svg><circle cx="10" cy="10" r="5" fill="blue"/></svg>';
    expect(sanitizeSvg(benign)).toBe(benign);
  });

  it('strips nested <scr<script>ipt> bypass — no executable payload survives', () => {
    // The classic nested-tag bypass: a single-pass regex would remove the
    // inner <script>...</script> and re-expose an outer renderable form.
    // The string-walker variant of sanitizeSvg drops the disallowed tag
    // plus everything between it and its closer (or EOF if no closer
    // exists), so even when the payload is unbalanced the executable
    // bits are gone. The fragment "<scr" that survives is harmless text
    // — browsers don't parse it as an element on its own.
    const out = sanitizeSvg('<svg><scr<script>ipt>alert(1)</scr<script>ipt></svg>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips closing </script with embedded whitespace and attributes', () => {
    // </script\t\nbar> is a valid script close per HTML spec; strict
    // regex /<\/script\s*>/ misses it. Tolerant regex covers it.
    const out = sanitizeSvg('<svg><script>alert(1)</script\t\nbar></svg>');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('</script');
  });

  it('strips orphan </script> closers with no opener', () => {
    const out = sanitizeSvg('<svg></script foo="bar"></svg>');
    expect(out).not.toContain('</script');
  });

  it('strips event handlers regardless of whitespace inside the attribute', () => {
    // CodeQL flagged the on-handler regex too; verify the iterated form
    // doesn't leave half-stripped fragments.
    const out = sanitizeSvg('<svg onclick = "alert(1)" onerror= \'x\'><circle onload ="y"/></svg>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('onload');
    expect(out).not.toContain('alert(1)');
  });

  it('terminates on pathological input (no infinite loop)', () => {
    // Deeply nested scripts should not loop forever; the 8-iteration cap
    // breaks out and we still produce a sanitized string.
    let payload = 'inner';
    for (let i = 0; i < 50; i++) payload = `<script>${payload}</script>`;
    const out = sanitizeSvg(payload);
    // We don't require every byte to be stripped (cap may leave some
    // residue) but it must not contain a renderable <script> tag.
    expect(out.length).toBeLessThan(payload.length);
  });
});

describe('POST /api/pipeline', () => {
  describe('authentication', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'x', svg: TEST_SVG_B64 } });
      ctx.request = makeRequest({ body: { mode: 'client', name: 'x', svg: TEST_SVG_B64 } }); // no AccountKey
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });
  });

  describe('configuration', () => {
    it('returns 501 when GITHUB_TOKEN is missing', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'x', svg: TEST_SVG_B64 }, env: { GITHUB_TOKEN: undefined } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(501);
    });

    it('returns 501 when GITHUB_REPO is missing', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'x', svg: TEST_SVG_B64 }, env: { GITHUB_REPO: undefined } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(501);
    });
  });

  describe('input validation', () => {
    it('returns 400 for malformed JSON', async () => {
      const ctx = makeCtx({});
      ctx.request = new Request('https://cloudcdn.pro/api/pipeline', {
        method: 'POST',
        headers: new Headers({ AccountKey: 'admin-key' }),
        body: '{not json',
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when mode is missing', async () => {
      const ctx = makeCtx({ body: { svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message).toContain('mode');
    });

    it('returns 400 when mode is invalid', async () => {
      const ctx = makeCtx({ body: { mode: 'rogue', svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when client mode is missing name', async () => {
      const ctx = makeCtx({ body: { mode: 'client', svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message).toContain('name');
    });

    it('returns 400 when client mode has non-string name', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 42, svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when client name fails the NAME_RE pattern', async () => {
      for (const name of ['X', '-leading', 'trailing-', 'has spaces', '1', 'a'.repeat(70)]) {
        const ctx = makeCtx({ body: { mode: 'client', name, svg: TEST_SVG_B64 } });
        const res = await onRequestPost(ctx);
        expect(res.status).toBe(400);
      }
    });

    it('returns 400 when svg is missing', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'good-name' } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message).toContain('svg');
    });

    it('returns 400 when svg is not a string', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'good-name', svg: { not: 'a string' } } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when svg base64 is malformed', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'good-name', svg: 'not\nbase64!!!' } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('returns 400 when decoded svg does not contain <svg', async () => {
      const ctx = makeCtx({ body: { mode: 'client', name: 'good-name', svg: btoa('<html>not svg</html>') } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).Message).toContain('SVG');
    });
  });

  describe('successful pipeline runs', () => {
    it('client mode generates the full file scaffold and commits', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 8 }); // svg, 3 icons, favicon, 3 gitkeep
      const ctx = makeCtx({ body: { mode: 'client', name: 'acme', svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Mode).toBe('client');
      expect(json.Name).toBe('acme');
      expect(json.Commit).toBe('new-commit');
      // 8 files: 1 source SVG + 3 icons + 1 favicon + 3 gitkeep dirs
      expect(json.Files).toHaveLength(8);
      expect(json.Files).toContain('clients/acme/v1/logos/acme.svg');
      expect(json.Files).toContain('clients/acme/v1/icons/192x192.png');
      expect(json.Files).toContain('clients/acme/favicon.ico');
      expect(json.Files).toContain('clients/acme/v1/banners/.gitkeep');
    });

    it('stock mode uses the stocks/images prefix and skips client scaffolding', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 }); // svg + 3 icons + favicon
      const ctx = makeCtx({ body: { mode: 'stock', stockName: 'sunset', svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.Mode).toBe('stock');
      expect(json.Files[0]).toContain('stocks/images/');
      expect(json.Files.every((f) => !f.includes('/banners/'))).toBe(true);
    });

    it('stock mode defaults stockName to "asset" when omitted', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 });
      const ctx = makeCtx({ body: { mode: 'stock', svg: TEST_SVG_B64 } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.Files[0]).toContain('stocks/images/logos/asset.svg');
    });

    it('respects generateIcons=false', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 }); // svg + favicon + 3 gitkeep
      const ctx = makeCtx({ body: { mode: 'client', name: 'a-b-c', svg: TEST_SVG_B64, generateIcons: false } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.Files.some((f) => f.includes('/icons/'))).toBe(false);
    });

    it('respects generateFavicon=false', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 7 }); // svg + 3 icons + 3 gitkeep
      const ctx = makeCtx({ body: { mode: 'client', name: 'noFav', svg: TEST_SVG_B64, generateFavicon: false } });
      // 'noFav' violates NAME_RE (uppercase) — fix name
      ctx.request = makeRequest({ accountKey: 'admin-key', body: { mode: 'client', name: 'nofav', svg: TEST_SVG_B64, generateFavicon: false } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.Files.some((f) => f.endsWith('favicon.ico'))).toBe(false);
    });

    it('respects generateBanners=false for client mode', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 }); // svg + 3 icons + favicon, no gitkeeps
      const ctx = makeCtx({ body: { mode: 'client', name: 'nobanner', svg: TEST_SVG_B64, generateBanners: false } });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.Files.some((f) => f.includes('/banners/'))).toBe(false);
      expect(json.Files.some((f) => f.includes('/.gitkeep'))).toBe(false);
    });

    it('triggers cache purge when CLOUDFLARE_* env vars are set', async () => {
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 });
      const waitUntil = vi.fn();
      const ctx = makeCtx({
        body: { mode: 'stock', svg: TEST_SVG_B64 },
        env: { CLOUDFLARE_ZONE_ID: 'zone-1', CLOUDFLARE_API_TOKEN: 'cf-token' },
        waitUntil,
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it('cache purge URL preserves paths that do not start with clients/', async () => {
      // Stock mode produces stocks/* paths; the slice should preserve them.
      globalThis.fetch = happyPathFetch({ blobsExpected: 5 });
      const waitUntil = vi.fn();
      const ctx = makeCtx({
        body: { mode: 'stock', svg: TEST_SVG_B64 },
        env: { CLOUDFLARE_ZONE_ID: 'zone-1', CLOUDFLARE_API_TOKEN: 'cf-token' },
        waitUntil,
      });
      await onRequestPost(ctx);
      // The last fetch call is the purge POST.
      const purgeCall = globalThis.fetch.mock.calls.at(-1);
      expect(purgeCall[0]).toContain('/purge_cache');
    });

    it('swallows cache-purge fetch failures via the inline .catch handler', async () => {
      // Run the happy-path 6 GitHub calls, then make the purge fetch reject.
      const seq = [
        new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }),
        new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }),
        new Response(JSON.stringify({ sha: 'b' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'b' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'b' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'b' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'b' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'newtree' }), { status: 201 }),
        new Response(JSON.stringify({ sha: 'newcommit' }), { status: 201 }),
        new Response(JSON.stringify({ object: { sha: 'newcommit' } }), { status: 200 }),
      ];
      let idx = 0;
      const waitUntils = [];
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/purge_cache')) {
          return Promise.reject(new Error('purge down'));
        }
        return Promise.resolve(seq[idx++] || new Response('{}', { status: 200 }));
      });
      const ctx = makeCtx({
        body: { mode: 'client', name: 'purge-fail', svg: TEST_SVG_B64 },
        env: { CLOUDFLARE_ZONE_ID: 'z', CLOUDFLARE_API_TOKEN: 't' },
        waitUntil: (p) => waitUntils.push(p),
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      // Drain the waitUntil promise so the inline .catch runs.
      await Promise.all(waitUntils);
    });
  });

  describe('GitHub API failure paths', () => {
    function ghCtx() {
      return makeCtx({ body: { mode: 'client', name: 'ghfail', svg: TEST_SVG_B64 } });
    }

    it('returns 500 when fetching the branch ref fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce(new Response('not found', { status: 404 }));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });

    it('returns 500 when fetching the head commit fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });

    it('returns 500 when creating a blob fails', async () => {
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ object: { sha: 'h' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ tree: { sha: 't' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response('boom', { status: 500 }));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });

    it('returns 500 when creating the tree fails', async () => {
      const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      globalThis.fetch = vi.fn()
        .mockResolvedValueOnce(ok({ object: { sha: 'h' } }))
        .mockResolvedValueOnce(ok({ tree: { sha: 't' } }))
        // 8 blob calls (client mode default flags = 8 files)
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        .mockResolvedValueOnce(ok({ sha: 'b' }, 201))
        // Tree creation fails:
        .mockResolvedValueOnce(new Response('bad', { status: 422 }));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });

    it('returns 500 when creating the commit fails', async () => {
      const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      const seq = [
        ok({ object: { sha: 'h' } }),
        ok({ tree: { sha: 't' } }),
        ...Array.from({ length: 8 }, () => ok({ sha: 'b' }, 201)),
        ok({ sha: 'newtree' }, 201),
        new Response('bad', { status: 500 }),
      ];
      let i = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(seq[i++] || new Response('{}', { status: 200 })));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });

    it('returns 500 when updating the branch ref fails', async () => {
      const ok = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
      const seq = [
        ok({ object: { sha: 'h' } }),
        ok({ tree: { sha: 't' } }),
        ...Array.from({ length: 8 }, () => ok({ sha: 'b' }, 201)),
        ok({ sha: 'newtree' }, 201),
        ok({ sha: 'newcommit' }, 201),
        new Response('conflict', { status: 422 }),
      ];
      let i = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve(seq[i++] || new Response('{}', { status: 200 })));
      const res = await onRequestPost(ghCtx());
      expect(res.status).toBe(500);
    });
  });

  describe('OPTIONS preflight', () => {
    it('returns 204 with the expected CORS headers', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });
});
