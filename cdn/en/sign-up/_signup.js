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
      // ToS acceptance is enforced server-side too (the OAuth callback
      // creates the account), but surface it client-side to avoid an
      // 8-second round-trip just to learn the user forgot to tick a box.
      if (!tosCheckbox.checked) {
        tosCheckbox.focus();
        setStatus('Accept the Terms of Service to continue.', 'error');
        return;
      }
      clearStatus();
      window.location.assign(`/api/auth/oauth/${provider}/begin`);
    });
  });

  // Surface OAuth errors bounced back via the URL fragment
  // (#oauth_error=...). Parse on load so the page can show "Google
  // returned access_denied" rather than silently doing nothing.
  if (window.location.hash.startsWith('#oauth_error=')) {
    const reason = window.location.hash.slice('#oauth_error='.length);
    setStatus(`Sign-in cancelled or refused (${reason}). Try again, or use a different method.`, 'error');
    // Strip the fragment so a reload doesn't keep showing the error.
    history.replaceState(null, '', window.location.pathname);
  }

  // Passkey-first registration — the differentiator vs Cloudflare's
  // current dashboard signup (which doesn't offer passkeys).
  passkeyBtn.addEventListener('click', async () => {
    clearStatus();

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
    if (!('credentials' in navigator) || !('create' in navigator.credentials)) {
      setStatus('Your browser does not support passkeys. Use email + password or an OAuth provider above.', 'error');
      return;
    }

    passkeyBtn.disabled = true;
    setStatus('Talk to your authenticator…');

    try {
      // 1. Begin: get WebAuthn options from the server.
      const beginRes = await fetch('/api/auth/passkey/register/begin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      const beginBody = await beginRes.json().catch(() => null);
      if (!beginRes.ok || !beginBody || !beginBody.challenge) {
        const code = beginBody && beginBody.error && beginBody.error.code;
        const msg = (beginBody && beginBody.error && beginBody.error.message) || 'Could not start passkey registration.';
        setStatus(code === 'email_exists' ? msg + ' Use "Log in" below.' : msg, 'error');
        return;
      }

      // 2. Browser ceremony.
      const opts = {
        rp: beginBody.rp,
        user: {
          id: b64urlToBytes(beginBody.user.id),
          name: beginBody.user.name,
          displayName: beginBody.user.displayName,
        },
        challenge: b64urlToBytes(beginBody.challenge),
        pubKeyCredParams: beginBody.pubKeyCredParams,
        authenticatorSelection: beginBody.authenticatorSelection,
        timeout: beginBody.timeout,
        attestation: beginBody.attestation,
        excludeCredentials: (beginBody.excludeCredentials || []).map((c) => ({
          type: c.type, id: b64urlToBytes(c.id),
        })),
      };
      const cred = await navigator.credentials.create({ publicKey: opts });
      if (!cred) {
        setStatus('Passkey creation was cancelled.', 'error');
        return;
      }

      const credentialId = bytesToB64url(new Uint8Array(cred.rawId));
      // getPublicKey() is the standardised way to obtain the SPKI bytes;
      // older Safari may not expose it, in which case we fall back to
      // attestationObject (the server's existing legacy path handles it).
      const pkBuf = cred.response.getPublicKey ? cred.response.getPublicKey() : cred.response.attestationObject;
      const publicKey = bytesToB64url(new Uint8Array(pkBuf));

      // 3. Complete: server creates the account + sets cookies.
      const completeRes = await fetch('/api/auth/passkey/register/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, credentialId, publicKey, challenge: beginBody.challenge, name: 'Passkey' }),
      });
      const completeBody = await completeRes.json().catch(() => null);
      if (completeRes.status === 201 && completeBody && completeBody.account) {
        window.location.assign(completeBody.redirectTo || '/onboarding');
        return;
      }
      const code = completeBody && completeBody.error && completeBody.error.code;
      const msg = (completeBody && completeBody.error && completeBody.error.message) || 'Passkey registration failed.';
      setStatus(code === 'email_exists' ? msg + ' Use "Log in" below.' : msg, 'error');
    } catch (err) {
      setStatus(err && err.name === 'NotAllowedError'
        ? 'Passkey creation was cancelled or timed out.'
        : 'Could not complete passkey registration — try again or use another method.', 'error');
    } finally {
      passkeyBtn.disabled = false;
    }
  });

  // ── base64url helpers ──
  function b64urlToBytes(b64url) {
    const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function bytesToB64url(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

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

      if (res.status === 201 && body && body.account) {
        // Server set the cdn_signup_reveal cookie (HttpOnly + Path-
        // scoped). /onboarding will fetch it via /api/auth/signup/
        // reveal. The API key value never crosses through this script.
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
