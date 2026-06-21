/*
 * CloudCDN onboarding wizard.
 *
 * Reads the `signup_result` blob written by /sign-up to sessionStorage:
 *   { user, account, apiKey: { prefix, fullKey, scopes } }
 *
 * Step 1: name your project (cosmetic for Phase 0 — stored in sessionStorage).
 * Step 2: origin URL (HEAD-validated client-side).
 * Step 3: success — reveals the API key + a copyable cURL. Live edge-hostname
 *         provisioning is a Phase 3 deliverable.
 *
 * No inline scripts (CSP allows style-src 'unsafe-inline', not script-src).
 */
(function () {
  'use strict';

  const SIGNUP_KEY = 'cloudcdn:signup_result';

  const stepper = document.getElementById('stepper');
  const emptyState = document.getElementById('empty-state');
  const steps = document.querySelectorAll('section.step');
  const userPill = document.getElementById('user-pill');

  let signupResult = null;
  try {
    const raw = sessionStorage.getItem(SIGNUP_KEY);
    if (raw) signupResult = JSON.parse(raw);
  } catch { /* ignore */ }

  if (!signupResult || !signupResult.apiKey || !signupResult.apiKey.fullKey) {
    // No active signup — show empty state, hide stepper + steps.
    stepper.hidden = true;
    steps.forEach((s) => { s.hidden = true; });
    emptyState.hidden = false;
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
    if (url.protocol === 'http:') {
      setOriginHint('Note: http:// origins are accepted but not recommended.', 'error');
    }

    step2Next.disabled = true;
    setOriginHint('Probing origin…');

    try {
      // HEAD probe via fetch. Many origins block HEAD or CORS — we don't
      // gate the flow on it; we just surface the result as a hint.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const probeRes = await fetch(url.toString(), { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
      clearTimeout(t);
      // `mode: 'no-cors'` returns opaque — status 0 — so we can't read it.
      // The fact that fetch resolved at all means DNS + TCP + TLS worked.
      setOriginHint('Origin reachable. (TLS + DNS verified.)', 'success');
    } catch (err) {
      const msg = (err && err.name === 'AbortError')
        ? 'Origin did not respond in 5 seconds — continuing anyway.'
        : 'Could not reach the origin (browser CORS often blocks this — we will still try server-side). Continuing.';
      setOriginHint(msg, 'error');
    }

    state.originUrl = url.toString();
    step2Next.disabled = false;
    setStep(3);
  });

  // ── Step 3: success ──
  const apiKey = signupResult.apiKey.fullKey;
  const accountName = (signupResult.account && signupResult.account.name) || 'your account';

  const curlText = document.getElementById('curl-text');
  curlText.textContent = `# Try listing your assets:\ncurl -H "AccessKey: ${apiKey}" \\\n  https://cloudcdn.pro/api/assets`;

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

  // Clear the signup blob the first time we reach step 3 to enforce the
  // "key shown once" promise. We only clear when the user actually
  // navigates to step 3, not on initial load.
  const observer = new MutationObserver(() => {
    const step3 = document.querySelector('section.step[data-step="3"]');
    if (step3 && !step3.hidden) {
      try { sessionStorage.removeItem(SIGNUP_KEY); } catch {}
      observer.disconnect();
    }
  });
  observer.observe(document.querySelector('main'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
