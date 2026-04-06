/**
 * Cache behavior — verifies manifest cache behavior in _shared.js.
 *
 * Tests: first call fetches, second returns cached, cache survives many calls,
 * clearManifestCache forces refresh, different env objects get same cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getManifest,
  clearManifestCache,
} from '../../functions/api/_shared.js';

const manifestData = [
  { name: 'logo.svg', path: 'akande/v1/logos/logo.svg', project: 'akande', category: 'logos', format: 'svg', size: 3400 },
];

function makeEnv() {
  return {
    ASSETS: {
      fetch: vi.fn().mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify(manifestData), { status: 200 }))
      ),
    },
  };
}

beforeEach(() => clearManifestCache());

describe('Cache — First call fetches, second returns cached', () => {
  it('first call invokes ASSETS.fetch', async () => {
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('second call returns cached without ASSETS.fetch', async () => {
    const env = makeEnv();
    const result1 = await getManifest(env, 'https://cdn.pro');
    const result2 = await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    expect(result1).toEqual(result2);
  });

  it('cached result is identical reference', async () => {
    const env = makeEnv();
    const result1 = await getManifest(env, 'https://cdn.pro');
    const result2 = await getManifest(env, 'https://cdn.pro');
    expect(result1).toBe(result2);
  });
});

describe('Cache — Cache survives 100 calls', () => {
  it('only fetches once across 100 calls', async () => {
    const env = makeEnv();
    for (let i = 0; i < 100; i++) {
      await getManifest(env, 'https://cdn.pro');
    }
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Cache — clearManifestCache forces refresh', () => {
  it('fetch is called again after clearing cache', async () => {
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);

    clearManifestCache();

    await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(2);
  });

  it('multiple clears are idempotent', async () => {
    clearManifestCache();
    clearManifestCache();
    clearManifestCache();
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('cache returns fresh data after clear and re-fetch with updated content', async () => {
    const env1 = makeEnv();
    const result1 = await getManifest(env1, 'https://cdn.pro');
    expect(result1).toEqual(manifestData);

    clearManifestCache();

    const updatedData = [{ name: 'updated.png', path: 'new/updated.png', project: 'new', category: 'icons', format: 'png', size: 999 }];
    const env2 = {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(updatedData), { status: 200 })),
      },
    };
    const result2 = await getManifest(env2, 'https://cdn.pro');
    expect(result2).toEqual(updatedData);
    expect(result2).not.toEqual(result1);
  });
});

describe('Cache — Different env objects get same cache', () => {
  it('two different env objects share the isolate-scoped cache', async () => {
    const env1 = makeEnv();
    const env2 = makeEnv();

    await getManifest(env1, 'https://cdn.pro');
    expect(env1.ASSETS.fetch).toHaveBeenCalledTimes(1);

    // Second call with different env object should still use cache
    await getManifest(env2, 'https://cdn.pro');
    expect(env2.ASSETS.fetch).toHaveBeenCalledTimes(0);
  });

  it('different requestUrl strings still use the same cache', async () => {
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro/page1');
    await getManifest(env, 'https://cdn.pro/page2');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Cache — Extended scenarios', () => {
  it('clearManifestCache followed by getManifest triggers re-fetch', async () => {
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro');
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);

    clearManifestCache();
    const env2 = makeEnv();
    await getManifest(env2, 'https://cdn.pro');
    expect(env2.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('cache returns array type', async () => {
    const env = makeEnv();
    const result = await getManifest(env, 'https://cdn.pro');
    expect(Array.isArray(result)).toBe(true);
  });

  it('cached result is same reference on second call', async () => {
    const env = makeEnv();
    const a = await getManifest(env, 'https://cdn.pro');
    const b = await getManifest(env, 'https://cdn.pro');
    expect(a).toBe(b);
  });

  it('multiple clearManifestCache calls do not crash', () => {
    clearManifestCache();
    clearManifestCache();
    clearManifestCache();
    // Should not throw
  });

  it('getManifest after clear returns fresh data', async () => {
    const env1 = makeEnv();
    const result1 = await getManifest(env1, 'https://cdn.pro');

    clearManifestCache();

    const env2 = {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify([{ name: 'new.svg' }]), { status: 200 })
        ),
      },
    };
    const result2 = await getManifest(env2, 'https://cdn.pro');
    expect(result2).not.toBe(result1);
    expect(result2[0].name).toBe('new.svg');
  });

  it('fetches manifest.json from ASSETS', async () => {
    const env = makeEnv();
    await getManifest(env, 'https://cdn.pro');
    const call = env.ASSETS.fetch.mock.calls[0];
    expect(call[0].toString()).toContain('manifest.json');
  });

  it('10 sequential calls only fetch once', async () => {
    const env = makeEnv();
    for (let i = 0; i < 10; i++) {
      await getManifest(env, `https://cdn.pro/path${i}`);
    }
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });
});
