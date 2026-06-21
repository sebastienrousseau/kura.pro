/*
 * CloudCDN sign-up page client logic.
 *
 * Backend is stubbed for the first pass — every server call surfaces what
 * WOULD be sent in the status banner so the form is exercisable end-to-end
 * before the auth endpoints land. Real wiring goes in once
 * functions/api/auth/* ships in the next Phase 0 PR.
 *
 * No third-party deps; no inline event handlers (CSP only allows
 * style-src 'unsafe-inline', not script-src).
 */
(function () {
  'use strict';

  const form = document.getElementById('signup-form');
  const status = document.getElementById('status');
  const submitBtn = document.getElementById('submit-btn');
  const passkeyBtn = document.getElementById('passkey-btn');
  const passwordToggle = document.getElementById('password-toggle');
  const passwordInput = document.getElementById('password');
  const eyeOpen = document.getElementById('eye-open');
  const eyeClosed = document.getElementById('eye-closed');
  const passwordStrength = document.getElementById('password-strength');
  const tsField = document.getElementById('ts-field');
  const emailInput = document.getElementById('email');
  const tosCheckbox = document.getElementById('consent-tos');
  const marketingCheckbox = document.getElementById('consent-marketing');

  // Anti-abuse: capture form-render timestamp for time-to-fill scoring.
  const renderedAt = Date.now();
  tsField.value = String(renderedAt);

  let turnstileToken = null;

  function setStatus(message, level) {
    status.textContent = message;
    status.classList.remove('info', 'error');
    status.classList.add(level || 'info');
    status.classList.add('show');
  }

  function clearStatus() {
    status.classList.remove('show');
    status.textContent = '';
  }

  // Turnstile callbacks — registered on window so the widget can find them.
  window.onTurnstileVerify = function (token) {
    turnstileToken = token;
  };
  window.onTurnstileError = function () {
    turnstileToken = null;
    setStatus('Bot-check failed. Please refresh and try again.', 'error');
  };

  // Password visibility toggle.
  passwordToggle.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    eyeOpen.style.display = showing ? '' : 'none';
    eyeClosed.style.display = showing ? 'none' : '';
    passwordToggle.setAttribute('aria-pressed', String(!showing));
    passwordToggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });

  // Lightweight client-side password feedback. The real HIBP k-anonymity
  // check + Argon2id hashing run server-side; this is just instant UI feel.
  passwordInput.addEventListener('input', () => {
    const v = passwordInput.value;
    if (!v) {
      passwordStrength.textContent = '';
      passwordStrength.className = 'password-strength';
      return;
    }
    if (v.length < 12) {
      passwordStrength.textContent = 'Too short — minimum 12 characters.';
      passwordStrength.className = 'password-strength weak';
      return;
    }
    passwordStrength.textContent = 'Looks good. We will check it against the Pwned-Passwords list on submit.';
    passwordStrength.className = 'password-strength ok';
  });

  // OAuth provider buttons — redirect to the provider-begin endpoint.
  document.querySelectorAll('.oauth-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const provider = btn.getAttribute('data-provider');
      // STUB: real flow is `window.location.href = '/api/auth/oauth/' + provider + '/begin'`
      setStatus(
        'OAuth wiring not deployed yet. Production flow will redirect to /api/auth/oauth/' +
          provider + '/begin (handled by Arctic on Cloudflare Workers).',
        'info'
      );
    });
  });

  // Passkey-first registration.
  passkeyBtn.addEventListener('click', async () => {
    clearStatus();

    // Capture email up front so the account always has a recoverable channel.
    const email = (emailInput.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.focus();
      setStatus('Enter your email before creating a passkey — we need at least one recovery channel.', 'error');
      return;
    }
    if (!tosCheckbox.checked) {
      tosCheckbox.focus();
      setStatus('Accept the Terms of Service to continue.', 'error');
      return;
    }

    // Feature-detect WebAuthn before promising anything.
    if (!('credentials' in navigator) || !('create' in navigator.credentials)) {
      setStatus('Your browser does not support passkeys. Use email + password or an OAuth provider above.', 'error');
      return;
    }

    passkeyBtn.disabled = true;
    setStatus('STUB: would POST /api/auth/passkey/register/begin with { email } → receive a WebAuthn challenge → call navigator.credentials.create({ publicKey }) → POST /api/auth/passkey/register/complete with the attestation. Auto-create User + Account + default API key. Redirect to /onboarding.', 'info');
    setTimeout(() => { passkeyBtn.disabled = false; }, 2500);
  });

  // Email + password submit.
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();

    const email = (emailInput.value || '').trim();
    const password = passwordInput.value;
    const honeypot = form.elements.company_website.value;
    const elapsed = Date.now() - renderedAt;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.focus();
      setStatus('Enter a valid email address.', 'error');
      return;
    }
    if (!password || password.length < 12) {
      passwordInput.focus();
      setStatus('Password must be at least 12 characters.', 'error');
      return;
    }
    if (!tosCheckbox.checked) {
      tosCheckbox.focus();
      setStatus('Accept the Terms of Service to continue.', 'error');
      return;
    }
    if (honeypot) {
      setStatus('Submission rejected.', 'error');
      return;
    }
    if (elapsed < 1500) {
      setStatus('Slow down — that was suspiciously fast. Try again.', 'error');
      return;
    }
    if (!turnstileToken) {
      setStatus('Complete the human-verification check above before submitting.', 'error');
      return;
    }

    submitBtn.disabled = true;
    setStatus('Creating your account…');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          email,
          password,
          consents: {
            tos: tosCheckbox.checked,
            marketing: marketingCheckbox.checked,
          },
          turnstile: turnstileToken,
          ts_elapsed_ms: elapsed,
          company_website: honeypot,
        }),
      });

      let body = null;
      try { body = await res.json(); } catch { /* non-JSON */ }

      if (res.status === 201 && body && body.apiKey) {
        // Persist the one-shot reveal payload so /onboarding can show it.
        //
        // NOTE: CodeQL flags this as "clear-text storage of sensitive data"
        // (rule js/clear-text-storage-of-sensitive-info). The trade-off is
        // intentional and bounded for Phase 0:
        //   - The page enforces a strict CSP (script-src 'self' only +
        //     challenges.cloudflare.com — see _headers /sign-up*).
        //   - sessionStorage is per-tab and cleared on close.
        //   - /onboarding clears the entry as soon as Step 3 is reached
        //     (see _onboarding.js MutationObserver).
        //   - Both pages are gated behind Cloudflare Access + LAUNCH_PUBLIC=0,
        //     so only the owner + invited testers reach this code today.
        // Follow-up will replace this with a server-side handoff
        // (HttpOnly Path=/onboarding cookie + /api/auth/signup/reveal
        // endpoint) so the key never lands in JS-readable storage.
        try {
          sessionStorage.setItem('cloudcdn:signup_result', JSON.stringify({
            user: body.user,
            account: body.account,
            apiKey: body.apiKey,
          }));
        } catch { /* sessionStorage may be disabled */ }
        window.location.assign(body.redirectTo || '/onboarding');
        return;
      }

      const code = body && body.error && body.error.code;
      const msg = (body && body.error && body.error.message) || 'Something went wrong. Please try again.';
      if (code === 'launch_gated') {
        setStatus('Sign-up is not open yet. This page is in private preview.', 'error');
      } else if (code === 'email_exists') {
        setStatus('An account with that email already exists. Try logging in.', 'error');
      } else if (code === 'rate_limited') {
        setStatus('Too many sign-up attempts. Please wait a few minutes.', 'error');
      } else {
        setStatus(msg, 'error');
      }
    } catch (err) {
      setStatus('Network error — check your connection and retry.', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
