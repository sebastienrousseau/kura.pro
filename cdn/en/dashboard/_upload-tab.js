/**
 * Dashboard upload tab — drag/drop SVG, post to /api/pipeline.
 *
 * Extracted from the inline <script> at the bottom of
 * cdn/en/dashboard/index.html. Same goal as _upload-page.js: keep
 * dashboard CSP at script-src 'self' (no 'unsafe-inline').
 *
 * Replaces the inline onclick/oninput/onchange handlers on the
 * upload UI with event delegation on this script's DOMContentLoaded
 * listener — same UX, no inline-script CSP exception.
 */
(() => {
  let uploadMode = 'client';
  let svgData = null;

  function setUploadMode(mode) {
    uploadMode = mode;
    const clientBtn = document.getElementById('up-mode-client');
    const stockBtn = document.getElementById('up-mode-stock');
    const onCls = 'flex-1 p-4 bg-card border-2 border-accent rounded-xl text-left transition';
    const offCls = 'flex-1 p-4 bg-card border-2 border-border rounded-xl text-left transition';
    clientBtn.className = mode === 'client' ? onCls : offCls;
    stockBtn.className = mode === 'stock' ? onCls : offCls;
    document.getElementById('up-name-field').style.display = mode === 'client' ? '' : 'none';
    checkReady();
  }

  function slugifyName() {
    const raw = document.getElementById('up-name').value;
    const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    document.getElementById('up-slug').textContent = slug ? 'clients/' + slug + '/v1/' : '';
    checkReady();
  }

  function handleSvgFile(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      svgData = e.target.result.split(',')[1]; // base64 after data:...;base64,
      document.getElementById('up-filename').textContent = file.name;
      document.getElementById('up-filename').classList.remove('hidden');
      document.getElementById('up-dropzone').classList.add('border-green-600');
      // Preview via Blob URL <img> — never innerHTML the raw SVG (self-XSS).
      const preview = document.getElementById('up-preview');
      const container = document.getElementById('up-preview-svg');
      container.textContent = '';
      const blob = new Blob([atob(svgData)], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'max-width:160px;max-height:160px;';
      img.alt = file.name;
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
      img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      container.appendChild(img);
      preview.classList.remove('hidden');
      checkReady();
    };
    reader.readAsDataURL(file);
  }

  function checkReady() {
    const nameOk = uploadMode === 'stock' || document.getElementById('up-name').value.trim().length >= 2;
    document.getElementById('up-submit').disabled = !(svgData && nameOk);
  }

  async function executePipeline() {
    const btn = document.getElementById('up-submit');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    const progress = document.getElementById('up-progress');
    const steps = document.getElementById('up-steps');
    progress.classList.remove('hidden');
    steps.textContent = '';

    function addStep(text, status) {
      const el = document.createElement('div');
      el.className = 'flex items-center gap-2 text-sm';
      const dotCls = status === 'done' ? 'text-green-400'
        : status === 'active' ? 'text-accent animate-pulse'
        : status === 'error' ? 'text-red-400'
        : 'text-gray-600';
      const dot = document.createElement('span');
      dot.className = 'w-2 h-2 rounded-full inline-block ' + dotCls;
      dot.style.background = 'currentColor';
      const label = document.createElement('span');
      label.className = 'text-gray-300';
      label.textContent = text;
      el.appendChild(dot);
      el.appendChild(label);
      steps.appendChild(el);
      return el;
    }

    addStep('Validating input...', 'done');
    addStep('Sanitizing SVG...', 'active');

    const name = uploadMode === 'client'
      ? document.getElementById('up-name').value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
      : '';

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'AccountKey': sessionStorage.getItem('accountKey') || '' },
        body: JSON.stringify({
          mode: uploadMode,
          name,
          svg: svgData,
          generateIcons: document.getElementById('up-icons').checked,
          generateBanners: document.getElementById('up-banners').checked,
        }),
      });

      // Promote the "active" step to "done" by swapping its dot's colour class.
      const lastStep = steps.lastChild;
      if (lastStep) {
        const lastDot = lastStep.querySelector('span:first-child');
        if (lastDot) lastDot.className = 'w-2 h-2 rounded-full inline-block text-green-400';
      }
      addStep('Uploading to repository...', 'done');
      addStep('Pipeline complete', 'done');

      if (res.ok) {
        const data = await res.json();
        const result = document.getElementById('up-result');
        const files = document.getElementById('up-result-files');
        result.classList.remove('hidden');
        files.textContent = '';
        (data.Files || []).forEach(f => {
          const el = document.createElement('p');
          el.textContent = f;
          files.appendChild(el);
        });
      } else {
        const err = await res.json();
        addStep('Error: ' + (err.Message || 'Upload failed'), 'error');
      }
    } catch (e) {
      addStep('Network error: ' + e.message, 'error');
    }

    btn.textContent = 'Upload & Generate';
    btn.disabled = false;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const clientBtn = document.getElementById('up-mode-client');
    const stockBtn = document.getElementById('up-mode-stock');
    const nameInput = document.getElementById('up-name');
    const submitBtn = document.getElementById('up-submit');
    const dropzone = document.getElementById('up-dropzone');
    const fileInput = document.getElementById('up-file');

    if (clientBtn) clientBtn.addEventListener('click', () => setUploadMode('client'));
    if (stockBtn) stockBtn.addEventListener('click', () => setUploadMode('stock'));
    if (nameInput) nameInput.addEventListener('input', slugifyName);
    if (submitBtn) submitBtn.addEventListener('click', executePipeline);
    if (dropzone) {
      dropzone.addEventListener('click', () => fileInput && fileInput.click());
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('border-accent'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('border-accent'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('border-accent');
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.svg') && fileInput) {
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          handleSvgFile(fileInput);
        }
      });
    }
    if (fileInput) fileInput.addEventListener('change', () => handleSvgFile(fileInput));
  });
})();
