// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const BRIDGE = '../../cdn/shared/scalar-theme.js';

function installConfigScript(rawConfigJson) {
  // Build the node imperatively rather than via innerHTML interpolation.
  // The previous template-literal form required the caller to escape any
  // single quotes in the config payload before passing it in (and
  // CodeQL js/incomplete-sanitization flagged the ad-hoc escape as
  // incomplete because it didn't handle backslashes — see PR #60-ish).
  // setAttribute handles encoding correctly for arbitrary input, so the
  // caller no longer has to think about it.
  document.body.innerHTML = '';
  const tag = document.createElement('script');
  tag.id = 'api-reference';
  tag.setAttribute('data-url', 'openapi.json');
  tag.setAttribute('data-configuration', rawConfigJson);
  document.body.appendChild(tag);
  return tag;
}

describe('scalar-theme.js', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-theme');
    document.body.innerHTML = '';
  });

  it('flips darkMode:false when [data-theme="light"] is set', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const tag = installConfigScript('{"darkMode": true, "theme": "saturn"}');
    await import(BRIDGE);
    const cfg = JSON.parse(tag.getAttribute('data-configuration'));
    expect(cfg.darkMode).toBe(false);
    expect(cfg.theme).toBe('saturn');
  });

  it('flips darkMode:true when [data-theme="dark"] is set', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const tag = installConfigScript('{"darkMode": false}');
    await import(BRIDGE);
    expect(JSON.parse(tag.getAttribute('data-configuration')).darkMode).toBe(true);
  });

  it('is a no-op when no <script id="api-reference"> is on the page', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    // No #api-reference script — bridge should just return cleanly.
    await expect(import(BRIDGE)).resolves.toBeTruthy();
  });

  it('is a no-op when data-theme is not set (no override)', async () => {
    const original = '{"darkMode": true}';
    const tag = installConfigScript(original);
    await import(BRIDGE);
    // Attribute should be untouched since data-theme is absent.
    expect(tag.getAttribute('data-configuration')).toBe(original);
  });

  it('is a no-op when data-theme has an unexpected value', async () => {
    document.documentElement.setAttribute('data-theme', 'sepia');
    const original = '{"darkMode": true}';
    const tag = installConfigScript(original);
    await import(BRIDGE);
    expect(tag.getAttribute('data-configuration')).toBe(original);
  });

  it('is a no-op when data-configuration is missing', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.innerHTML = '<script id="api-reference"></script>';
    await expect(import(BRIDGE)).resolves.toBeTruthy();
  });

  it('swallows malformed JSON in data-configuration', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const tag = installConfigScript('{not: valid json,');
    await import(BRIDGE);
    // Should not throw; attribute stays whatever the page had (Scalar
    // will surface the parse error itself).
    expect(tag.getAttribute('data-configuration')).toBeTruthy();
  });
});
