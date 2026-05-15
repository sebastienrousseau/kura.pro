// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const BOOT = '../../cdn/shared/theme-boot.js';

function setMatchMediaLight(isLight) {
  // happy-dom's matchMedia returns matches: false by default. Patch the
  // light query so the OS-preference fallback exercises both branches.
  window.matchMedia = (query) => ({
    matches: query.includes('light') ? isLight : !isLight,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

describe('theme-boot.js', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    setMatchMediaLight(false);
  });

  it('respects an explicit stored "light" choice', async () => {
    localStorage.setItem('cloudcdn.theme', 'light');
    await import(BOOT);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('respects an explicit stored "dark" choice', async () => {
    localStorage.setItem('cloudcdn.theme', 'dark');
    await import(BOOT);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to prefers-color-scheme=light when nothing is stored', async () => {
    setMatchMediaLight(true);
    await import(BOOT);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('falls back to dark when nothing is stored and OS prefers dark', async () => {
    setMatchMediaLight(false);
    await import(BOOT);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores invalid stored values and falls back to OS preference', async () => {
    localStorage.setItem('cloudcdn.theme', 'banana');
    setMatchMediaLight(true);
    await import(BOOT);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('lands on dark when localStorage access throws', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage forbidden');
      },
    });
    try {
      await import(BOOT);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});
