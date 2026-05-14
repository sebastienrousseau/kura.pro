/**
 * Dashboard upload page — drag/drop SVG, sign in via session, post to /api/pipeline.
 *
 * Extracted from the inline <script> in cdn/en/dashboard/upload.html so the
 * dashboard route can ship under script-src 'self' (no 'unsafe-inline').
 */
    (function () {
      const $ = (s) => document.querySelector(s);
      const $$ = (s) => document.querySelectorAll(s);

      // State
      let mode = 'client';
      let svgBase64 = null;
      let svgFileName = null;

      // Mode toggle
      $$('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          $$('.mode-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          mode = btn.dataset.mode;
          $('#name-field').style.display = mode === 'client' ? '' : 'none';
          updateSubmit();
        });
      });

      // Name slugification
      function slugify(s) {
        return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
      }

      $('#name-input').addEventListener('input', (e) => {
        const slug = slugify(e.target.value);
        $('#slug-preview').textContent = slug ? 'Slug: ' + slug : '';
        updateSubmit();
      });

      // File handling
      const dropzone = $('#dropzone');
      const fileInput = $('#file-input');

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFile(fileInput.files[0]);
      });

      function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.svg')) {
          alert('Only SVG files are accepted.');
          return;
        }
        svgFileName = file.name;
        $('#filename').textContent = file.name;
        dropzone.classList.add('has-file');

        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target.result;
          svgBase64 = btoa(text);

          // Preview — render via Blob URL + <img>, NOT innerHTML.
          //
          // Dropping the raw SVG into a container's innerHTML would
          // execute any <script> the file carries (or fire any
          // onerror=, onload=, etc. handlers) in the admin's dashboard
          // origin. That's a self-XSS surface even though the
          // server-side sanitizer cleans the SVG before it's stored.
          //
          // Browsers do NOT execute scripts when an SVG is loaded via
          // <img src="...">: script tags inside are ignored and event
          // handlers don't fire. Same visual result, zero script
          // surface in the dashboard session.
          const preview = $('#preview');
          preview.innerHTML = '';
          const blob = new Blob([text], { type: 'image/svg+xml' });
          const blobUrl = URL.createObjectURL(blob);
          const img = document.createElement('img');
          img.src = blobUrl;
          img.alt = file.name || 'SVG preview';
          img.style.maxWidth = '200px';
          img.style.maxHeight = '200px';
          img.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
          img.addEventListener('error', () => URL.revokeObjectURL(blobUrl), { once: true });
          preview.appendChild(img);
          preview.classList.add('visible');
          updateSubmit();
        };
        reader.readAsText(file);
      }

      function updateSubmit() {
        const nameOk = mode === 'stock' || slugify($('#name-input').value).length >= 2;
        $('#submit-btn').disabled = !(svgBase64 && nameOk);
      }

      // Submit
      $('#submit-btn').addEventListener('click', async () => {
        const btn = $('#submit-btn');
        btn.disabled = true;

        const progress = $('#progress');
        const result = $('#result');
        progress.classList.add('visible');
        result.classList.remove('visible');

        function setStep(name, state) {
          const el = $(`.step[data-step="${name}"]`);
          el.className = 'step ' + state;
        }

        try {
          // Step 1: Validate
          setStep('validate', 'active');
          const slug = slugify($('#name-input').value);
          if (mode === 'client' && slug.length < 2) throw new Error('Name must be at least 2 characters.');
          if (!svgBase64) throw new Error('No SVG file selected.');
          await delay(200);
          setStep('validate', 'done');

          // Step 2: Sanitize (done server-side, but show progress)
          setStep('sanitize', 'active');
          await delay(200);
          setStep('sanitize', 'done');

          // Step 3: Upload
          setStep('upload', 'active');

          const payload = {
            mode,
            name: mode === 'client' ? slug : undefined,
            svg: svgBase64,
            generateFavicon: $('#opt-favicon').checked,
            generateIcons: $('#opt-icons').checked,
            generateBanners: $('#opt-banners').checked,
          };

          const headers = { 'Content-Type': 'application/json' };

          // Auth: try AccountKey from session storage, or cookie-based session
          const accountKey = sessionStorage.getItem('accountKey');
          if (accountKey) headers['AccountKey'] = accountKey;

          const res = await fetch('/api/pipeline', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.Message || data.error?.message || 'Upload failed');
          }

          setStep('upload', 'done');
          setStep('done', 'done');

          // Show result
          const resultEl = $('#result');
          $('#result-header').textContent = data.Message;
          $('#result-header').classList.remove('result-error');

          const fileList = $('#file-list');
          fileList.innerHTML = '';
          (data.Files || []).forEach((f) => {
            const li = document.createElement('li');
            li.textContent = f;
            fileList.appendChild(li);
          });

          if (data.Commit) {
            // Build the commit-line via DOM ops so a server-returned
            // EdgeNote (or a future field with HTML special chars)
            // cannot inject markup into the dashboard. Even though
            // /api/pipeline is the same service, defence-in-depth: any
            // future bug that lets external strings into the response
            // shouldn't immediately become a self-XSS.
            const el = $('#commit-sha');
            el.textContent = '';
            el.appendChild(document.createTextNode('Commit: '));
            const code = document.createElement('code');
            code.textContent = data.Commit.slice(0, 12);
            el.appendChild(code);
            if (data.EdgeNote) {
              el.appendChild(document.createTextNode(' — ' + data.EdgeNote));
            }
          }

          resultEl.classList.add('visible');
        } catch (err) {
          // Mark current active step as error
          const active = $('.step.active');
          if (active) active.className = 'step error';

          const resultEl = $('#result');
          $('#result-header').textContent = err.message;
          $('#result-header').classList.add('result-error');
          $('#file-list').innerHTML = '';
          $('#commit-sha').innerHTML = '';
          resultEl.classList.add('visible');
        } finally {
          btn.disabled = false;
        }
      });

      function delay(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }
    })();
