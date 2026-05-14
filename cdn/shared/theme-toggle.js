/*
 * Theme toggle: dark / light, persisted in localStorage, falls back to
 * prefers-color-scheme on first visit. Designed to coexist with Skeletonic's
 * native light-dark()/color-scheme handling.
 *
 * Apply the initial theme synchronously (via the inline boot snippet in
 * each page <head>) to avoid a flash of unstyled theme.
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'cloudcdn.theme';
  const root = document.documentElement;

  function currentTheme() {
    const stored = (function () {
      try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
    })();
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f8fb' : '#08090d');
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
      btn.setAttribute('aria-label', theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    });
  }

  function persist(theme) {
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
  }

  function init() {
    applyTheme(currentTheme());

    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        persist(next);
      });
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', (e) => {
        try {
          if (localStorage.getItem(STORAGE_KEY)) return; // user has an explicit choice
        } catch (err) { /* ignore */ }
        applyTheme(e.matches ? 'light' : 'dark');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
