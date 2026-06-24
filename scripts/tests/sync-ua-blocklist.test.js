/**
 * Unit tests for the pure helper in scripts/sync-ua-blocklist.mjs.
 * The fetch/CLI path is intentionally not unit-tested (v8-ignored in
 * the source, covered by the manual `node scripts/sync-ua-blocklist.mjs`
 * rehearsal and the weekly CI workflow).
 */
import { describe, it, expect } from 'vitest';

const mod = await import('../../scripts/sync-ua-blocklist.mjs');

describe('diffAgainstUpstream', () => {
  it('returns names not covered by any local pattern', () => {
    const local = [/GPTBot/i, /ClaudeBot/i];
    const upstream = ['GPTBot', 'ClaudeBot', 'NewBot2026', 'AnotherCrawler'];
    const missing = mod.diffAgainstUpstream(upstream, local);
    expect(missing).toEqual(['NewBot2026', 'AnotherCrawler']);
  });

  it('respects case-insensitive matching', () => {
    const local = [/gptbot/i];
    const upstream = ['GPTBot', 'GptBot', 'GPTBOT'];
    expect(mod.diffAgainstUpstream(upstream, local)).toEqual([]);
  });

  it('returns empty when local fully covers upstream', () => {
    const local = [/GPTBot/i, /ClaudeBot/i, /Perplexity/i];
    const upstream = ['GPTBot', 'PerplexityBot', 'Perplexity-User'];
    // PerplexityBot and Perplexity-User both contain "Perplexity" → covered
    expect(mod.diffAgainstUpstream(upstream, local)).toEqual([]);
  });

  it('treats narrower upstream as covered by broader local', () => {
    const local = [/Perplexity/i];
    const upstream = ['PerplexityBot', 'Perplexity-User', 'PerplexityHQ'];
    expect(mod.diffAgainstUpstream(upstream, local)).toEqual([]);
  });

  it('strips backslash escapes from local pattern source before comparison', () => {
    // /anthropic\.com/i has source "anthropic\\.com" — escapes mustn't
    // poison the substring check.
    const local = [/anthropic\.com/i];
    const upstream = ['anthropic.com', 'NotRelated'];
    const missing = mod.diffAgainstUpstream(upstream, local);
    expect(missing).toEqual(['NotRelated']);
  });

  it('handles empty inputs', () => {
    expect(mod.diffAgainstUpstream([], [/GPTBot/i])).toEqual([]);
    expect(mod.diffAgainstUpstream(['GPTBot'], [])).toEqual(['GPTBot']);
  });

  it('handles upstream names that ARE substrings of local patterns', () => {
    // Local pattern /BingPreview/i should "cover" an upstream entry
    // named just "Bing" (the upstream is narrower than our pattern).
    const local = [/BingPreview/i];
    const upstream = ['Bing'];
    expect(mod.diffAgainstUpstream(upstream, local)).toEqual([]);
  });
});
