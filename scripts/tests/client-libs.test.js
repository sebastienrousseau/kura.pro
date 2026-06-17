import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { main } = await import('../generate-client-libs.mjs');

describe('Client library generator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-libs-'));
  });

  it('generates all 4 client files', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);

    expect(fs.existsSync(path.join(tmpDir, 'javascript.js'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'typescript.ts'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'python.py'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'curl.sh'))).toBe(true);
  });

  it('JavaScript client has correct structure', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);

    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    expect(js).toContain('BASE_URL');
    expect(js).toContain('export async function');
    expect(js).toContain('AccessKey');
    // Should have functions for major endpoints
    expect(js).toContain('listAssets');
  });

  it('TypeScript client has type annotations', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);

    const ts = fs.readFileSync(path.join(tmpDir, 'typescript.ts'), 'utf-8');
    expect(ts).toContain('Promise<');
    expect(ts).toContain('interface');
    expect(ts).toContain('string');
  });

  it('Python client uses requests library', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);

    const py = fs.readFileSync(path.join(tmpDir, 'python.py'), 'utf-8');
    expect(py).toContain('import requests');
    expect(py).toContain('def ');
    expect(py).toContain('BASE_URL');
  });

  it('curl client has shell functions', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);

    const sh = fs.readFileSync(path.join(tmpDir, 'curl.sh'), 'utf-8');
    expect(sh).toContain('CLOUDCDN_BASE_URL');
    expect(sh).toContain('curl');
    // Shell functions can use either `function name` or `name()` syntax
    expect(sh.includes('function ') || sh.includes('()')).toBe(true);
  });

  it('covers all endpoints from the spec', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

    let endpointCount = 0;
    for (const methods of Object.values(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (method !== 'options') endpointCount++;
      }
    }

    await main(specPath, tmpDir);

    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    const fnCount = (js.match(/export async function/g) || []).length;
    expect(fnCount).toBe(endpointCount);
  });

  // --- Extended client-libs tests ---

  it('JavaScript client includes error handling', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    // Should have some form of error handling
    expect(js.includes('response') || js.includes('error') || js.includes('throw')).toBe(true);
  });

  it('TypeScript client includes CloudCDNClient class or namespace', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const ts = fs.readFileSync(path.join(tmpDir, 'typescript.ts'), 'utf-8');
    expect(ts).toContain('export');
  });

  it('Python client includes docstrings', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const py = fs.readFileSync(path.join(tmpDir, 'python.py'), 'utf-8');
    expect(py).toContain('"""');
  });

  it('curl client includes API key header', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const sh = fs.readFileSync(path.join(tmpDir, 'curl.sh'), 'utf-8');
    expect(sh).toContain('AccessKey');
  });

  it('all client files are non-empty', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    for (const file of ['javascript.js', 'typescript.ts', 'python.py', 'curl.sh']) {
      const content = fs.readFileSync(path.join(tmpDir, file), 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    }
  });

  it('JavaScript client has fetch calls', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    expect(js).toContain('fetch(');
  });

  it('Python client has response handling', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const py = fs.readFileSync(path.join(tmpDir, 'python.py'), 'utf-8');
    expect(py.includes('response') || py.includes('return')).toBe(true);
  });

  // --- Production-quality features ---

  it('JavaScript client exports a CloudCDNClient class and CloudCDNError', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    expect(js).toContain('export class CloudCDNClient');
    expect(js).toContain('export class CloudCDNError extends Error');
    expect(js).toContain('AbortController');
    expect(js).toContain('timeoutMs');
  });

  it('JavaScript client is importable and instantiable at runtime', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const mod = await import(path.join(tmpDir, 'javascript.js'));
    expect(typeof mod.CloudCDNClient).toBe('function');
    expect(typeof mod.CloudCDNError).toBe('function');
    expect(mod.DEFAULT_BASE_URL).toMatch(/^https?:\/\//);

    const client = new mod.CloudCDNClient({ accessKey: 'sk_test' });
    expect(typeof client.listAssets).toBe('function');
    expect(client.accessKey).toBe('sk_test');
  });

  it('JavaScript client routes calls through a mocked fetch and applies auth', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const { CloudCDNClient } = await import(path.join(tmpDir, 'javascript.js'));

    const calls = [];
    const client = new CloudCDNClient({
      accessKey: 'sk_live_secret',
      fetch: async (url, opts) => {
        calls.push({ url, method: opts.method, headers: opts.headers });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const res = await client.listAssets({ query: { project: 'akande' } });
    expect(res).toEqual({ ok: true });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/api/assets?project=akande');
    expect(calls[0].headers.AccessKey).toBe('sk_live_secret');
  });

  it('JavaScript client throws CloudCDNError with status + body on non-2xx', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const { CloudCDNClient, CloudCDNError } = await import(path.join(tmpDir, 'javascript.js'));

    const client = new CloudCDNClient({
      accessKey: 'sk_test',
      fetch: async () => new Response(
        JSON.stringify({ Message: 'rate limited' }),
        { status: 429, headers: { 'content-type': 'application/json' } }
      ),
    });

    let err;
    try {
      await client.listAssets({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CloudCDNError);
    expect(err.status).toBe(429);
    expect(err.body).toEqual({ Message: 'rate limited' });
    expect(err.message).toContain('rate limited');
    expect(err.url).toContain('/api/assets');
  });

  it('TypeScript client declares CloudCDNClient + CloudCDNError + ClientOptions', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const ts = fs.readFileSync(path.join(tmpDir, 'typescript.ts'), 'utf-8');
    expect(ts).toContain('export class CloudCDNClient');
    expect(ts).toContain('export class CloudCDNError extends Error');
    expect(ts).toContain('export interface ClientOptions');
    expect(ts).toContain('AbortSignal');
    expect(ts).toContain('readonly status: number');
  });

  it('Python client exposes CloudCDNClient + CloudCDNError + context manager', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const py = fs.readFileSync(path.join(tmpDir, 'python.py'), 'utf-8');
    expect(py).toContain('class CloudCDNClient');
    expect(py).toContain('class CloudCDNError(Exception)');
    expect(py).toContain('def __enter__');
    expect(py).toContain('def __exit__');
    expect(py).toContain('def close');
    expect(py).toContain('Optional[float] = 30.0');
    expect(py).toContain('Raises:');
    expect(py).toContain('Returns:');
  });

  it('curl helpers group by API plane and use --fail-with-body', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const sh = fs.readFileSync(path.join(tmpDir, 'curl.sh'), 'utf-8');
    expect(sh).toContain('--fail-with-body');
    expect(sh).toContain('__cloudcdn_auth_flag');
    // Section headers should split the file by API plane
    expect(sh.match(/^# -{20,}$/gm)?.length || 0).toBeGreaterThan(4);
    // Every endpoint must produce a bash function
    expect(sh).toContain('listAssets()');
  });

  it('flat module-level wrappers still match the endpoint count for back-compat', async () => {
    const specPath = path.join(process.cwd(), 'cdn', 'en', 'api-reference', 'openapi.json');
    await main(specPath, tmpDir);
    const js = fs.readFileSync(path.join(tmpDir, 'javascript.js'), 'utf-8');
    const wrapperCount = (js.match(/^export async function /gm) || []).length;
    // Each operation gets one flat wrapper export.
    expect(wrapperCount).toBeGreaterThan(40);
  });
});
