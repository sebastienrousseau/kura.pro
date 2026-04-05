import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const specPath = path.join(process.cwd(), 'website', 'api-reference', 'openapi.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

describe('Scalar DX — Zero Dead Ends', () => {
  const endpoints = [];
  for (const [pathStr, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (method === 'options') continue;
      endpoints.push({ path: pathStr, method, op, label: `${method.toUpperCase()} ${pathStr}` });
    }
  }

  describe('every endpoint has standard error responses', () => {
    for (const { label, op } of endpoints) {
      it(`${label} has 400 response`, () => {
        expect(op.responses['400']).toBeDefined();
        expect(op.responses['400'].description).toBeTruthy();
      });

      it(`${label} has 429 response`, () => {
        expect(op.responses['429']).toBeDefined();
      });

      it(`${label} has 500 response`, () => {
        expect(op.responses['500']).toBeDefined();
      });
    }
  });

  describe('authenticated endpoints have 401 response', () => {
    for (const { label, op } of endpoints) {
      if (op.security && op.security.length > 0) {
        it(`${label} has 401 response`, () => {
          expect(op.responses['401']).toBeDefined();
        });
      }
    }
  });

  describe('write endpoints have 502 response', () => {
    for (const { label, method, op } of endpoints) {
      if (['put', 'post', 'delete'].includes(method) && op.responses) {
        it(`${label} has 502 response`, () => {
          expect(op.responses['502']).toBeDefined();
        });
      }
    }
  });

  describe('every error response has an example', () => {
    for (const { label, op } of endpoints) {
      for (const [code, resp] of Object.entries(op.responses)) {
        if (parseInt(code) >= 400 && resp.content?.['application/json']) {
          it(`${label} → ${code} has example`, () => {
            expect(resp.content['application/json'].example).toBeDefined();
          });
        }
      }
    }
  });
});

describe('Scalar DX — Client Library Downloads', () => {
  const clientDir = path.join(process.cwd(), 'website', 'api-reference', 'clients');

  for (const file of ['javascript.js', 'typescript.ts', 'python.py', 'curl.sh']) {
    it(`${file} exists and is non-empty`, () => {
      const filePath = path.join(clientDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(100);
    });
  }
});

describe('Scalar DX — Spec Quality', () => {
  it('servers include both production and local dev', () => {
    expect(spec.servers.find(s => s.url === 'https://cloudcdn.pro')).toBeDefined();
    expect(spec.servers.find(s => s.url.includes('localhost'))).toBeDefined();
  });

  it('has x-tagGroups for Scalar sidebar grouping', () => {
    expect(spec['x-tagGroups']).toBeDefined();
    expect(spec['x-tagGroups'].length).toBeGreaterThanOrEqual(3);
  });

  it('has x-codeSamples on at least 5 endpoints', () => {
    let count = 0;
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        if (op['x-codeSamples']) count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(5);
  });

  it('ErrorResponse schema is fully typed', () => {
    const err = spec.components.schemas.ErrorResponse;
    expect(err).toBeDefined();
    expect(err.properties.HttpCode).toBeDefined();
    expect(err.properties.Message).toBeDefined();
    expect(err.required).toContain('HttpCode');
    expect(err.required).toContain('Message');
  });

  it('info.description contains Client Libraries section', () => {
    expect(spec.info.description).toContain('Client Libraries');
    expect(spec.info.description).toContain('JavaScript');
    expect(spec.info.description).toContain('TypeScript');
    expect(spec.info.description).toContain('Python');
    expect(spec.info.description).toContain('cURL');
  });

  it('info.description contains Authentication section', () => {
    expect(spec.info.description).toContain('Authentication');
    expect(spec.info.description).toContain('AccessKey');
    expect(spec.info.description).toContain('AccountKey');
  });

  it('info.description contains Rate Limits section', () => {
    expect(spec.info.description).toContain('Rate Limits');
  });

  it('total response codes >= 150 (full coverage)', () => {
    let total = 0;
    for (const methods of Object.values(spec.paths)) {
      for (const op of Object.values(methods)) {
        if (op.responses) total += Object.keys(op.responses).length;
      }
    }
    expect(total).toBeGreaterThanOrEqual(150);
  });
});
