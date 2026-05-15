/*
 * Synchronous theme bootstrap — must run before paint to avoid FOUC.
 * Sets [data-theme] on <html> from localStorage, falling back to
 * prefers-color-scheme. Kept external (not inline) so the page can
 * ship under a strict Content-Security-Policy (script-src 'self').
 *
 * Pair with theme-toggle.js for the button + persistence logic.
 */
(function () {
  try {
    var stored = localStorage.getItem('cloudcdn.theme');
    var theme = (stored === 'light' || stored === 'dark')
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
