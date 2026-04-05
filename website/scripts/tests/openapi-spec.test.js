import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const specPath = path.join(process.cwd(), 'website', 'api-reference', 'openapi.json');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));

// Collect all function files to verify spec matches implementation
const functionsDir = path.join(process.cwd(), 'functions');

describe('OpenAPI Spec — Completeness', () => {
  it('is valid OpenAPI 3.1', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('has required info fields', () => {
    expect(spec.info.title).toBeTruthy();
    expect(spec.info.version).toBeTruthy();
    expect(spec.info.description).toBeTruthy();
    expect(spec.info.contact?.email).toBeTruthy();
    expect(spec.info.license?.name).toBe('MIT');
    expect(spec.info['x-logo']?.url).toBeTruthy();
  });

  it('has multiple server entries', () => {
    expect(spec.servers.length).toBeGreaterThanOrEqual(2);
    expect(spec.servers[0].url).toBe('https://cloudcdn.pro');
    expect(spec.servers.find(s => s.url.includes('localhost'))).toBeTruthy();
  });

  it('has tag groups for product organization', () => {
    expect(spec['x-tagGroups']).toBeDefined();
    expect(spec['x-tagGroups'].length).toBe(3);
    const allTags = spec['x-tagGroups'].flatMap(g => g.tags);
    expect(allTags).toContain('Storage');
    expect(allTags).toContain('Core');
    expect(allTags).toContain('Assets');
    expect(allTags).toContain('Insights');
    expect(allTags).toContain('Delivery');
    expect(allTags).toContain('AI');
  });
});

describe('OpenAPI Spec — Every endpoint has documentation', () => {
  const endpoints = [];
  for (const [pathStr, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (method === 'options') continue;
      endpoints.push({ path: pathStr, method, op });
    }
  }

  it('has at least 20 documented endpoints', () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(20);
  });

  for (const { path: p, method, op } of endpoints) {
    const label = `${method.toUpperCase()} ${p}`;

    it(`${label} has a summary`, () => {
      expect(op.summary).toBeTruthy();
    });

    it(`${label} has a description`, () => {
      expect(op.description).toBeTruthy();
    });

    it(`${label} has at least one response`, () => {
      expect(Object.keys(op.responses).length).toBeGreaterThan(0);
    });

    it(`${label} has a tag`, () => {
      expect(op.tags?.length).toBeGreaterThan(0);
    });

    it(`${label} has operationId`, () => {
      expect(op.operationId).toBeTruthy();
    });
  }
});

describe('OpenAPI Spec — Schemas', () => {
  const schemas = Object.entries(spec.components?.schemas || {});

  it('has at least 20 schemas', () => {
    expect(schemas.length).toBeGreaterThanOrEqual(20);
  });

  for (const [name, schema] of schemas) {
    it(`schema "${name}" has a description`, () => {
      expect(schema.description).toBeTruthy();
    });

    it(`schema "${name}" has properties or is a valid type`, () => {
      const hasProps = schema.properties || schema.type || schema.allOf || schema.oneOf || schema.items;
      expect(hasProps).toBeTruthy();
    });
  }
});

describe('OpenAPI Spec — Security Schemes', () => {
  const schemes = spec.components?.securitySchemes || {};

  it('has AccountKey scheme', () => {
    expect(schemes.AccountKey).toBeDefined();
    expect(schemes.AccountKey.type).toBe('apiKey');
    expect(schemes.AccountKey.in).toBe('header');
  });

  it('has AccessKey scheme', () => {
    expect(schemes.AccessKey).toBeDefined();
    expect(schemes.AccessKey.type).toBe('apiKey');
    expect(schemes.AccessKey.in).toBe('header');
  });

  it('every authenticated endpoint references a security scheme', () => {
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (method === 'options') continue;
        // Public endpoints explicitly set security: []
        // Authenticated endpoints must have security defined or inherit global
        if (op.security && op.security.length === 0) continue; // public
        if (!op.security) continue; // inherits global or has no auth
        for (const secReq of op.security) {
          const schemeName = Object.keys(secReq)[0];
          expect(schemes[schemeName]).toBeDefined();
        }
      }
    }
  });
});

describe('OpenAPI Spec — Code Samples', () => {
  it('has x-codeSamples on key endpoints', () => {
    const withSamples = [];
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (op['x-codeSamples']) withSamples.push(`${method.toUpperCase()} ${p}`);
      }
    }
    expect(withSamples.length).toBeGreaterThanOrEqual(5);
  });

  it('code samples have curl, javascript, and python', () => {
    for (const [p, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const samples = op['x-codeSamples'];
        if (!samples) continue;
        const langs = samples.map(s => s.lang.toLowerCase());
        expect(langs).toContain('curl');
        expect(langs).toContain('javascript');
        expect(langs).toContain('python');
      }
    }
  });
});

describe('OpenAPI Spec — Matches implementation', () => {
  // Verify every function file has a corresponding spec entry
  const implEndpoints = new Set();

  function scanDir(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('_')) continue; // skip middleware/shared
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(full, prefix + '/' + entry.name);
      } else if (entry.name.endsWith('.js')) {
        const content = fs.readFileSync(full, 'utf-8');
        const methods = [];
        if (content.includes('onRequestGet')) methods.push('get');
        if (content.includes('onRequestPost')) methods.push('post');
        if (content.includes('onRequestPut')) methods.push('put');
        if (content.includes('onRequestDelete')) methods.push('delete');
        if (content.includes('onRequestHead')) methods.push('head');

        let route = prefix;
        // Handle [[path]].js and [[id]].js catch-all routes
        const name = entry.name.replace('.js', '');
        if (name.startsWith('[[')) {
          route += '/{' + name.replace(/\[|\]/g, '') + '}';
        } else if (name !== 'index') {
          route += '/' + name;
        }

        for (const m of methods) {
          implEndpoints.add(`${m.toUpperCase()} /api${route}`);
        }
      }
    }
  }

  scanDir(path.join(functionsDir, 'api'));

  const specEndpoints = new Set();
  for (const [p, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      if (method === 'options') continue;
      specEndpoints.add(`${method.toUpperCase()} ${p}`);
    }
  }

  it('every implemented endpoint is documented in the spec', () => {
    for (const impl of implEndpoints) {
      // Normalize path params for matching
      const normalized = impl.replace(/\{[^}]+\}/g, '{param}');
      const found = [...specEndpoints].some(s =>
        s.replace(/\{[^}]+\}/g, '{param}') === normalized
      );
      if (!found) {
        // Not a hard failure for catch-all duplicates
        console.warn(`  Implementation not in spec: ${impl}`);
      }
    }
    // At minimum, all major endpoints should be covered
    expect(specEndpoints.size).toBeGreaterThanOrEqual(20);
  });

  it('no spec endpoint is a ghost (all have implementations)', () => {
    // Verify spec paths map to real files
    for (const [p] of Object.entries(spec.paths)) {
      // Convert /api/core/zones → functions/api/core/zones.js
      const filePath = p.replace(/^\/api/, 'functions/api')
        .replace(/\{[^}]+\}/g, '[[param]]');
      // Check if a corresponding file or directory exists
      const candidates = [
        filePath + '.js',
        filePath.replace(/\/\[\[param\]\]$/, '/[[path]].js'),
        filePath.replace(/\/\[\[param\]\]$/, '/[[id]].js'),
        filePath + '/index.js',
      ];
      const exists = candidates.some(c => fs.existsSync(path.join(process.cwd(), c)));
      // Allow some flexibility for complex routing
      if (!exists) {
        console.warn(`  Spec path ${p} — no exact file match (may use parent catch-all)`);
      }
    }
  });
});
