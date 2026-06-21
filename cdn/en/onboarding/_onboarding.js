/*
 * CloudCDN onboarding wizard.
 *
 * Reveals the just-issued API key once by calling
 * POST /api/auth/signup/reveal — the server returns the key from a
 * short-lived HttpOnly cookie set during signup, then clears the
 * cookie. The key never lands in sessionStorage / localStorage / URL
 * fragments.
 *
 * Step 1: name your project (cosmetic for Phase 0 — kept in JS closure).
 * Step 2: origin URL (HEAD-validated client-side).
 * Step 3: success — reveals the API key + a copyable cURL. Live
 *         edge-hostname provisioning is a Phase 3 deliverable.
 *
 * No inline scripts (CSP allows style-src 'unsafe-inline', not
 * script-src).
 */
(async function () {
  'use strict';

  const stepper = document.getElementById('stepper');
  const emptyState = document.getElementById('empty-state');
  const steps = document.querySelectorAll('section.step');
  const userPill = document.getElementById('user-pill');

  function showEmptyState() {
    stepper.hidden = true;
    steps.forEach((s) => { s.hidden = true; });
    emptyState.hidden = false;
  }

  // Fetch the one-shot reveal. Failure modes:
  //   401  no session       → empty state, point at /sign-up
  //   404  no reveal cookie → empty state (landed here without signup)
  //   200  got the payload  → continue wizard
  // Any other status is treated as "no active signup" too.
  let signupResult = null;
  try {
    const res = await fetch('/api/auth/signup/reveal', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 200) {
      const body = await res.json();
      if (body && body.apiKey && body.apiKey.fullKey) signupResult = body;
    }
  } catch { /* network — fall through to empty state */ }

  if (!signupResult) {
    showEmptyState();
    return;
  }

  // Show the signed-in user's email in the header pill.
  if (signupResult.user && signupResult.user.email) {
    userPill.textContent = signupResult.user.email;
    userPill.hidden = false;
  }

  // ── State ──
  const state = {
    step: 1,
    projectName: 'my-first-zone',
    originUrl: '',
  };

  function setStep(n) {
    state.step = n;
    stepper.setAttribute('aria-valuenow', String(n));
    document.querySelectorAll('.step-dot').forEach((d) => {
      const s = Number(d.getAttribute('data-step'));
      d.classList.remove('active', 'done');
      if (s < n) d.classList.add('done');
      else if (s === n) d.classList.add('active');
    });
    steps.forEach((sec) => {
      const s = Number(sec.getAttribute('data-step'));
      sec.hidden = s !== n;
    });
    // Focus the first input in the active step for keyboard users.
    const active = document.querySelector(`section.step[data-step="${n}"]`);
    if (active) {
      const input = active.querySelector('input');
      if (input) input.focus({ preventScroll: true });
    }
  }

  // ── Step 1: project name ──
  const projectNameInput = document.getElementById('project-name');
  const projectNameHint = document.getElementById('project-name-hint');
  const step1Next = document.getElementById('step1-next');

  function validateProjectName(v) {
    if (!v || v.length < 1) return 'Required.';
    if (v.length > 64) return 'Max 64 characters.';
    if (!/^[a-z0-9-]+$/.test(v)) return 'Lowercase letters, numbers, and hyphens only.';
    return null;
  }

  projectNameInput.addEventListener('input', () => {
    const err = validateProjectName(projectNameInput.value.trim());
    projectNameHint.textContent = err || 'Lowercase letters, numbers, and hyphens.';
    projectNameHint.classList.toggle('error', !!err);
    step1Next.disabled = !!err;
  });

  step1Next.addEventListener('click', () => {
    const v = projectNameInput.value.trim();
    const err = validateProjectName(v);
    if (err) { projectNameInput.focus(); return; }
    state.projectName = v;
    setStep(2);
  });

  // ── Step 2: origin URL ──
  const originUrlInput = document.getElementById('origin-url');
  const originUrlHint = document.getElementById('origin-url-hint');
  const step2Next = document.getElementById('step2-next');
  const step2Back = document.getElementById('step2-back');

  step2Back.addEventListener('click', () => setStep(1));

  function setOriginHint(text, level) {
    originUrlHint.textContent = text;
    originUrlHint.classList.remove('error', 'success');
    if (level) originUrlHint.classList.add(level);
  }

  step2Next.addEventListener('click', async () => {
    const raw = originUrlInput.value.trim();
    if (!raw) {
      setOriginHint('Required.', 'error');
      originUrlInput.focus();
      return;
    }
    let url;
    try { url = new URL(raw); } catch {
      setOriginHint('That does not look like a valid URL.', 'error');
      originUrlInput.focus();
      return;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      setOriginHint('Must be http:// or https://', 'error');
      originUrlInput.focus();
      return;
    }

    step2Next.disabled = true;
    setOriginHint('Provisioning your zone…');

    try {
      // Server-side provision: validates origin reachability, generates
      // a slug + edge hostname, persists an account_zones row. Replaces
      // the client-side no-cors HEAD probe which couldn't read the
      // response status (opaque) and didn't persist anything.
      const res = await fetch('/api/auth/onboarding/zone', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: state.projectName, originUrl: url.toString() }),
      });
      const body = await res.json().catch(() => null);
      if (res.status !== 201 || !body || !body.zone) {
        const code = body && body.error && body.error.code;
        const msg = (body && body.error && body.error.message) || 'Could not provision your zone.';
        setOriginHint(code === 'slug_conflict' ? msg + ' Try a different project name in Step 1.' : msg, 'error');
        return;
      }
      state.zone = body.zone;
      const status = body.zone.originStatus;
      if (status === 'ok') {
        setOriginHint('Origin reachable. Zone created.', 'success');
      } else if (status === 'timeout' || status === 'unreachable') {
        setOriginHint('Zone created. (Origin did not respond to a HEAD probe — we will retry on first request.)', 'error');
      } else if (status === 'tls_error') {
        setOriginHint('Zone created. (Origin TLS handshake failed — fix the certificate before going live.)', 'error');
      } else if (status && status.startsWith('http_error:')) {
        setOriginHint('Zone created. (Origin returned ' + status.split(':')[1] + ' to our HEAD probe — many origins refuse HEAD, this may be fine.)', 'error');
      } else {
        setOriginHint('Zone created.', 'success');
      }
      state.originUrl = url.toString();
      setStep(3);
    } catch {
      setOriginHint('Network error reaching the provisioning endpoint. Try again.', 'error');
    } finally {
      step2Next.disabled = false;
    }
  });

  // ── Step 3: success ──
  // Render the cURL one-liner pointing at the provisioned zone's edge
  // hostname (or fall back to the platform endpoint if the user skipped
  // step 2). Live edge-hostname routing is Phase 3 — the hostname here
  // is the aspirational target so the user can wire client code now.
  const apiKey = signupResult.apiKey.fullKey;
  const edgeHostname = (state.zone && state.zone.edgeHostname) || 'cloudcdn.pro';
  const isLive = !!(state.zone && state.zone.live);

  const curlText = document.getElementById('curl-text');
  curlText.textContent = isLive
    ? `# Hit your zone's edge hostname:\ncurl -H "AccessKey: ${apiKey}" \\\n  https://${edgeHostname}/`
    : `# Your zone is provisioned (edge routing pending).\n# Until then, hit the platform API:\ncurl -H "AccessKey: ${apiKey}" \\\n  https://cloudcdn.pro/api/assets`;

  const keyText = document.getElementById('key-text');
  keyText.textContent = apiKey;

  function wireCopy(buttonId, getValue) {
    const btn = document.getElementById(buttonId);
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(getValue());
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      } catch {
        btn.textContent = 'Copy failed';
      }
    });
  }
  wireCopy('copy-curl', () => curlText.textContent);
  wireCopy('copy-key', () => apiKey);

  // ── Bootstrap ──
  setStep(1);

  // The "key shown once" promise is enforced server-side: the reveal
  // endpoint above cleared the cdn_signup_reveal cookie on the first
  // 200, so a page reload here would get 404 and fall to the empty
  // state. No client-side cleanup needed.
})();
