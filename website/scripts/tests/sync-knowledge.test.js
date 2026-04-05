import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { chunkText, embedTexts, upsertVectors, main } from '../sync-knowledge.mjs';

describe('chunkText', () => {
  it('returns a single chunk for short text', () => {
    const chunks = chunkText('This is a short sentence. And another one.', 'test.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('This is a short sentence. And another one.');
    expect(chunks[0].source).toBe('test.md');
  });

  it('splits long text into multiple chunks', () => {
    const sentences = [];
    for (let i = 0; i < 60; i++) {
      sentences.push(`This is sentence number ${i} with enough words to take up space.`);
    }
    const chunks = chunkText(sentences.join(' '), 'long.md');
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('preserves source metadata across all chunks', () => {
    const sentences = [];
    for (let i = 0; i < 80; i++) {
      sentences.push(`Sentence ${i} has several words in it to fill up the token count quickly.`);
    }
    const chunks = chunkText(sentences.join(' '), 'multi.md');
    for (const chunk of chunks) {
      expect(chunk.source).toBe('multi.md');
      expect(chunk.content).toBeTruthy();
    }
  });

  it('creates overlap between chunks', () => {
    const sentences = [];
    for (let i = 0; i < 80; i++) {
      sentences.push(`Unique sentence number ${i} containing multiple words for proper chunking.`);
    }
    const chunks = chunkText(sentences.join(' '), 'overlap.md', 50, 20);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const lastWordsOfFirst = chunks[0].content.split(' ').slice(-5).join(' ');
    expect(chunks[1].content).toContain(lastWordsOfFirst);
  });

  it('handles empty text', () => {
    const chunks = chunkText('', 'empty.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('');
  });

  it('handles text with no sentence boundaries', () => {
    // Very long text with no periods — single "sentence"
    const words = Array(600).fill('word').join(' ');
    const chunks = chunkText(words, 'noperiod.md');
    // Won't split because it's all one "sentence"
    expect(chunks).toHaveLength(1);
  });
});

describe('embedTexts', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns embedding data on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, result: { data: [[0.1, 0.2]] } }),
    });
    const result = await embedTexts(['hello'], 'https://api.cf.com', { Authorization: 'Bearer x' });
    expect(result).toEqual([[0.1, 0.2]]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.cf.com/ai/run/@cf/baai/bge-base-en-v1.5',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on embedding failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, errors: ['bad'] }),
    });
    await expect(embedTexts(['hello'], 'https://api.cf.com', {})).rejects.toThrow('Embedding failed');
  });
});

describe('upsertVectors', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns result on success', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: true, result: { count: 1 } }),
    });
    const result = await upsertVectors([{ id: 'a', values: [0.1] }], 'https://api.cf.com', 'tok');
    expect(result).toEqual({ count: 1 });
    const call = globalThis.fetch.mock.calls[0];
    expect(call[0]).toContain('/vectorize/v2/indexes/cloudcdn-knowledge/upsert');
    expect(call[1].headers['Content-Type']).toBe('application/x-ndjson');
  });

  it('throws on upsert failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false, errors: ['fail'] }),
    });
    await expect(upsertVectors([{ id: 'a' }], 'https://api.cf.com', 'tok')).rejects.toThrow('Upsert failed');
  });
});

describe('main', () => {
  const originalFetch = globalThis.fetch;
  const originalExit = process.exit;
  const originalArgv = process.argv;
  let tmpDir;

  beforeEach(() => {
    process.exit = vi.fn((code) => { throw new Error(`process.exit(${code})`); });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.exit = originalExit;
    process.argv = originalArgv;
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('exits when env vars are missing', async () => {
    const origAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const origToken = process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;

    try {
      await expect(main()).rejects.toThrow('process.exit(1)');
    } finally {
      if (origAccount) process.env.CLOUDFLARE_ACCOUNT_ID = origAccount;
      if (origToken) process.env.CLOUDFLARE_API_TOKEN = origToken;
    }
  });

  it('exits when content directory does not exist', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-id';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.argv = ['node', 'sync-knowledge.mjs', '/nonexistent-dir-xyz'];

    try {
      await expect(main()).rejects.toThrow('process.exit(1)');
    } finally {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });

  it('processes files, embeds, and upserts successfully', async () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-id';
    process.env.CLOUDFLARE_API_TOKEN = 'test-token';
    process.argv = ['node', 'sync-knowledge.mjs', tmpDir];

    // Create some markdown files
    fs.writeFileSync(path.join(tmpDir, 'doc1.md'), 'CloudCDN is a CDN service. It is fast.');
    fs.writeFileSync(path.join(tmpDir, 'doc2.md'), 'Pricing is simple. Free tier available.');
    // Non-md file should be skipped
    fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'skip me');

    globalThis.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/ai/run/')) {
        return Promise.resolve({
          json: () => Promise.resolve({
            success: true,
            result: { data: [[0.1, 0.2], [0.3, 0.4]] },
          }),
        });
      }
      if (url.includes('/vectorize/')) {
        return Promise.resolve({
          json: () => Promise.resolve({ success: true, result: { count: 2 } }),
        });
      }
      return Promise.reject(new Error('unexpected URL'));
    });

    try {
      await main();
      // Verify fetch was called for embedding and upserting
      const calls = globalThis.fetch.mock.calls;
      const embedCalls = calls.filter(([url]) => url.includes('/ai/run/'));
      const upsertCalls = calls.filter(([url]) => url.includes('/vectorize/'));
      expect(embedCalls.length).toBeGreaterThanOrEqual(1);
      expect(upsertCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  });
});
