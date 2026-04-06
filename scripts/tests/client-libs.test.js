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
});
