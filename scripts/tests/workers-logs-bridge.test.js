/**
 * Unit tests for the Workers Logs tail bridge helper.
 *
 * The bridge itself (the WebSocket forwarding loop inside tail.js
 * startTail) is marked v8-ignore in its container; the pure pieces
 * exposed from _workers_logs_bridge.js are individually testable here.
 */
import { describe, it, expect, vi } from 'vitest';

const mod = await import('../../functions/api/logs/_workers_logs_bridge.js');
const tail = await import('../../functions/api/logs/tail.js');

describe('bridgeAvailable', () => {
  it('false when CF_API_TOKEN is missing', () => {
    expect(mod.bridgeAvailable({ CF_ACCOUNT_ID: 'a' })).toBe(false);
  });
  it('false when CF_ACCOUNT_ID is missing', () => {
    expect(mod.bridgeAvailable({ CF_API_TOKEN: 't' })).toBe(false);
  });
  it('false when env is null/undefined', () => {
    expect(mod.bridgeAvailable(null)).toBe(false);
    expect(mod.bridgeAvailable(undefined)).toBe(false);
  });
  it('true when both are set', () => {
    expect(mod.bridgeAvailable({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' })).toBe(true);
  });
});

describe('createTailSession', () => {
  function makeFetch(impl) { return vi.fn(impl); }

  it('throws when the bridge is unavailable', async () => {
    await expect(mod.createTailSession({})).rejects.toThrow(/unavailable/);
  });

  it('throws on non-2xx', async () => {
    const fetchImpl = makeFetch(async () => new Response('forbidden', { status: 403 }));
    await expect(mod.createTailSession({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' }, { fetchImpl })).rejects.toThrow(/403/);
  });

  it('throws when the response is missing a url', async () => {
    const fetchImpl = makeFetch(async () => new Response(JSON.stringify({ result: {} }), { status: 200 }));
    await expect(mod.createTailSession({ CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' }, { fetchImpl })).rejects.toThrow(/no url/);
  });

  it('returns { url, id } on success', async () => {
    const fetchImpl = makeFetch(async (url, opts) => {
      expect(url).toContain('/accounts/acct-1/workers/scripts/cloudcdn-pro/tails');
      expect(opts.headers.Authorization).toBe('Bearer my-token');
      return new Response(JSON.stringify({ result: { url: 'wss://tail.x/y', id: 'sess-1' } }), { status: 200 });
    });
    const out = await mod.createTailSession(
      { CF_API_TOKEN: 'my-token', CF_ACCOUNT_ID: 'acct-1' },
      { fetchImpl },
    );
    expect(out.url).toBe('wss://tail.x/y');
    expect(out.id).toBe('sess-1');
  });

  it('honours LOGS_SCRIPT_NAME override', async () => {
    let calledUrl = '';
    const fetchImpl = makeFetch(async (url) => {
      calledUrl = url;
      return new Response(JSON.stringify({ result: { url: 'wss://x/y' } }), { status: 200 });
    });
    await mod.createTailSession(
      { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a', LOGS_SCRIPT_NAME: 'staging-worker' },
      { fetchImpl },
    );
    expect(calledUrl).toContain('/scripts/staging-worker/tails');
  });
});

describe('eventBelongsToAccount', () => {
  it('false on null/empty inputs', () => {
    expect(mod.eventBelongsToAccount(null, 'a')).toBe(false);
    expect(mod.eventBelongsToAccount({}, '')).toBe(false);
  });
  it('matches request URL containing the account id', () => {
    const ev = { event: { request: { url: 'https://cloudcdn.pro/api/x?acct=my-acct-123' } } };
    expect(mod.eventBelongsToAccount(ev, 'my-acct-123')).toBe(true);
  });
  it('matches the cf-account-id header', () => {
    const ev = { event: { request: { headers: { 'cf-account-id': 'acct-x' }, url: 'https://example.com/' } } };
    expect(mod.eventBelongsToAccount(ev, 'acct-x')).toBe(true);
  });
  it('matches a log message containing the account id', () => {
    const ev = { logs: [{ message: ['user acct-y signed in'] }] };
    expect(mod.eventBelongsToAccount(ev, 'acct-y')).toBe(true);
  });
  it('false when none match', () => {
    const ev = { event: { request: { url: 'https://x' } }, logs: [{ message: ['nope'] }] };
    expect(mod.eventBelongsToAccount(ev, 'acct-z')).toBe(false);
  });
  it('tolerates non-string log messages', () => {
    const ev = { logs: [{ message: [{ foo: 'bar' }, null, 42] }] };
    expect(mod.eventBelongsToAccount(ev, 'acct')).toBe(false);
  });
  it('tolerates missing logs / non-array shape', () => {
    expect(mod.eventBelongsToAccount({ logs: null }, 'a')).toBe(false);
    expect(mod.eventBelongsToAccount({ logs: [null] }, 'a')).toBe(false);
  });
});

describe('mapWorkersLogEvent', () => {
  it('maps a typical event', () => {
    const ev = {
      outcome: 'ok',
      eventTimestamp: 12345678,
      event: { request: { url: 'https://cloudcdn.pro/api/x', method: 'GET' } },
      logs: [{ level: 'info', message: ['hello'] }],
      exceptions: [],
    };
    const out = mod.mapWorkersLogEvent(ev);
    expect(out.type).toBe('worker_log');
    expect(out.outcome).toBe('ok');
    expect(out.requestUrl).toBe('https://cloudcdn.pro/api/x');
    expect(out.requestMethod).toBe('GET');
    expect(out.logLevel).toBe('info');
    expect(out.message).toBe('hello');
    expect(out.createdAt).toBe(Math.floor(12345678 / 1000));
  });

  it('maps multi-part messages and survives null/object members', () => {
    const ev = { logs: [{ message: ['a', null, { x: 1 }] }] };
    const out = mod.mapWorkersLogEvent(ev);
    expect(out.message).toContain('a');
    expect(out.message).toContain('null');
    expect(out.message).toContain('{"x":1}');
  });

  it('falls back to Date.now() when eventTimestamp is missing', () => {
    const out = mod.mapWorkersLogEvent({});
    expect(typeof out.createdAt).toBe('number');
    expect(out.createdAt).toBeGreaterThan(0);
  });

  it('collects exceptions', () => {
    const out = mod.mapWorkersLogEvent({ exceptions: [{ name: 'TypeError', message: 'oops' }] });
    expect(out.exceptions).toEqual([{ name: 'TypeError', message: 'oops' }]);
  });

  it('returns null message when logs is empty/missing', () => {
    expect(mod.mapWorkersLogEvent({}).message).toBeNull();
    expect(mod.mapWorkersLogEvent({ logs: [] }).message).toBeNull();
  });

  it('coerces JSON.stringify failures by using String()', () => {
    const cyclic = {};
    cyclic.self = cyclic;
    const out = mod.mapWorkersLogEvent({ logs: [{ message: [cyclic] }] });
    expect(typeof out.message).toBe('string');
  });
});

describe('tail.decideSource', () => {
  it('defaults to audit when no source is requested', () => {
    expect(tail.decideSource({}, {})).toBe('audit');
  });
  it('returns audit when workers requested but bridge unavailable', () => {
    expect(tail.decideSource({}, { requested: 'workers' })).toBe('audit');
  });
  it('returns workers when requested AND bridge available', () => {
    const env = { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' };
    expect(tail.decideSource(env, { requested: 'workers' })).toBe('workers');
  });
  it('"auto" picks workers when bridge available', () => {
    const env = { CF_API_TOKEN: 't', CF_ACCOUNT_ID: 'a' };
    expect(tail.decideSource(env, { requested: 'auto' })).toBe('workers');
  });
  it('"auto" falls back to audit when bridge unavailable', () => {
    expect(tail.decideSource({}, { requested: 'auto' })).toBe('audit');
  });
});
