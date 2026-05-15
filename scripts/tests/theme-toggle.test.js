// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TOGGLE = '../../cdn/shared/theme-toggle.js';

function buildPage(initialTheme = 'dark') {
  document.documentElement.setAttribute('data-theme', initialTheme);
  document.head.innerHTML = '<meta name="theme-color" content="#08090d">';
  document.body.innerHTML = `
    <button type="button" class="theme-toggle" aria-label="Switch to light mode" aria-pressed="false">
      <svg class="icon-moon"></svg>
      <svg class="icon-sun"></svg>
    </button>
  `;
}

function patchMatchMedia({ initialLight = false, listeners = [] } = {}) {
  window.matchMedia = (query) => ({
    matches: query.includes('light') ? initialLight : !initialLight,
    media: query,
    addEventListener: (event, fn) => {
      if (event === 'change') listeners.push(fn);
    },
    removeEventListener: () => {},
  });
  return listeners;
}

describe('theme-toggle.js', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-theme');
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
  });

  it('initialises with the stored light theme and updates aria + meta', async () => {
    buildPage('dark');
    localStorage.setItem('cloudcdn.theme', 'light');
    patchMatchMedia();
    await import(TOGGLE);
    const btn = document.querySelector('.theme-toggle');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Switch to dark mode');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f7f8fb');
  });

  it('initialises dark when nothing is stored and OS prefers dark', async () => {
    buildPage('dark');
    patchMatchMedia({ initialLight: false });
    await import(TOGGLE);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.querySelector('.theme-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  it('initialises light from OS preference when nothing is stored', async () => {
    buildPage('dark');
    patchMatchMedia({ initialLight: true });
    await import(TOGGLE);
    // Drives the matchMedia branch of currentTheme() — line 21.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('clicking the toggle flips theme, persists, and updates meta', async () => {
    buildPage('dark');
    patchMatchMedia();
    await import(TOGGLE);
    const btn = document.querySelector('.theme-toggle');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('cloudcdn.theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#f7f8fb');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('cloudcdn.theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#08090d');
  });

  it('falls back to dark when localStorage.getItem throws during init', async () => {
    buildPage('dark');
    patchMatchMedia({ initialLight: false });
    // Replace the whole localStorage object so getItem throws regardless
    // of whether the implementation uses Storage.prototype or its own
    // instance-bound function (happy-dom uses the latter).
    const originalLS = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('localStorage forbidden'); },
        setItem() {},
        removeItem() {},
        clear() {},
      },
    });
    try {
      await import(TOGGLE);
      // The IIFE swallows the throw via the inner currentTheme() catch
      // and the script proceeds with the OS-preference fallback.
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      if (originalLS) Object.defineProperty(window, 'localStorage', originalLS);
    }
  });

  it('runs without matchMedia (older browsers / restrictive sandboxes)', async () => {
    buildPage('dark');
    // localStorage carries the choice — no need for matchMedia.
    localStorage.setItem('cloudcdn.theme', 'dark');
    const originalMM = window.matchMedia;
    // Drives the `if (window.matchMedia)` false branch at line 49.
    delete window.matchMedia;
    try {
      await import(TOGGLE);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      window.matchMedia = originalMM;
    }
  });

  it('runs the DOMContentLoaded path when document is still loading', async () => {
    buildPage('dark');
    patchMatchMedia();
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    await import(TOGGLE);
    // init has NOT run yet — listener will fire on DOMContentLoaded.
    expect(document.querySelector('.theme-toggle').getAttribute('aria-pressed')).toBe('false');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  });

  it('follows OS preference changes when the user has no explicit choice', async () => {
    buildPage('dark');
    const listeners = patchMatchMedia();
    await import(TOGGLE);
    expect(listeners).toHaveLength(1);
    listeners[0]({ matches: true });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    listeners[0]({ matches: false });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores OS preference changes when the user has explicitly chosen', async () => {
    buildPage('dark');
    localStorage.setItem('cloudcdn.theme', 'dark');
    const listeners = patchMatchMedia();
    await import(TOGGLE);
    listeners[0]({ matches: true });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('swallows a localStorage throw inside the matchMedia change handler', async () => {
    buildPage('dark');
    const listeners = patchMatchMedia();
    await import(TOGGLE);
    const originalLS = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem() { throw new Error('localStorage forbidden'); },
        setItem() {},
        removeItem() {},
        clear() {},
      },
    });
    try {
      listeners[0]({ matches: true });
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    } finally {
      if (originalLS) Object.defineProperty(window, 'localStorage', originalLS);
    }
  });

  it('tolerates a localStorage that throws on setItem (persist swallowed)', async () => {
    buildPage('dark');
    patchMatchMedia();
    await import(TOGGLE);
    const originalLS = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem() { throw new Error('quota'); },
        removeItem() {},
        clear() {},
      },
    });
    try {
      document.querySelector('.theme-toggle').click();
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    } finally {
      if (originalLS) Object.defineProperty(window, 'localStorage', originalLS);
    }
  });

  it('is a no-op on a page with no .theme-toggle button', async () => {
    document.body.innerHTML = '<div>no toggle here</div>';
    document.documentElement.setAttribute('data-theme', 'dark');
    patchMatchMedia();
    await expect(import(TOGGLE)).resolves.toBeTruthy();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('skips meta theme-color update on pages without that meta tag', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.body.innerHTML = '<button class="theme-toggle"></button>';
    patchMatchMedia();
    await import(TOGGLE);
    document.querySelector('.theme-toggle').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
