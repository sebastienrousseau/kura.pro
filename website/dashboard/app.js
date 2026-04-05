(() => {
  'use strict';

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const CDN_BASE = window.location.origin + '/';

  // On localhost (no middleware), prefix tenant paths with clients/
  function assetUrl(path) {
    if (isLocal && !path.startsWith('stocks/') && !path.startsWith('clients/')) {
      return CDN_BASE + 'clients/' + path;
    }
    return CDN_BASE + path;
  }
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
    applyFilters();

    search.addEventListener('input', debounce(applyFilters, 150));
    filterProject.addEventListener('change', applyFilters);
    filterFormat.addEventListener('change', applyFilters);
    filterCategory.addEventListener('change', applyFilters);

    initSearchModal();
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
    const cdnUrl = assetUrl(asset.path);

    // Thumb container
    const thumb = document.createElement('div');
    thumb.className = 'asset-thumb';

    if (isImage) {
      const img = document.createElement('img');
      img.dataset.src = cdnUrl;
      img.alt = asset.name;
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.appendChild(img);
    } else {
      const fmtLabel = document.createElement('div');
      fmtLabel.className = 'text-gray-600 text-3xl';
      fmtLabel.textContent = asset.format.toUpperCase();
      thumb.appendChild(fmtLabel);
    }

    const overlay = document.createElement('div');
    overlay.className = 'copy-overlay';
    const actions = document.createElement('div');
    actions.className = 'copy-actions';

    const buttons = [
      { type: 'url', cls: 'copy-btn', title: 'Copy CDN URL', label: 'URL' },
      { type: 'markdown', cls: 'copy-btn copy-btn-alt', title: 'Copy Markdown', label: 'MD' },
      { type: 'html', cls: 'copy-btn copy-btn-alt', title: 'Copy HTML img tag', label: 'HTML' },
      { type: 'transform', cls: 'copy-btn copy-btn-alt', title: 'Open transform builder', label: 'Transform' },
    ];
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.cls;
      btn.dataset.type = b.type;
      btn.title = b.title;
      btn.textContent = b.label;
      actions.appendChild(btn);
    }
    overlay.appendChild(actions);
    thumb.appendChild(overlay);
    card.appendChild(thumb);

    // Info section
    const info = document.createElement('div');
    info.className = 'px-3 py-2';

    const nameEl = document.createElement('p');
    nameEl.className = 'text-xs text-gray-300 truncate';
    nameEl.title = asset.path;
    nameEl.textContent = asset.name;
    info.appendChild(nameEl);

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between mt-1';

    const badge = document.createElement('span');
    badge.className = 'format-badge ' + asset.format;
    badge.textContent = asset.format;
    row.appendChild(badge);

    const sizeEl = document.createElement('span');
    sizeEl.className = 'text-[10px] text-gray-500';
    sizeEl.textContent = formatBytes(asset.size);
    row.appendChild(sizeEl);

    info.appendChild(row);
    card.appendChild(info);

    card.querySelector('.copy-overlay').addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      e.stopPropagation();
      const type = btn.dataset.type;
      if (type === 'url') copyToClipboard(cdnUrl, 'URL');
      else if (type === 'markdown') copyToClipboard(`![${asset.name}](${cdnUrl})`, 'Markdown');
      else if (type === 'html') copyToClipboard(`<img src="${cdnUrl}" alt="${asset.name}">`, 'HTML');
      else if (type === 'transform') openTransformPanel('/' + asset.path, asset.name);
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
  // TRANSFORM SLIDE-OUT PANEL
  // ===================================================================
  const tfPanel = document.getElementById('tf-panel');
  const tfBackdrop = document.getElementById('tf-backdrop');
  const tfClose = document.getElementById('tf-close');
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
  const tfAssetName = document.getElementById('tf-asset-name');

  function openTransformPanel(path, name) {
    tfUrl.value = path;
    tfAssetName.textContent = name;
    // Reset to defaults
    tfW.value = 800; tfH.value = 0; tfFormat.value = 'webp'; tfFit.value = '';
    tfGravity.value = ''; tfQ.value = 80; tfBlur.value = 0; tfSharp.value = 0;
    updateTransform();
    tfBackdrop.style.display = '';
    requestAnimationFrame(() => {
      tfBackdrop.classList.add('open');
      tfPanel.classList.add('open');
    });
  }

  function closeTransformPanel() {
    tfPanel.classList.remove('open');
    tfBackdrop.classList.remove('open');
    setTimeout(() => { tfBackdrop.style.display = 'none'; }, 250);
  }

  tfClose.addEventListener('click', closeTransformPanel);
  tfBackdrop.addEventListener('click', closeTransformPanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tfPanel.classList.contains('open')) closeTransformPanel();
  });

  function buildTransformUrl() {
    const base = window.location.origin + '/api/transform';
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
    const w = parseInt(tfW.value);
    document.getElementById('tf-w-val').textContent = w > 0 ? w : 'auto';
    const h = parseInt(tfH.value);
    document.getElementById('tf-h-val').textContent = h > 0 ? h + 'px' : 'auto';
    document.getElementById('tf-q-val').textContent = tfQ.value;
    document.getElementById('tf-blur-val').textContent = tfBlur.value;
    document.getElementById('tf-sharp-val').textContent = tfSharp.value;

    const url = buildTransformUrl();
    tfOutput.textContent = url || '';

    if (url) {
      document.getElementById('tf-snippet-html').textContent = `<img src="${url}" alt="Asset" loading="lazy">`;
      document.getElementById('tf-snippet-md').textContent = `![Asset](${url})`;
      document.getElementById('tf-snippet-css').textContent = `background-image: url('${url}');`;
    }

    clearTimeout(previewTimer);
    if (url) {
      previewTimer = setTimeout(() => {
        tfPreview.onerror = () => { tfPreview.style.display = 'none'; tfPlaceholder.style.display = ''; };
        tfPreview.onload = () => { tfPreview.style.display = ''; tfPlaceholder.style.display = 'none'; };
        tfPreview.src = url;
      }, 400);
    }
  }

  [tfW, tfH, tfFormat, tfFit, tfGravity, tfQ, tfBlur, tfSharp].forEach(el => {
    el.addEventListener('input', updateTransform);
    el.addEventListener('change', updateTransform);
  });

  tfCopy.addEventListener('click', () => {
    const url = buildTransformUrl();
    if (url) copyToClipboard(url, 'Transform URL');
  });

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
      const p = document.createElement('p');
      p.className = 'text-gray-500 text-sm w-full text-center py-8';
      p.textContent = 'No traffic recorded yet. Analytics populate as assets are requested in production.';
      chart.appendChild(p);
    } else {
      for (const day of reversed) {
        const pct = (day.hits / maxHits) * 100;
        const bar = document.createElement('div');
        bar.className = 'bar-col';
        bar.style.height = Math.max(pct, 2) + '%';
        const bwLabel = day.bandwidth.bytes > 0 ? day.bandwidth.human : `~${formatBytes(day.hits * 25000)}`;
        const barValue = document.createElement('span');
        barValue.className = 'bar-value';
        barValue.textContent = day.hits;
        const barLabel = document.createElement('span');
        barLabel.className = 'bar-label';
        barLabel.textContent = day.date.slice(5);
        bar.appendChild(barValue);
        bar.appendChild(barLabel);
        bar.title = `${day.date}: ${day.hits.toLocaleString()} hits, ${bwLabel}`;
        chart.appendChild(bar);
      }
    }

    // Top assets
    const topEl = document.getElementById('ins-top-assets');
    const sortedTop = Object.entries(allTop).sort((a, b) => b[1] - a[1]).slice(0, 20);
    topEl.innerHTML = '';
    if (sortedTop.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-gray-500';
      p.textContent = 'No data yet. Assets will appear here as they are requested.';
      topEl.appendChild(p);
    } else {
      for (const [path, count] of sortedTop) {
        const shortPath = path.length > 50 ? '...' + path.slice(-47) : path;
        const row = document.createElement('div');
        row.className = 'flex justify-between gap-2';
        const pathSpan = document.createElement('span');
        pathSpan.className = 'truncate text-gray-300 font-mono text-[11px]';
        pathSpan.title = path;
        pathSpan.textContent = shortPath;
        const countSpan = document.createElement('span');
        countSpan.className = 'text-accent-hover shrink-0 font-mono';
        countSpan.textContent = count;
        row.appendChild(pathSpan);
        row.appendChild(countSpan);
        topEl.appendChild(row);
      }
    }

    // Geo
    const geoEl = document.getElementById('ins-geo');
    const sortedGeo = Object.entries(allGeo).sort((a, b) => b[1] - a[1]);
    geoEl.innerHTML = '';
    if (sortedGeo.length === 0) {
      const p = document.createElement('p');
      p.className = 'text-gray-500';
      p.textContent = 'No geographic data yet. Country data populates from Cloudflare headers.';
      geoEl.appendChild(p);
    } else {
      const maxGeo = sortedGeo[0][1];
      for (const [country, count] of sortedGeo) {
        const pct = (count / maxGeo) * 100;
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';

        const countrySpan = document.createElement('span');
        countrySpan.className = 'text-gray-300 w-8 shrink-0';
        countrySpan.textContent = country;
        row.appendChild(countrySpan);

        const barOuter = document.createElement('div');
        barOuter.className = 'flex-1 bg-surface rounded-full h-2 overflow-hidden';
        const barInner = document.createElement('div');
        barInner.className = 'bg-accent h-full rounded-full';
        barInner.style.width = pct + '%';
        barOuter.appendChild(barInner);
        row.appendChild(barOuter);

        const countSpan = document.createElement('span');
        countSpan.className = 'text-gray-500 text-[11px] font-mono w-12 text-right shrink-0';
        countSpan.textContent = count.toLocaleString();
        row.appendChild(countSpan);

        geoEl.appendChild(row);
      }
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

  // ===================================================================
  // SEARCH MODAL (Cmd+K / Ctrl+K spotlight)
  // ===================================================================
  function initSearchModal() {
    const modal = document.getElementById('search-modal');
    const backdrop = document.getElementById('search-modal-backdrop');
    const input = document.getElementById('search-modal-input');
    const results = document.getElementById('search-modal-results');
    const trigger = document.getElementById('search-trigger');
    let selectedIdx = -1;

    function openModal() {
      modal.classList.remove('hidden');
      input.value = '';
      selectedIdx = -1;
      renderResults('');
      requestAnimationFrame(() => input.focus());
    }

    function closeModal() {
      modal.classList.add('hidden');
      input.value = '';
    }

    // Trigger button
    if (trigger) trigger.addEventListener('click', openModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Cmd+K or Ctrl+K opens modal
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (modal.classList.contains('hidden')) openModal();
        else closeModal();
        return;
      }
      // "/" opens modal (when not in input)
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        openModal();
        return;
      }
      // Escape closes
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        e.preventDefault();
        closeModal();
      }
    });

    // Backdrop click closes
    backdrop.addEventListener('click', closeModal);

    // Search input
    input.addEventListener('input', debounce(() => {
      selectedIdx = -1;
      renderResults(input.value.trim());
    }, 100));

    // Arrow key navigation + Enter select
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('[data-result]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = Math.max(selectedIdx - 1, 0);
        updateSelection(items);
      } else if (e.key === 'Enter' && selectedIdx >= 0 && items[selectedIdx]) {
        e.preventDefault();
        const path = items[selectedIdx].dataset.result;
        selectResult(path);
      }
    });

    function updateSelection(items) {
      items.forEach((el, i) => {
        el.classList.toggle('bg-accent/10', i === selectedIdx);
        el.classList.toggle('border-accent/30', i === selectedIdx);
        if (i === selectedIdx) el.scrollIntoView({ block: 'nearest' });
      });
    }

    function renderResults(query) {
      if (!query) {
        // Show recent / popular when empty
        const recent = manifest.slice(0, 8);
        if (recent.length === 0) {
          results.innerHTML = '<div class="text-xs text-gray-500 px-3 py-6 text-center">Type to search across all assets</div>';
          return;
        }
        results.innerHTML = '<div class="text-[10px] text-gray-500 uppercase tracking-wider px-3 pt-2 pb-1">Recent assets</div>' +
          recent.map(a => resultItem(a)).join('');
        return;
      }

      const q = query.toLowerCase();
      const matches = manifest
        .filter(a => a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q) || a.project.toLowerCase().includes(q))
        .slice(0, 20);

      if (matches.length === 0) {
        results.innerHTML = `<div class="text-xs text-gray-500 px-3 py-6 text-center">No results for "<span class="text-white">${escHtml(query)}</span>"</div>`;
        return;
      }

      results.innerHTML = '<div class="text-[10px] text-gray-500 uppercase tracking-wider px-3 pt-2 pb-1">' + matches.length + ' results</div>' +
        matches.map(a => resultItem(a)).join('');
    }

    function resultItem(asset) {
      const ext = asset.format.toUpperCase();
      const badgeColor = ext === 'SVG' ? 'text-emerald-400' : ext === 'PNG' ? 'text-blue-400' : ext === 'WEBP' ? 'text-purple-400' : ext === 'AVIF' ? 'text-orange-400' : 'text-gray-400';
      return `<div data-result="${escAttr(asset.path)}" class="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-white/5 border border-transparent transition" onclick="document.querySelector('#search-modal').__selectResult('${escAttr(asset.path)}')">
        <div class="w-8 h-8 bg-card rounded border border-border flex items-center justify-center shrink-0 overflow-hidden">
          ${['png','webp','avif','svg'].includes(asset.format) ? `<img src="${escAttr(assetUrl(asset.path))}" class="w-full h-full object-contain" loading="lazy" alt="">` : `<span class="text-[9px] ${badgeColor} font-bold">${ext}</span>`}
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-white truncate">${escHtml(asset.name)}</div>
          <div class="text-[11px] text-gray-500 truncate">${escHtml(asset.project)} / ${escHtml(asset.category)}</div>
        </div>
        <span class="text-[9px] ${badgeColor} font-mono font-bold shrink-0">${ext}</span>
      </div>`;
    }

    function selectResult(path) {
      closeModal();
      // Set the hidden search input and apply filters to scroll to the result
      search.value = path.split('/').pop().replace(/\.\w+$/, '');
      search.dispatchEvent(new Event('input'));
      // Switch to assets tab if not already active
      const assetsBtn = document.querySelector('[data-tab="assets"]');
      if (assetsBtn && !assetsBtn.classList.contains('active')) assetsBtn.click();
    }

    // Expose selectResult for inline onclick
    modal.__selectResult = selectResult;

    function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escAttr(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  }

  // Boot
  init();
})();
