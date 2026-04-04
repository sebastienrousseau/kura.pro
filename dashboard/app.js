(() => {
  'use strict';

  const CDN_BASE = window.location.origin + '/';
  const PAGE_SIZE = 60;

  let manifest = [];
  let filtered = [];
  let displayed = 0;

  // DOM refs — Assets
  const gallery = document.getElementById('gallery');
  const search = document.getElementById('search');
  const filterProject = document.getElementById('filter-project');
  const filterFormat = document.getElementById('filter-format');
  const filterCategory = document.getElementById('filter-category');
  const loadMoreContainer = document.getElementById('load-more');
  const emptyState = document.getElementById('empty-state');
  const statTotal = document.getElementById('stat-total');
  const statShowing = document.getElementById('stat-showing');
  const statSize = document.getElementById('stat-size');
  const toast = document.getElementById('toast');

  // ===================================================================
  // TAB NAVIGATION
  // ===================================================================
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const searchBar = document.getElementById('search-bar');
  const filterBar = document.getElementById('filter-bar');
  const statsBar = document.getElementById('stats-bar');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      tabPanels.forEach(p => { p.classList.remove('active'); p.style.display = 'none'; });
      const panel = document.getElementById('panel-' + tab);
      if (panel) { panel.classList.add('active'); panel.style.display = ''; }

      // Show/hide assets-specific UI
      const isAssets = tab === 'assets';
      searchBar.style.display = isAssets ? '' : 'none';
      filterBar.style.display = isAssets ? '' : 'none';
      statsBar.style.display = isAssets ? '' : 'none';

      // Load insights on first visit
      if (tab === 'insights' && !insightsLoaded) loadInsights();
    });
  });

  // ===================================================================
  // ASSETS TAB
  // ===================================================================
  async function init() {
    try {
      const res = await fetch('/manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();
    } catch (err) {
      statTotal.textContent = `Failed to load manifest: ${err.message}`;
      return;
    }

    populateFilters();
    populateAssetPicker();
    applyFilters();

    search.addEventListener('input', debounce(applyFilters, 150));
    filterProject.addEventListener('change', applyFilters);
    filterFormat.addEventListener('change', applyFilters);
    filterCategory.addEventListener('change', applyFilters);

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        search.focus();
      }
    });
  }

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
    setupScrollObserver();
    updateStats();
  }

  function renderBatch() {
    const batch = filtered.slice(displayed, displayed + PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    for (const asset of batch) fragment.appendChild(createCard(asset));

    const sentinel = gallery.querySelector('.scroll-sentinel');
    if (sentinel) gallery.insertBefore(fragment, sentinel);
    else gallery.appendChild(fragment);

    displayed += batch.length;
    observeImages();
    emptyState.classList.toggle('hidden', filtered.length > 0);
    loadMoreContainer.classList.add('hidden');
  }

  let scrollObserver = null;
  function setupScrollObserver() {
    if (scrollObserver) scrollObserver.disconnect();
    const oldSentinel = gallery.querySelector('.scroll-sentinel');
    if (oldSentinel) oldSentinel.remove();
    if (displayed >= filtered.length) return;

    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    sentinel.style.cssText = 'height:1px;grid-column:1/-1;';
    gallery.appendChild(sentinel);

    scrollObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && displayed < filtered.length) {
        renderBatch();
        updateStats();
        sentinel.remove();
        if (displayed < filtered.length) gallery.appendChild(sentinel);
        else scrollObserver.disconnect();
      }
    }, { rootMargin: '400px' });
    scrollObserver.observe(sentinel);
  }

  function createCard(asset) {
    const card = document.createElement('div');
    card.className = 'asset-card';
    const isImage = ['png', 'webp', 'avif', 'svg'].includes(asset.format);
    const cdnUrl = CDN_BASE + asset.path;

    card.innerHTML = `
      <div class="asset-thumb">
        ${isImage
          ? `<img data-src="${cdnUrl}" alt="${asset.name}" loading="lazy" decoding="async">`
          : `<div class="text-gray-600 text-3xl">${asset.format.toUpperCase()}</div>`
        }
        <div class="copy-overlay">
          <div class="copy-actions">
            <button class="copy-btn" data-type="url" title="Copy CDN URL">URL</button>
            <button class="copy-btn copy-btn-alt" data-type="markdown" title="Copy Markdown">MD</button>
            <button class="copy-btn copy-btn-alt" data-type="html" title="Copy HTML img tag">HTML</button>
          </div>
        </div>
      </div>
      <div class="px-3 py-2">
        <p class="text-xs text-gray-300 truncate" title="${asset.path}">${asset.name}</p>
        <div class="flex items-center justify-between mt-1">
          <span class="format-badge ${asset.format}">${asset.format}</span>
          <span class="text-[10px] text-gray-500">${formatBytes(asset.size)}</span>
        </div>
      </div>`;

    card.querySelector('.copy-overlay').addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      e.stopPropagation();
      const type = btn.dataset.type;
      if (type === 'url') copyToClipboard(cdnUrl, 'URL');
      else if (type === 'markdown') copyToClipboard(`![${asset.name}](${cdnUrl})`, 'Markdown');
      else if (type === 'html') copyToClipboard(`<img src="${cdnUrl}" alt="${asset.name}">`, 'HTML');
    });
    return card;
  }

  const imgObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
        img.addEventListener('error', () => { img.classList.add('loaded'); img.style.display = 'none'; }, { once: true });
        imgObserver.unobserve(img);
      }
    }
  }, { rootMargin: '200px' });

  function observeImages() {
    gallery.querySelectorAll('img[data-src]').forEach(img => imgObserver.observe(img));
  }

  function updateStats() {
    const totalSize = filtered.reduce((sum, a) => sum + a.size, 0);
    statTotal.textContent = `${manifest.length.toLocaleString()} total assets`;
    statShowing.textContent = `Showing: ${Math.min(displayed, filtered.length).toLocaleString()} / ${filtered.length.toLocaleString()}`;
    statShowing.classList.remove('hidden');
    statSize.textContent = `Filtered size: ${formatBytes(totalSize)}`;
    statSize.classList.remove('hidden');
  }

  // ===================================================================
  // TRANSFORM (URL BUILDER) TAB
  // ===================================================================
  const tfUrl = document.getElementById('tf-url');
  const tfW = document.getElementById('tf-w');
  const tfH = document.getElementById('tf-h');
  const tfFormat = document.getElementById('tf-format');
  const tfFit = document.getElementById('tf-fit');
  const tfGravity = document.getElementById('tf-gravity');
  const tfQ = document.getElementById('tf-q');
  const tfBlur = document.getElementById('tf-blur');
  const tfSharp = document.getElementById('tf-sharp');
  const tfOutput = document.getElementById('tf-output');
  const tfPreview = document.getElementById('tf-preview');
  const tfPlaceholder = document.getElementById('tf-placeholder');
  const tfCopy = document.getElementById('tf-copy');

  function buildTransformUrl(forPreview) {
    const base = (forPreview ? window.location.origin : 'https://cloudcdn.pro') + '/api/transform';
    const params = new URLSearchParams();
    const src = tfUrl.value.trim();
    if (!src) return '';
    params.set('url', src);

    const w = parseInt(tfW.value);
    if (w > 0) params.set('w', w);
    const h = parseInt(tfH.value);
    if (h > 0) params.set('h', h);
    if (tfFormat.value && tfFormat.value !== 'auto') params.set('format', tfFormat.value);
    if (tfFit.value) params.set('fit', tfFit.value);
    if (tfGravity.value) params.set('gravity', tfGravity.value);

    const q = parseInt(tfQ.value);
    if (q < 100) params.set('q', q);
    const blur = parseInt(tfBlur.value);
    if (blur > 0) params.set('blur', blur);
    const sharp = parseInt(tfSharp.value);
    if (sharp > 0) params.set('sharpen', sharp);

    return base + '?' + params.toString();
  }

  let previewTimer = null;
  function updateTransform() {
    // Update labels
    const w = parseInt(tfW.value);
    document.getElementById('tf-w-val').textContent = w > 0 ? w : 'auto';
    const h = parseInt(tfH.value);
    document.getElementById('tf-h-val').textContent = h > 0 ? h + 'px' : 'auto';
    document.getElementById('tf-q-val').textContent = tfQ.value;
    document.getElementById('tf-blur-val').textContent = tfBlur.value;
    document.getElementById('tf-sharp-val').textContent = tfSharp.value;

    const url = buildTransformUrl(false);
    const previewUrl = buildTransformUrl(true);
    tfOutput.textContent = url || 'Enter a source image URL';

    // Code snippets
    if (url) {
      document.getElementById('tf-snippet-html').textContent = `<img src="${url}" alt="Asset" loading="lazy">`;
      document.getElementById('tf-snippet-md').textContent = `![Asset](${url})`;
      document.getElementById('tf-snippet-css').textContent = `background-image: url('${url}');`;
    } else {
      document.getElementById('tf-snippet-html').textContent = '';
      document.getElementById('tf-snippet-md').textContent = '';
      document.getElementById('tf-snippet-css').textContent = '';
    }

    // Debounce preview load
    clearTimeout(previewTimer);
    if (previewUrl) {
      const url = previewUrl;
      previewTimer = setTimeout(() => {
        tfPreview.onerror = () => {
          tfPreview.style.display = 'none';
          tfPlaceholder.style.display = '';
          tfPlaceholder.innerHTML = 'Preview unavailable locally.<br><span style="font-size:0.75rem;color:var(--text-dim);">The Transform API requires Cloudflare Image Resizing.<br>Deploy to production or run with <code style="color:#a5b4fc;">wrangler pages dev</code>.</span>';
        };
        tfPreview.onload = () => {
          tfPreview.style.display = '';
          tfPlaceholder.style.display = 'none';
        };
        tfPreview.src = url;
      }, 500);
    }
  }

  [tfUrl, tfW, tfH, tfFormat, tfFit, tfGravity, tfQ, tfBlur, tfSharp].forEach(el => {
    el.addEventListener('input', updateTransform);
    el.addEventListener('change', updateTransform);
  });

  tfCopy.addEventListener('click', () => {
    const url = buildTransformUrl(false);
    if (url) copyToClipboard(url, 'Transform URL');
  });

  // Asset picker — populate with image assets from manifest
  const tfPicker = document.getElementById('tf-picker');
  function populateAssetPicker() {
    const images = manifest.filter(a => ['png', 'webp', 'avif', 'svg'].includes(a.format));
    // Group by project, pick one representative per project (prefer logos/banners)
    const seen = new Set();
    const picks = [];
    for (const a of images) {
      if (!seen.has(a.project) && (a.category === 'logos' || a.category === 'banners' || picks.length < 50)) {
        seen.add(a.project);
        picks.push(a);
      }
    }
    picks.sort((a, b) => a.project.localeCompare(b.project));
    for (const a of picks.slice(0, 50)) {
      const opt = document.createElement('option');
      opt.value = '/' + a.path;
      opt.textContent = `${a.project} / ${a.name}`;
      tfPicker.appendChild(opt);
    }
  }

  tfPicker.addEventListener('change', () => {
    if (tfPicker.value) {
      tfUrl.value = tfPicker.value;
      updateTransform();
    }
  });

  // Presets
  document.querySelectorAll('.tf-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      tfW.value = btn.dataset.w || '0';
      tfH.value = btn.dataset.h || '0';
      tfFit.value = btn.dataset.fit || '';
      tfFormat.value = btn.dataset.fmt || 'webp';
      tfQ.value = btn.dataset.q || '80';
      tfBlur.value = btn.dataset.blur || '0';
      tfSharp.value = '0';
      updateTransform();
    });
  });

  // Initial render
  updateTransform();

  // ===================================================================
  // INSIGHTS TAB
  // ===================================================================
  let insightsLoaded = false;
  const insightsDays = document.getElementById('insights-days');

  async function loadInsights() {
    insightsLoaded = true;
    const days = insightsDays.value;

    try {
      const res = await fetch(`/api/analytics?days=${days}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      renderInsights(json.data || []);
    } catch {
      document.getElementById('ins-total-hits').textContent = '0';
      document.getElementById('ins-total-bw').textContent = '0 B';
      document.getElementById('ins-cache-ratio').textContent = 'N/A';
      document.getElementById('ins-countries').textContent = '0';
      document.getElementById('ins-chart').innerHTML =
        '<p class="text-gray-500 text-sm w-full text-center py-8">Analytics API unavailable. Requires Cloudflare Workers runtime — deploy to production or run with <code class="text-accent">wrangler pages dev</code>.</p>';
      document.getElementById('ins-top-assets').innerHTML =
        '<p class="text-gray-500">No data collected yet. Analytics populate automatically in production.</p>';
      document.getElementById('ins-geo').innerHTML =
        '<p class="text-gray-500">No data collected yet.</p>';
    }
  }

  function renderInsights(data) {
    // Summary
    let totalHits = 0, totalBw = 0, totalCacheHit = 0, totalCacheMiss = 0;
    const allGeo = {};
    const allTop = {};

    for (const day of data) {
      totalHits += day.hits;
      totalBw += day.bandwidth.bytes;
      totalCacheHit += (day.cache.hit || 0);
      totalCacheMiss += (day.cache.miss || 0);
      for (const [k, v] of Object.entries(day.geo)) allGeo[k] = (allGeo[k] || 0) + v;
      for (const [k, v] of Object.entries(day.top_assets)) allTop[k] = (allTop[k] || 0) + v;
    }

    document.getElementById('ins-total-hits').textContent = totalHits.toLocaleString();
    // Estimate bandwidth from hits if byte tracking is 0 (Pages doesn't always set content-length)
    document.getElementById('ins-total-bw').textContent = totalBw > 0
      ? formatBytes(totalBw)
      : totalHits > 0 ? `~${formatBytes(totalHits * 25000)}` : '0 B';
    const cacheTotal = totalCacheHit + totalCacheMiss;
    document.getElementById('ins-cache-ratio').textContent = cacheTotal > 0
      ? ((totalCacheHit / cacheTotal) * 100).toFixed(1) + '%'
      : totalHits > 0 ? 'Collecting...' : 'N/A';
    document.getElementById('ins-countries').textContent = Object.keys(allGeo).length || (totalHits > 0 ? 'Collecting...' : '0');

    // Bar chart (daily hits)
    const chart = document.getElementById('ins-chart');
    chart.innerHTML = '';
    const reversed = [...data].reverse();
    const maxHits = Math.max(...reversed.map(d => d.hits), 1);

    if (totalHits === 0) {
      chart.innerHTML = '<p class="text-gray-500 text-sm w-full text-center py-8">No traffic recorded yet. Analytics populate as assets are requested in production.</p>';
    } else {
      for (const day of reversed) {
        const pct = (day.hits / maxHits) * 100;
        const bar = document.createElement('div');
        bar.className = 'bar-col';
        bar.style.height = Math.max(pct, 2) + '%';
        const bwLabel = day.bandwidth.bytes > 0 ? day.bandwidth.human : `~${formatBytes(day.hits * 25000)}`;
        bar.innerHTML = `
          <span class="bar-value">${day.hits}</span>
          <span class="bar-label">${day.date.slice(5)}</span>
        `;
        bar.title = `${day.date}: ${day.hits.toLocaleString()} hits, ${bwLabel}`;
        chart.appendChild(bar);
      }
    }

    // Top assets
    const topEl = document.getElementById('ins-top-assets');
    const sortedTop = Object.entries(allTop).sort((a, b) => b[1] - a[1]).slice(0, 20);
    if (sortedTop.length === 0) {
      topEl.innerHTML = '<p class="text-gray-500">No data yet. Assets will appear here as they are requested.</p>';
    } else {
      topEl.innerHTML = sortedTop.map(([path, count]) => {
        const shortPath = path.length > 50 ? '...' + path.slice(-47) : path;
        return `<div class="flex justify-between gap-2"><span class="truncate text-gray-300 font-mono text-[11px]" title="${path}">${shortPath}</span><span class="text-accent-hover shrink-0 font-mono">${count}</span></div>`;
      }).join('');
    }

    // Geo
    const geoEl = document.getElementById('ins-geo');
    const sortedGeo = Object.entries(allGeo).sort((a, b) => b[1] - a[1]);
    if (sortedGeo.length === 0) {
      geoEl.innerHTML = '<p class="text-gray-500">No geographic data yet. Country data populates from Cloudflare headers.</p>';
    } else {
      const maxGeo = sortedGeo[0][1];
      geoEl.innerHTML = sortedGeo.map(([country, count]) => {
        const pct = (count / maxGeo) * 100;
        return `<div class="flex items-center gap-2"><span class="text-gray-300 w-8 shrink-0">${country}</span><div class="flex-1 bg-surface rounded-full h-2 overflow-hidden"><div class="bg-accent h-full rounded-full" style="width:${pct}%"></div></div><span class="text-gray-500 text-[11px] font-mono w-12 text-right shrink-0">${count.toLocaleString()}</span></div>`;
      }).join('');
    }
  }

  insightsDays.addEventListener('change', () => {
    insightsLoaded = false;
    loadInsights();
  });

  // ===================================================================
  // SHARED UTILITIES
  // ===================================================================
  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(`Copied ${label}!`);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('toast-show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('toast-show'), 2000);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // Boot
  init();
})();
