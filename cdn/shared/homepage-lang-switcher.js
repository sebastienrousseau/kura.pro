/**
 * Homepage language switcher — click + Escape + outside-click toggle.
 *
 * Extracted from the inline <script> in cdn/en/index.html so the homepage
 * can ship under a strict Content-Security-Policy (script-src 'self').
 *
 * Served at /shared/homepage-lang-switcher.js — the homepage HTML loads it
 * with `defer` so the DOM is ready before this runs.
 */
(function () {
  const langSwitcher = document.querySelector('.lang-switcher');
  const langToggle = document.querySelector('.lang-toggle');
  if (!langSwitcher || !langToggle) return;

  langToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = langSwitcher.classList.toggle('open');
    langToggle.setAttribute('aria-expanded', String(open));
  });

  document.addEventListener('click', (e) => {
    if (!langSwitcher.contains(e.target)) {
      langSwitcher.classList.remove('open');
      langToggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && langSwitcher.classList.contains('open')) {
      langSwitcher.classList.remove('open');
      langToggle.setAttribute('aria-expanded', 'false');
      langToggle.focus();
    }
  });
})();
