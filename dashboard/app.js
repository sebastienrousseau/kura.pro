(() => {
  'use strict';

  const CDN_BASE = 'https://kura.pro/';
  const PAGE_SIZE = 60;

  let manifest = [];
  let filtered = [];
  let displayed = 0;

  // DOM refs
  const gallery = document.getElementById('gallery');
  const search = document.getElementById('search');
  const filterProject = document.getElementById('filter-project');
  const filterFormat = document.getElementById('filter-format');
  const filterCategory = document.getElementById('filter-category');
  const loadMoreContainer = document.getElementById('load-more');
  const loadMoreBtn = document.getElementById('load-more-btn');
  const emptyState = document.getElementById('empty-state');
  const statTotal = document.getElementById('stat-total');
  const statShowing = document.getElementById('stat-showing');
  const statSize = document.getElementById('stat-size');
  const toast = document.getElementById('toast');

  // --- Init ---
  async function init() {
    try {
      const res = await fetch('../manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      statTotal.textContent = `Failed to load manifest: ${err.message}`;
      return;
    }

    populateFilters();
    applyFilters();

    search.addEventListener('input', debounce(applyFilters, 200));
    filterProject.addEventListener('change', applyFilters);
    filterFormat.addEventListener('change', applyFilters);
    filterCategory.addEventListener('change', applyFilters);
    loadMoreBtn.addEventListener('click', loadMore);
  }

  // --- Filters ---
  function populateFilters() {
    const projects = [...new Set(manifest.map(a => a.project))].sort();
    for (const p of projects) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      filterProject.appendChild(opt);
    }

    const categories = [...new Set(manifest.map(a => a.category))].sort();
    for (const c of categories) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      filterCategory.appendChild(opt);
    }
  }

  function applyFilters() {
    const q = search.value.toLowerCase().trim();
    const proj = filterProject.value;
    const fmt = filterFormat.value;
    const cat = filterCategory.value;

    filtered = manifest.filter(a => {
      if (proj && a.project !== proj) return false;
      if (fmt && a.format !== fmt) return false;
      if (cat && a.category !== cat) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.path.toLowerCase().includes(q)) return false;
      return true;
    });

    displayed = 0;
    gallery.innerHTML = '';
    renderBatch();
    updateStats();
  }

  // --- Rendering ---
  function renderBatch() {
    const batch = filtered.slice(displayed, displayed + PAGE_SIZE);
    const fragment = document.createDocumentFragment();

    for (const asset of batch) {
      fragment.appendChild(createCard(asset));
    }

    gallery.appendChild(fragment);
    displayed += batch.length;

    // Observe lazy images
    observeImages();

    // Toggle load more / empty
    loadMoreContainer.classList.toggle('hidden', displayed >= filtered.length);
    emptyState.classList.toggle('hidden', filtered.length > 0);
  }

  function loadMore() {
    renderBatch();
    updateStats();
  }

  function createCard(asset) {
    const card = document.createElement('div');
    card.className = 'asset-card';

    const isImage = ['png', 'webp', 'avif', 'svg'].includes(asset.format);
    const cdnUrl = `${CDN_BASE}${asset.path}`;

    card.innerHTML = `
      <div class="asset-thumb">
        ${isImage
          ? `<img data-src="${cdnUrl}" alt="${asset.name}" loading="lazy">`
          : `<div class="text-gray-600 text-3xl">${asset.format.toUpperCase()}</div>`
        }
        <div class="copy-overlay" title="Copy CDN URL">
          <button class="copy-btn">Copy URL</button>
        </div>
      </div>
      <div class="px-3 py-2">
        <p class="text-xs text-gray-300 truncate" title="${asset.name}">${asset.name}</p>
        <div class="flex items-center justify-between mt-1">
          <span class="format-badge ${asset.format}">${asset.format}</span>
          <span class="text-[10px] text-gray-500">${formatBytes(asset.size)}</span>
        </div>
      </div>
    `;

    // Copy handler
    const overlay = card.querySelector('.copy-overlay');
    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(cdnUrl);
    });

    return card;
  }

  // --- Lazy Loading ---
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        img.addEventListener('error', () => {
          img.classList.add('loaded');
          img.style.display = 'none';
        }, { once: true });
        observer.unobserve(img);
      }
    }
  }, { rootMargin: '200px' });

  function observeImages() {
    gallery.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
  }

  // --- Clipboard ---
  async function copyToClipboard(url) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(`Copied: ${url}`);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('toast-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('toast-show'), 2000);
  }

  // --- Stats ---
  function updateStats() {
    const totalSize = filtered.reduce((sum, a) => sum + a.size, 0);

    statTotal.textContent = `${manifest.length} total assets`;
    statShowing.textContent = `Showing: ${Math.min(displayed, filtered.length)} / ${filtered.length}`;
    statShowing.classList.remove('hidden');
    statSize.textContent = `Filtered size: ${formatBytes(totalSize)}`;
    statSize.classList.remove('hidden');
  }

  // --- Utils ---
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // --- Boot ---
  init();
})();
