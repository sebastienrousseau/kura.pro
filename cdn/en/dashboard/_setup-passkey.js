/**
 * Dashboard setup-passkey page — passkey registration flow.
 *
 * Extracted from the SETUP_PASSKEY_HTML template in functions/dashboard/_middleware.js
 * so the page can ship with a strict Content-Security-Policy that does not
 * permit inline <script> blocks (script-src 'self').
 *
 * Served at /dashboard/setup-passkey.js, behind the dashboard session check
 * (only an authenticated admin reaches this page).
 */

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function loadExisting() {
  try {
    const res = await fetch('/api/passkeys', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.Passkeys && data.Passkeys.length > 0) {
      const container = document.getElementById('existing-passkeys');
      container.style.display = 'block';
      // Build via DOM ops — server-returned strings (p.name, p.createdAt)
      // must not be passed through innerHTML.
      container.textContent = '';
      const label = document.createElement('label');
      label.style.marginBottom = '0.5rem';
      label.textContent = 'Registered Passkeys';
      container.appendChild(label);
      for (const p of data.Passkeys) {
        const item = document.createElement('div');
        item.className = 'passkey-item';
        const wrap = document.createElement('div');
        const nameEl = document.createElement('span');
        nameEl.className = 'name';
        nameEl.textContent = p.name;
        const dateEl = document.createElement('span');
        dateEl.className = 'date';
        dateEl.textContent = 'Added ' + new Date(p.createdAt).toLocaleDateString();
        wrap.appendChild(nameEl);
        wrap.appendChild(document.createElement('br'));
        wrap.appendChild(dateEl);
        item.appendChild(wrap);
        container.appendChild(item);
      }
    }
  } catch {}
}

async function registerPasskey() {
  const btn = document.getElementById('register-btn');
  const status = document.getElementById('status');
  const name = document.getElementById('passkey-name').value.trim() || 'Passkey';

  btn.disabled = true;
  status.className = 'status';
  status.textContent = 'Starting registration...';

  try {
    const beginRes = await fetch('/api/passkeys/register/begin', { method: 'POST', credentials: 'include' });
    if (!beginRes.ok) {
      const err = await beginRes.json();
      throw new Error(err.error || 'Failed to start registration');
    }
    const options = await beginRes.json();

    options.challenge = b64urlToBytes(options.challenge);
    options.user.id = b64urlToBytes(options.user.id);
    if (options.excludeCredentials) {
      options.excludeCredentials = options.excludeCredentials.map(c => ({
        ...c, id: b64urlToBytes(c.id),
      }));
    }

    status.textContent = 'Waiting for device...';

    const credential = await navigator.credentials.create({ publicKey: options });

    status.textContent = 'Completing registration...';

    const completeRes = await fetch('/api/passkeys/register/complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: bytesToB64url(credential.rawId),
        publicKey: bytesToB64url(credential.response.getPublicKey ? credential.response.getPublicKey() : credential.response.attestationObject),
        challenge: bytesToB64url(options.challenge),
        name: name,
      }),
    });

    if (!completeRes.ok) {
      const err = await completeRes.json();
      throw new Error(err.error || 'Registration failed');
    }

    status.className = 'status success';
    status.textContent = '';
    document.getElementById('success-check').classList.add('show');
    document.getElementById('skip-link').textContent = 'Continue to dashboard';
    btn.textContent = 'Register Another';
    btn.disabled = false;
    loadExisting();
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      status.className = 'status';
      status.textContent = 'Cancelled.';
    } else {
      status.className = 'status error';
      status.textContent = e.message;
    }
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.PublicKeyCredential) {
    document.getElementById('register-btn').disabled = true;
    document.getElementById('status').textContent = 'Passkeys are not supported in this browser.';
    document.getElementById('status').className = 'status error';
  }
  const btn = document.getElementById('register-btn');
  if (btn) btn.addEventListener('click', registerPasskey);
  loadExisting();
});
