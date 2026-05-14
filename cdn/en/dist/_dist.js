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

  const PACKAGES = [
    {
      // Stratos — the official CloudCDN command-line client. Manages
      // zones, signed URLs, edge cache invalidation, and asset uploads
      // from any shell.
      name: 'Stratos',
      desc: 'Official CloudCDN CLI — zones, purge, upload, signed URLs',
      version: '0.1.0',
      files: {
        macos_arm64: { file: 'stratos-0.1.0-darwin-arm64.tar.gz', size: 'TBD', sha256: 'pending first release' },
        macos_x64:   { file: 'stratos-0.1.0-darwin-x64.tar.gz',   size: 'TBD', sha256: 'pending first release' },
        linux_x64:   { file: 'stratos-0.1.0-linux-x64.tar.gz',    size: 'TBD', sha256: 'pending first release' },
        linux_arm64: { file: 'stratos-0.1.0-linux-arm64.tar.gz',  size: 'TBD', sha256: 'pending first release' },
        windows_x64: { file: 'stratos-0.1.0-windows-x64.zip',     size: 'TBD', sha256: 'pending first release' },
      },
      install: {
        macos:   `curl -sL ${CDN}/dist/stratos/install.sh | bash`,
        linux:   `curl -sL ${CDN}/dist/stratos/install.sh | bash`,
        windows: `irm ${CDN}/dist/stratos/install.ps1 | iex`,
      },
    },
    {
      // static-site-generator — secure-by-default Rust SSG from
      // sebastienrousseau/static-site-generator. Hosted here so the
      // CloudCDN dashboard can offer one-click installs for the SSG
      // it pairs with.
      name: 'static-site-generator',
      desc: 'Secure-by-default Rust SSG: WCAG 2.1 AA, CSP/SRI hardening, local LLM content pipeline, 28-locale i18n',
      version: '0.0.39',
      files: {
        macos_arm64: {
          file: 'ssg-v0.0.39-aarch64-apple-darwin.tar.gz',
          size: '5.4 MB',
          sha256: '6e5ce2ce056543909884dddff0d2b3e21a4ef47705c7c2a0212b534b091c8db8',
        },
        macos_x64: {
          file: 'ssg-v0.0.39-x86_64-apple-darwin.tar.gz',
          size: '5.8 MB',
          sha256: '8a0995088c59b5ca930b44d369f9de101cc1d95c86ffecdf00df3d72d11fea70',
        },
        linux_x64: {
          file: 'ssg-v0.0.39-x86_64-unknown-linux-gnu.tar.gz',
          size: '6.1 MB',
          sha256: '54a77f53061999f43b1093c317c10d178ff39dfbba01dc9aa011d235c7c43b25',
        },
        windows_x64: {
          file: 'ssg-v0.0.39-x86_64-pc-windows-msvc.zip',
          size: '5.7 MB',
          sha256: '6d251b60f20b2e01bc9f91739c185d0828a0eb5f63275a01bb3843abb3aaadcf',
        },
      },
      install: {
        macos:   `curl -sL https://github.com/sebastienrousseau/static-site-generator/releases/latest/download/ssg-installer.sh | bash`,
        linux:   `curl -sL https://github.com/sebastienrousseau/static-site-generator/releases/latest/download/ssg-installer.sh | bash`,
        windows: `irm https://github.com/sebastienrousseau/static-site-generator/releases/latest/download/ssg-installer.ps1 | iex`,
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
