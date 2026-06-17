/**
 * /dist/ marketplace — Setapp-inspired discovery surface.
 *
 * Fetches the auto-generated `_dist.json` catalogue (produced by
 * `scripts/dist/generate-dist-catalogue.mjs` from
 * `scripts/dist/packages-catalogue.json`) and renders:
 *
 *   1. A featured hero card for the marquee package.
 *   2. A category-grouped grid of every published software product.
 *   3. Per-card OS-aware install command + Copy button, registry badges
 *      (npm, crates.io, PyPI, GitHub Releases) with deep links.
 *
 * Strict CSP: no inline event handlers, no inline scripts injected via
 * innerHTML. All click handling is via a single delegated listener on
 * the marketplace root.
 */
(() => {
  'use strict';

  const CATALOGUE_URL = '/dist/_dist.json';
  // Symbolic per-registry badge labels; the CSS sets colours by .registry-* class.
  const REGISTRY_LABELS = {
    npm:               'npm',
    'crates.io':       'crates.io',
    pypi:              'PyPI',
    'github-releases': 'GitHub Releases',
  };
  // Install-command key → recommended OS for OS-aware ordering.
  const OS_PRIORITY_KEYS = {
    macos:   ['macos', 'npx', 'pipx', 'cargo install', 'cargo', 'pip', 'npm', 'pnpm'],
    linux:   ['linux', 'npx', 'pipx', 'cargo install', 'cargo', 'pip', 'npm', 'pnpm'],
    windows: ['windows', 'npx', 'cargo install', 'cargo', 'pip', 'pipx', 'npm', 'pnpm'],
  };

  /** Cheap, dependency-free escapers — we never inject untrusted HTML. */
  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /** Detect OS + arch from navigator. */
  function detectOS() {
    const ua = (navigator.userAgent || '').toLowerCase();
    const platform = (navigator.platform || '').toLowerCase();
    if (ua.includes('win')) {
      return { os: 'windows', label: 'Windows', icon: '◺',
        arch: ua.includes('arm') ? 'arm64' : 'x64' };
    }
    if (ua.includes('mac') || platform.includes('mac')) {
      return { os: 'macos', label: 'macOS', icon: '',
        arch: (ua.includes('arm') || platform.includes('arm')) ? 'arm64' : 'x64' };
    }
    if (ua.includes('linux')) {
      if (ua.includes('wsl') || ua.includes('microsoft')) {
        return { os: 'linux', label: 'Linux (WSL)', icon: '🐧', arch: 'x64' };
      }
      return { os: 'linux', label: 'Linux', icon: '🐧',
        arch: (ua.includes('aarch64') || ua.includes('arm')) ? 'arm64' : 'x64' };
    }
    return { os: 'linux', label: 'Unknown (defaulting to Linux)', icon: '💻', arch: 'x64' };
  }

  /**
   * Choose the most relevant install command for the visitor's OS,
   * given the per-package `install` map (e.g. `{ macos, linux, windows,
   * cargo, npm, pip, pipx, npx }`).
   *
   * @returns {{ key: string, cmd: string } | null}
   */
  function pickInstall(install, detected) {
    if (!install) return null;
    const order = OS_PRIORITY_KEYS[detected.os] || OS_PRIORITY_KEYS.linux;
    for (const key of order) {
      if (install[key]) return { key, cmd: install[key] };
    }
    const first = Object.entries(install)[0];
    return first ? { key: first[0], cmd: first[1] } : null;
  }

  function regBadge(reg) {
    const label = REGISTRY_LABELS[reg.type] || reg.type;
    const cls = 'registry registry-' + reg.type.replace(/[^a-z0-9]/gi, '-');
    if (reg.ok && reg.page) {
      return `<a class="${cls}" href="${escapeAttr(reg.page)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
    }
    return `<span class="${cls}">${escapeHtml(label)}</span>`;
  }

  /**
   * Render the small <img> tag for a package logo, or initials when the
   * package has no logo entry.
   */
  function logoHtml(pkg) {
    if (pkg.logo) {
      return `<img class="pkg-logo" src="${escapeAttr(pkg.logo)}" alt="" loading="lazy" width="48" height="48">`;
    }
    const initials = (pkg.name || pkg.slug || '?').replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 2).toUpperCase();
    return `<span class="pkg-logo pkg-logo-fallback" aria-hidden="true">${escapeHtml(initials)}</span>`;
  }

  /** Build the card HTML for one package. */
  function renderCard(pkg, detected, { hero = false } = {}) {
    const install = pickInstall(pkg.install, detected);
    const installCmd = install?.cmd || '';
    const installKey = install?.key || '';
    const version = pkg.primary_version
      ? `v${escapeHtml(pkg.primary_version)}`
      : '<span class="coming-soon">Coming soon</span>';
    const tagline = escapeHtml(pkg.tagline || '');
    const repoLink = pkg.repo
      ? `<a class="pkg-repo" href="https://github.com/${escapeAttr(pkg.repo)}" target="_blank" rel="noopener" aria-label="Source on GitHub">Source ↗</a>`
      : '';

    const regBadges = (pkg.registries || []).map(regBadge).join('');

    const installBlock = installCmd
      ? `<div class="install-cmd">
            <code>${escapeHtml(installCmd)}</code>
            <button type="button" class="copy-btn" data-action="copy"
              data-cmd="${escapeAttr(installCmd)}"
              aria-label="Copy ${escapeAttr(pkg.name)} install command">Copy</button>
         </div>
         <p class="install-hint">Install method: <code>${escapeHtml(installKey)}</code></p>`
      : `<p class="install-hint install-hint-soon">Will be installable once the first release ships.</p>`;

    return `<article class="pkg${hero ? ' pkg-hero' : ''}" data-slug="${escapeAttr(pkg.slug)}">
      <div class="pkg-head">
        ${logoHtml(pkg)}
        <div class="pkg-titleblock">
          <h3 class="pkg-name">${escapeHtml(pkg.name)} <span class="pkg-version">${version}</span></h3>
          <p class="pkg-tagline">${tagline}</p>
        </div>
      </div>
      <div class="pkg-meta">
        <div class="pkg-registries">${regBadges}</div>
        ${repoLink}
      </div>
      ${installBlock}
    </article>`;
  }

  /** Render a single category section + its grid of cards. */
  function renderSection(category, packages, detected) {
    if (packages.length === 0) return '';
    const cards = packages.map((p) => renderCard(p, detected)).join('');
    return `<section class="cat-section" data-cat="${escapeAttr(category.id)}">
      <header class="cat-head">
        <h2 class="cat-name">${escapeHtml(category.name)}</h2>
        <p class="cat-tagline">${escapeHtml(category.tagline || '')}</p>
      </header>
      <div class="cat-grid">${cards}</div>
    </section>`;
  }

  /** Render the hero featured-package card. */
  function renderHero(pkg, detected) {
    if (!pkg) return '';
    return `<section class="hero">
      <div class="hero-eyebrow">Featured</div>
      ${renderCard(pkg, detected, { hero: true })}
    </section>`;
  }

  async function fetchCatalogue() {
    const res = await fetch(CATALOGUE_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Failed to load catalogue (${res.status})`);
    return res.json();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const root = document.getElementById('marketplace');
    if (!root) return;

    const detected = detectOS();
    const osIcon = document.getElementById('os-icon');
    const osName = document.getElementById('os-name');
    const osHint = document.getElementById('os-hint');
    if (osIcon) osIcon.textContent = detected.icon;
    if (osName) osName.textContent = `${detected.label} (${detected.arch})`;
    if (osHint) osHint.textContent = 'Install commands below are tailored to your platform.';

    let data;
    try {
      data = await fetchCatalogue();
    } catch (err) {
      root.innerHTML = `<p class="load-error">Could not load the catalogue: ${escapeHtml(err.message)}.</p>`;
      return;
    }

    const featured = data.packages.find((p) => p.slug === data.featured);
    const byCat = new Map();
    for (const pkg of data.packages) {
      if (pkg.slug === data.featured) continue;
      const arr = byCat.get(pkg.category) || [];
      arr.push(pkg);
      byCat.set(pkg.category, arr);
    }

    let html = renderHero(featured, detected);
    for (const cat of data.categories) {
      const pkgs = byCat.get(cat.id) || [];
      html += renderSection(cat, pkgs, detected);
    }
    root.innerHTML = html;

    // Single delegated click listener — survives any future re-render of
    // the marketplace area, and avoids inline onclick (CSP).
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="copy"]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (!cmd || !navigator.clipboard) return;
      navigator.clipboard.writeText(cmd).then(() => {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = 'Copied!';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
      });
    });
  });
})();
