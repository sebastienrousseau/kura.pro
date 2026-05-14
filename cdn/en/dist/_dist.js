/**
 * /dist/ landing page — OS detection + per-platform install commands.
 *
 * Extracted from the inline <script> in cdn/en/dist/index.html so the
 * /dist/ route serves under strict script-src 'self' CSP (no
 * 'unsafe-inline'). Same UX as before: detect the visitor's OS and
 * architecture from navigator.userAgent/platform, render the package
 * grid, surface a "Copy" button on each install command.
 *
 * The previous inline form embedded `onclick="copyCmd(this)"` in the
 * template literal that became part of innerHTML. Strict CSP also
 * blocks DOM-injected inline event handlers, so this version uses a
 * `data-action="copy" data-cmd="..."` attribute plus a single
 * delegated click listener on the package container.
 */
(() => {
  const CDN = 'https://cloudcdn.pro';

  // Example packages — extend with real project data.
  const PACKAGES = [
    {
      name: 'Euxis CLI',
      desc: 'Cross-platform cloud deployment toolkit',
      version: '1.2.0',
      files: {
        macos_arm64: { file: 'euxis-1.2.0-darwin-arm64.tar.gz', size: '12.4 MB', sha256: 'a1b2c3d4e5f6...' },
        macos_x64:   { file: 'euxis-1.2.0-darwin-x64.tar.gz',   size: '13.1 MB', sha256: 'f6e5d4c3b2a1...' },
        linux_x64:   { file: 'euxis-1.2.0-linux-x64.tar.gz',    size: '11.8 MB', sha256: 'b2c3d4e5f6a1...' },
        linux_arm64: { file: 'euxis-1.2.0-linux-arm64.tar.gz',  size: '11.2 MB', sha256: 'c3d4e5f6a1b2...' },
        windows_x64: { file: 'euxis-1.2.0-windows-x64.zip',     size: '14.0 MB', sha256: 'd4e5f6a1b2c3...' },
      },
      install: {
        macos:   `curl -sL ${CDN}/dist/euxis/install.sh | bash`,
        linux:   `curl -sL ${CDN}/dist/euxis/install.sh | bash`,
        windows: `irm ${CDN}/dist/euxis/install.ps1 | iex`,
      },
    },
    {
      name: 'Shokunin SSG',
      desc: 'Static site generator built in Rust',
      version: '0.9.0',
      files: {
        macos_arm64: { file: 'shokunin-0.9.0-darwin-arm64.tar.gz', size: '8.2 MB', sha256: 'e5f6a1b2c3d4...' },
        macos_x64:   { file: 'shokunin-0.9.0-darwin-x64.tar.gz',   size: '8.7 MB', sha256: 'a1b2c3d4e5f6...' },
        linux_x64:   { file: 'shokunin-0.9.0-linux-x64.tar.gz',    size: '7.9 MB', sha256: 'f6e5d4c3b2a1...' },
        linux_arm64: { file: 'shokunin-0.9.0-linux-arm64.tar.gz',  size: '7.4 MB', sha256: 'b2c3d4e5f6a1...' },
        windows_x64: { file: 'shokunin-0.9.0-windows-x64.zip',     size: '9.1 MB', sha256: 'c3d4e5f6a1b2...' },
      },
      install: {
        macos:   `curl -sL ${CDN}/dist/shokunin/install.sh | bash`,
        linux:   `curl -sL ${CDN}/dist/shokunin/install.sh | bash`,
        windows: `irm ${CDN}/dist/shokunin/install.ps1 | iex`,
      },
    },
  ];

  function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    if (ua.includes('win')) {
      return { os: 'windows', label: 'Windows', icon: '◺', arch: ua.includes('arm') ? 'arm64' : 'x64' };
    }
    if (ua.includes('mac') || platform.includes('mac')) {
      return { os: 'macos', label: 'macOS', icon: '', arch: (ua.includes('arm') || platform.includes('arm')) ? 'arm64' : 'x64' };
    }
    if (ua.includes('linux')) {
      if (ua.includes('wsl') || ua.includes('microsoft')) {
        return { os: 'linux', label: 'Linux (WSL)', icon: '🐧', arch: 'x64' };
      }
      return { os: 'linux', label: 'Linux', icon: '🐧', arch: ua.includes('aarch64') || ua.includes('arm') ? 'arm64' : 'x64' };
    }
    return { os: 'linux', label: 'Unknown (defaulting to Linux)', icon: '💻', arch: 'x64' };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const detected = detectOS();
    document.getElementById('os-icon').textContent = detected.icon;
    document.getElementById('os-name').textContent = `${detected.label} (${detected.arch})`;
    document.getElementById('os-hint').textContent = 'Showing recommended downloads for your platform. All platforms available below.';

    const container = document.getElementById('packages');
    const fileKey = `${detected.os}_${detected.arch}`;

    for (const pkg of PACKAGES) {
      const recommended = pkg.files[fileKey];
      const installCmd = pkg.install[detected.os] || pkg.install.linux;

      let html = `<div class="pkg">`;
      html += `<div class="pkg-header"><span class="pkg-name">${escapeHtml(pkg.name)} <span style="color:var(--text-dim);font-weight:400;">v${escapeHtml(pkg.version)}</span></span></div>`;
      html += `<p class="pkg-desc">${escapeHtml(pkg.desc)}</p>`;

      // Install command — use data-action so the delegated listener below
      // can route the click. No inline onclick (CSP).
      html += `<div class="install-cmd"><code>${escapeHtml(installCmd)}</code>`;
      html += `<button type="button" data-action="copy" data-cmd="${escapeAttr(installCmd)}">Copy</button>`;
      html += `</div>`;

      if (recommended) {
        html += `<div class="checksum"><span class="label">SHA-256:</span> ${escapeHtml(recommended.sha256)}</div>`;
      }

      html += `<div class="file-grid">`;
      for (const [key, info] of Object.entries(pkg.files)) {
        const isActive = key === fileKey;
        html += `<div class="file-item ${isActive ? 'active' : ''}">`;
        html += `<span class="name">${escapeHtml(info.file.split('-').pop())}</span>`;
        html += `<span class="size">${escapeHtml(info.size)}</span>`;
        html += `</div>`;
      }
      html += `</div></div>`;

      container.innerHTML += html;
    }

    // Single delegated click listener — handles every Copy button under
    // #packages, no matter when they were rendered.
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="copy"]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      navigator.clipboard.writeText(cmd).then(() => {
        const toast = document.getElementById('toast');
        toast.textContent = 'Copied!';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1500);
      });
    });
  });
})();
