/**
 * Unit tests for cdn/en/dist/stratos/stratos.mjs — the Stratos CLI.
 *
 * Strategy:
 *   - fetch is stubbed globally per-test.
 *   - process.stdout.write is spied on so we can assert printed output.
 *   - process.exit is mocked to throw `EXIT:<code>` so a non-zero exit
 *     becomes a catchable error inside the test rather than tearing
 *     down vitest.
 *   - process.env is set/reset per-test for the env-driven config.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STRATOS = '../../cdn/en/dist/stratos/stratos.mjs';

let originalFetch;
let originalEnv;
let stdoutSpy;
let exitSpy;

beforeEach(async () => {
  originalFetch = globalThis.fetch;
  originalEnv = { ...process.env };
  // Reset to a known clean set; tests opt-in to specific env values.
  delete process.env.CLOUDCDN_URL;
  delete process.env.CLOUDCDN_ACCOUNT_KEY;
  delete process.env.CLOUDCDN_ACCESS_KEY;
  delete process.env.SIGNED_URL_SECRET;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`EXIT:${code}`);
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = originalEnv;
  stdoutSpy.mockRestore();
  exitSpy.mockRestore();
  vi.resetModules();
});

function mockFetch(response) {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(
    typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
    {
      status: response.status ?? 200,
      headers: response.headers ?? { 'content-type': 'application/json' },
    },
  ));
}

describe('parseFlags', () => {
  it('splits positional args from --flags with values', async () => {
    const { parseFlags } = await import(STRATOS);
    const out = parseFlags(['a', '--foo=bar', 'b', '--qux', 'val']);
    expect(out.positional).toEqual(['a', 'b']);
    expect(out.flags).toEqual({ foo: 'bar', qux: 'val' });
  });

  it('treats a flag followed by another flag as boolean true', async () => {
    const { parseFlags } = await import(STRATOS);
    const out = parseFlags(['--deep', '--days=7']);
    expect(out.flags.deep).toBe(true);
    expect(out.flags.days).toBe('7');
  });

  it('handles flag at end with no following value', async () => {
    const { parseFlags } = await import(STRATOS);
    const out = parseFlags(['--solo']);
    expect(out.flags.solo).toBe(true);
  });

  it('preserves order of positional args', async () => {
    const { parseFlags } = await import(STRATOS);
    const out = parseFlags(['x', 'y', 'z']);
    expect(out.positional).toEqual(['x', 'y', 'z']);
  });
});

describe('jsonReq', () => {
  it('hits the configured CLOUDCDN_URL', async () => {
    process.env.CLOUDCDN_URL = 'https://staging.example';
    mockFetch({ body: { ok: true } });
    const { jsonReq } = await import(STRATOS);
    await jsonReq('/api/health');
    const [url] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('https://staging.example/api/health');
  });

  it('attaches AccountKey when CLOUDCDN_ACCOUNT_KEY is set', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { ok: true } });
    const { jsonReq } = await import(STRATOS);
    await jsonReq('/x');
    const opts = globalThis.fetch.mock.calls[0][1];
    expect(opts.headers.AccountKey).toBe('admin-key');
  });

  it('attaches AccessKey when CLOUDCDN_ACCESS_KEY is set', async () => {
    process.env.CLOUDCDN_ACCESS_KEY = 'read-key';
    mockFetch({ body: { ok: true } });
    const { jsonReq } = await import(STRATOS);
    await jsonReq('/x');
    const opts = globalThis.fetch.mock.calls[0][1];
    expect(opts.headers.AccessKey).toBe('read-key');
  });

  it('returns parsed JSON when response is JSON', async () => {
    mockFetch({ body: { hello: 'world' } });
    const { jsonReq } = await import(STRATOS);
    const r = await jsonReq('/x');
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ hello: 'world' });
  });

  it('returns text body when response is not JSON', async () => {
    mockFetch({ body: 'not json at all', headers: { 'content-type': 'text/plain' } });
    const { jsonReq } = await import(STRATOS);
    const r = await jsonReq('/x');
    expect(r.body).toBe('not json at all');
  });

  it('returns ok=false on 5xx', async () => {
    mockFetch({ body: { error: 'boom' }, status: 503 });
    const { jsonReq } = await import(STRATOS);
    const r = await jsonReq('/x');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it('strips trailing slash from CLOUDCDN_URL', async () => {
    process.env.CLOUDCDN_URL = 'https://example.com/';
    mockFetch({ body: {} });
    const { jsonReq } = await import(STRATOS);
    await jsonReq('/api/x');
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://example.com/api/x');
  });
});

describe('cmdHealth', () => {
  it('calls /api/health by default', async () => {
    mockFetch({ body: { status: 'ok' } });
    const { cmdHealth } = await import(STRATOS);
    await cmdHealth({});
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/api\/health$/);
  });

  it('appends ?deep=1 when --deep flag set', async () => {
    mockFetch({ body: { status: 'ok' } });
    const { cmdHealth } = await import(STRATOS);
    await cmdHealth({ deep: true });
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/api\/health\?deep=1$/);
  });

  it('prints the response body as JSON', async () => {
    mockFetch({ body: { status: 'ok', bindings: { ai: true } } });
    const { cmdHealth } = await import(STRATOS);
    await cmdHealth({});
    const printed = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(printed).toContain('"status": "ok"');
    expect(printed).toContain('"ai": true');
  });

  it('exits 2 on 5xx response', async () => {
    mockFetch({ body: { error: 'boom' }, status: 500 });
    const { cmdHealth } = await import(STRATOS);
    await expect(cmdHealth({})).rejects.toThrow('EXIT:2');
  });

  it('exits 1 on 4xx response', async () => {
    mockFetch({ body: { error: 'nope' }, status: 401 });
    const { cmdHealth } = await import(STRATOS);
    await expect(cmdHealth({})).rejects.toThrow('EXIT:1');
  });
});

describe('cmdPurge', () => {
  it('refuses to run without CLOUDCDN_ACCOUNT_KEY', async () => {
    const { cmdPurge } = await import(STRATOS);
    await expect(cmdPurge(['https://cloudcdn.pro/foo.svg'], {})).rejects.toThrow('EXIT:1');
  });

  it('posts urls payload for positional args', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { success: true, purged: 1 } });
    const { cmdPurge } = await import(STRATOS);
    await cmdPurge(['https://cloudcdn.pro/foo.svg'], {});
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/purge$/);
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ urls: ['https://cloudcdn.pro/foo.svg'] });
    expect(opts.headers['x-api-key']).toBe('admin-key');
  });

  it('posts purge_everything payload when --everything', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { success: true } });
    const { cmdPurge } = await import(STRATOS);
    await cmdPurge([], { everything: true });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ purge_everything: true });
  });

  it('posts tags payload when --tag supplied', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { success: true } });
    const { cmdPurge } = await import(STRATOS);
    await cmdPurge(['type-banner'], { tag: 'project-akande' });
    const payload = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(payload).toEqual({ tags: ['project-akande', 'type-banner'] });
  });

  it('uses --tag array verbatim (ignoring positional tail) when supplied as array', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { success: true } });
    const { cmdPurge } = await import(STRATOS);
    await cmdPurge(['ignored'], { tag: ['a', 'b'] });
    const payload = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(payload).toEqual({ tags: ['a', 'b'] });
  });

  it('refuses without any URL/--tag/--everything', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    const { cmdPurge } = await import(STRATOS);
    await expect(cmdPurge([], {})).rejects.toThrow('EXIT:1');
  });

  it('exits 2 on 5xx', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { error: 'oops' }, status: 502 });
    const { cmdPurge } = await import(STRATOS);
    await expect(cmdPurge(['x'], {})).rejects.toThrow('EXIT:2');
  });

  it('exits 1 on 4xx', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { error: 'unauthorized' }, status: 401 });
    const { cmdPurge } = await import(STRATOS);
    await expect(cmdPurge(['x'], {})).rejects.toThrow('EXIT:1');
  });
});

describe('cmdSigned', () => {
  it('refuses without a path argument', async () => {
    const { cmdSigned } = await import(STRATOS);
    await expect(cmdSigned([], { expires: '1700000000' })).rejects.toThrow('EXIT:1');
  });

  it('refuses without --expires', async () => {
    const { cmdSigned } = await import(STRATOS);
    await expect(cmdSigned(['/x.pdf'], {})).rejects.toThrow('EXIT:1');
  });

  it('refuses without SIGNED_URL_SECRET (or --secret)', async () => {
    const { cmdSigned } = await import(STRATOS);
    await expect(cmdSigned(['/x.pdf'], { expires: '1700000000' })).rejects.toThrow('EXIT:1');
  });

  it('mints a deterministic HMAC-SHA256-signed URL', async () => {
    process.env.SIGNED_URL_SECRET = 'test-secret';
    const { cmdSigned } = await import(STRATOS);
    await cmdSigned(['/clients/akande/private.pdf'], { expires: '1700000000' });
    const printed = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(printed).toContain('https://cloudcdn.pro/api/signed');
    expect(printed).toContain('path=%2Fclients%2Fakande%2Fprivate.pdf');
    expect(printed).toContain('expires=1700000000');
    expect(printed).toMatch(/sig=[0-9a-f]{64}/);
  });

  it('accepts --secret to override env', async () => {
    const { cmdSigned } = await import(STRATOS);
    await cmdSigned(['/x.pdf'], { expires: '1700000000', secret: 'flag-secret' });
    const printed = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(printed).toMatch(/sig=[0-9a-f]{64}/);
  });

  it('emits two different signatures for two different secrets', async () => {
    const { cmdSigned } = await import(STRATOS);
    await cmdSigned(['/x.pdf'], { expires: '1700000000', secret: 'A' });
    const a = stdoutSpy.mock.calls.map(c => c[0]).join('').match(/sig=([0-9a-f]+)/)[1];
    stdoutSpy.mockClear();
    await cmdSigned(['/x.pdf'], { expires: '1700000000', secret: 'B' });
    const b = stdoutSpy.mock.calls.map(c => c[0]).join('').match(/sig=([0-9a-f]+)/)[1];
    expect(a).not.toBe(b);
  });
});

describe('cmdAssets', () => {
  it('passes filters via query string', async () => {
    mockFetch({ body: { Data: [] } });
    const { cmdAssets } = await import(STRATOS);
    await cmdAssets({ project: 'akande', format: 'svg', page: 2 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/assets');
    expect(url.searchParams.get('project')).toBe('akande');
    expect(url.searchParams.get('format')).toBe('svg');
    expect(url.searchParams.get('page')).toBe('2');
  });

  it('calls /api/assets with no params when none supplied', async () => {
    mockFetch({ body: { Data: [] } });
    const { cmdAssets } = await import(STRATOS);
    await cmdAssets({});
    const u = globalThis.fetch.mock.calls[0][0];
    expect(u).toMatch(/\/api\/assets$/);
  });

  it('exits 1 on 4xx', async () => {
    mockFetch({ body: { error: 'unauthorized' }, status: 401 });
    const { cmdAssets } = await import(STRATOS);
    await expect(cmdAssets({})).rejects.toThrow('EXIT:1');
  });

  it('exits 2 on 5xx', async () => {
    mockFetch({ body: { error: 'boom' }, status: 503 });
    const { cmdAssets } = await import(STRATOS);
    await expect(cmdAssets({})).rejects.toThrow('EXIT:2');
  });
});

describe('main entry point', () => {
  async function runMain(args) {
    const original = process.argv;
    process.argv = ['node', 'stratos.mjs', ...args];
    const { main } = await import(STRATOS);
    try {
      await main();
    } finally {
      process.argv = original;
    }
  }

  it('prints help on empty argv', async () => {
    await expect(runMain([])).rejects.toThrow('EXIT:0');
    const printed = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(printed).toContain('stratos v0.1.0 — CloudCDN CLI');
  });

  it('prints help on `help`', async () => {
    await expect(runMain(['help'])).rejects.toThrow('EXIT:0');
    const printed = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(printed).toContain('Usage: stratos');
  });

  it('prints help on -h / --help', async () => {
    await expect(runMain(['-h'])).rejects.toThrow('EXIT:0');
    expect(stdoutSpy.mock.calls.map(c => c[0]).join('')).toContain('Usage:');
  });

  it('prints version on `version` / -v / --version', async () => {
    await runMain(['version']);
    expect(stdoutSpy.mock.calls[0][0]).toMatch(/^stratos v\d+\.\d+\.\d+/);
  });

  it('exits 1 on unknown command', async () => {
    await expect(runMain(['bogus'])).rejects.toThrow('EXIT:1');
  });

  it('routes "health" to cmdHealth', async () => {
    mockFetch({ body: { status: 'ok' } });
    await runMain(['health']);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/api\/health$/);
  });

  it('routes "purge" to cmdPurge', async () => {
    process.env.CLOUDCDN_ACCOUNT_KEY = 'admin-key';
    mockFetch({ body: { success: true } });
    await runMain(['purge', 'https://cloudcdn.pro/x.svg']);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/api\/purge$/);
  });

  it('routes "signed" to cmdSigned', async () => {
    process.env.SIGNED_URL_SECRET = 'sec';
    await runMain(['signed', '/x.pdf', '--expires', '1700000000']);
    expect(stdoutSpy.mock.calls.map(c => c[0]).join('')).toContain('/api/signed?');
  });

  it('routes "assets" to cmdAssets', async () => {
    mockFetch({ body: { Data: [] } });
    await runMain(['assets']);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/\/api\/assets$/);
  });
});
