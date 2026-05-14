/**
 * Dashboard login page — passkey button handler.
 *
 * Extracted from the LOGIN_HTML template in functions/dashboard/_middleware.js
 * so the page can ship with a strict Content-Security-Policy that does not
 * permit inline <script> blocks (script-src 'self').
 *
 * Served at /dashboard/login.js, bypassing the dashboard session check —
 * the login page itself is unauthenticated.
 */

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function b64urlToBytes(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}

async function loginWithPasskey() {
  try {
    const beginRes = await fetch('/api/passkeys/auth/begin', { method: 'POST' });
    if (!beginRes.ok) { alert('No passkeys registered.'); return; }
    const options = await beginRes.json();
    const originalChallenge = options.challenge;
    options.challenge = b64urlToBytes(options.challenge);
    if (options.allowCredentials) {
      options.allowCredentials = options.allowCredentials.map(c => ({
        ...c, id: b64urlToBytes(c.id),
      }));
    }
    const credential = await navigator.credentials.get({ publicKey: options });
    const completeRes = await fetch('/api/passkeys/auth/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credentialId: b64url(credential.rawId),
        challenge: originalChallenge,
        authenticatorData: b64url(credential.response.authenticatorData),
        signature: b64url(credential.response.signature),
        clientDataJSON: b64url(credential.response.clientDataJSON),
      }),
    });
    if (completeRes.ok) window.location.href = '/dashboard/';
    else alert('Passkey authentication failed.');
  } catch (e) {
    if (e.name !== 'NotAllowedError') alert('Passkey error: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('passkey-btn');
  if (btn) btn.addEventListener('click', loginWithPasskey);
});
