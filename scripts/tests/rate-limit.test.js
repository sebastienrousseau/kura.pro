import { describe, it, expect, vi } from 'vitest';

const { checkRateLimit } = await import('../../functions/api/_shared.js');

function makeKV(currentCount = '0') {
  return {
    get: vi.fn().mockResolvedValue(currentCount),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Rate Limiting — checkRateLimit', () => {
  it('allows request when under limit', async () => {
    const kv = makeKV('5');
    const result = await checkRateLimit(kv, 'rl:test:1.2.3.4', 60, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(54); // 60 - 5 - 1
  });

  it('blocks request at limit', async () => {
    const kv = makeKV('60');
    const result = await checkRateLimit(kv, 'rl:test:1.2.3.4', 60, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('blocks request when over limit', async () => {
    const kv = makeKV('100');
    const result = await checkRateLimit(kv, 'rl:test:1.2.3.4', 60, 60);
    expect(result.allowed).toBe(false);
  });

  it('returns correct remaining count', async () => {
    const kv = makeKV('0');
    const result = await checkRateLimit(kv, 'rl:test:key', 10, 60);
    expect(result.remaining).toBe(9); // 10 - 0 - 1
    expect(result.limit).toBe(10);
  });

  it('increments counter on allowed request', async () => {
    const kv = makeKV('5');
    await checkRateLimit(kv, 'rl:test:key', 60, 60);
    expect(kv.put).toHaveBeenCalledWith('rl:test:key', '6', { expirationTtl: 60 });
  });

  it('does not increment counter on blocked request', async () => {
    const kv = makeKV('60');
    await checkRateLimit(kv, 'rl:test:key', 60, 60);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('handles missing KV gracefully (returns allowed)', async () => {
    const result = await checkRateLimit(null, 'rl:test:key', 60, 60);
    expect(result.allowed).toBe(true);
  });

  it('handles undefined KV gracefully', async () => {
    const result = await checkRateLimit(undefined, 'rl:test:key', 60, 60);
    expect(result.allowed).toBe(true);
  });

  it('uses correct expiration TTL', async () => {
    const kv = makeKV('0');
    await checkRateLimit(kv, 'rl:test:key', 100, 120);
    expect(kv.put).toHaveBeenCalledWith('rl:test:key', '1', { expirationTtl: 120 });
  });

  it('handles first request (null count)', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const result = await checkRateLimit(kv, 'rl:test:new', 60, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(59);
    expect(kv.put).toHaveBeenCalledWith('rl:test:new', '1', { expirationTtl: 60 });
  });

  it('allows exactly limit-1 requests', async () => {
    const kv = makeKV('59');
    const result = await checkRateLimit(kv, 'rl:test:key', 60, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('returns limit in result', async () => {
    const kv = makeKV('10');
    const result = await checkRateLimit(kv, 'rl:test:key', 100, 60);
    expect(result.limit).toBe(100);
  });

  // --- Extended tests ---

  it('handles KV.get returning non-numeric string gracefully', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue('not-a-number'),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const result = await checkRateLimit(kv, 'rl:test:key', 60, 60);
    // parseInt('not-a-number') is NaN, treated as 0
    expect(result.allowed).toBe(true);
  });

  it('handles KV.get returning empty string', async () => {
    const kv = {
      get: vi.fn().mockResolvedValue(''),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const result = await checkRateLimit(kv, 'rl:test:key', 60, 60);
    expect(result.allowed).toBe(true);
  });

  it('remaining never goes below 0', async () => {
    const kv = makeKV('60');
    const result = await checkRateLimit(kv, 'rl:test:key', 60, 60);
    expect(result.remaining).toBe(0);
  });

  it('works with limit of 1', async () => {
    const kv = makeKV('0');
    const result = await checkRateLimit(kv, 'rl:test:key', 1, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('blocks with limit of 1 when already at 1', async () => {
    const kv = makeKV('1');
    const result = await checkRateLimit(kv, 'rl:test:key', 1, 60);
    expect(result.allowed).toBe(false);
  });

  it('works with very high limit', async () => {
    const kv = makeKV('999999');
    const result = await checkRateLimit(kv, 'rl:test:key', 1000000, 3600);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('handles concurrent rate limit checks', async () => {
    const kv = makeKV('50');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkRateLimit(kv, 'rl:test:key', 60, 60))
    );
    // All should be allowed since we start at 50 < 60
    for (const result of results) {
      expect(result.allowed).toBe(true);
    }
  });

  it('uses different keys for different IPs', async () => {
    const kv = makeKV('0');
    await checkRateLimit(kv, 'rl:test:1.2.3.4', 60, 60);
    await checkRateLimit(kv, 'rl:test:5.6.7.8', 60, 60);
    expect(kv.get).toHaveBeenCalledWith('rl:test:1.2.3.4');
    expect(kv.get).toHaveBeenCalledWith('rl:test:5.6.7.8');
  });

  it('expiration TTL is passed correctly for long durations', async () => {
    const kv = makeKV('0');
    await checkRateLimit(kv, 'rl:test:key', 100, 86400);
    expect(kv.put).toHaveBeenCalledWith('rl:test:key', '1', { expirationTtl: 86400 });
  });
});
