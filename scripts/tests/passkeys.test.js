import { describe, it, expect, vi } from 'vitest';

const passkeysModule = await import('../../functions/api/passkeys/index.js');
const {
  onRequestPost, onRequestGet, onRequestDelete, onRequestOptions,
  derEcdsaToRaw, importStoredPublicKey, verifyAssertion,
} = passkeysModule;

// ── helpers for WebAuthn assertion tests ──

function bytesToB64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Mint a P-256 keypair, build a clientDataJSON / authenticatorData / signature
 * triple that verifyAssertion will accept. Returns all the base64url strings
 * the handler expects plus the SPKI-exported public key so tests can drive
 * the verifier without depending on a real authenticator.
 */
async function mintAssertion({ origin = 'https://cloudcdn.pro', challenge = 'CHALLENGE' } = {}) {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keypair.publicKey));

  const clientData = JSON.stringify({ type: 'webauthn.get', challenge, origin });
  const clientDataBytes = new TextEncoder().encode(clientData);
  const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataBytes));

  // authenticatorData: 37 random bytes is the minimum (32-byte rpIdHash + 1
  // flags byte + 4-byte signCount). Real authenticators put a real rpIdHash
  // here; verifyAssertion doesn't currently re-check that, so any bytes work.
  const authData = new Uint8Array(37);
  crypto.getRandomValues(authData);

  const signedPayload = new Uint8Array(authData.length + clientDataHash.length);
  signedPayload.set(authData, 0);
  signedPayload.set(clientDataHash, authData.length);

  // WebCrypto returns the raw r||s; authenticators emit DER. Re-encode to DER
  // here so we exercise the verifier's DER → raw conversion path end-to-end.
  const rawSig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keypair.privateKey, signedPayload
  ));
  function rawToDer(rs) {
    const r = rs.slice(0, 32);
    const s = rs.slice(32, 64);
    function intBytes(b) {
      let i = 0;
      while (i < b.length - 1 && b[i] === 0) i++;
      const v = b.slice(i);
      // DER unsigned integer encoding: prepend 0x00 when high bit is set so
      // it doesn't get interpreted as negative.
      return v[0] & 0x80 ? new Uint8Array([0, ...v]) : v;
    }
    const rEnc = intBytes(r);
    const sEnc = intBytes(s);
    const total = 2 + rEnc.length + 2 + sEnc.length;
    const out = new Uint8Array(2 + total);
    out[0] = 0x30; out[1] = total;
    out[2] = 0x02; out[3] = rEnc.length; out.set(rEnc, 4);
    out[4 + rEnc.length] = 0x02; out[5 + rEnc.length] = sEnc.length;
    out.set(sEnc, 6 + rEnc.length);
    return out;
  }
  const derSig = rawToDer(rawSig);

  return {
    storedPublicKeyB64: bytesToB64url(spki),
    authenticatorDataB64: bytesToB64url(authData),
    signatureB64: bytesToB64url(derSig),
    clientDataJSONB64: bytesToB64url(clientDataBytes),
    expectedOrigin: origin,
    expectedChallengeB64: challenge,
  };
}

function makeKV(data = {}) {
  const store = { ...data };
  return {
    get: vi.fn(key => Promise.resolve(store[key] || null)),
    put: vi.fn((key, val) => { store[key] = val; return Promise.resolve(); }),
    delete: vi.fn(key => { delete store[key]; return Promise.resolve(); }),
  };
}

function makeCtx(path, method = 'POST', options = {}) {
  const h = new Headers();
  if (options.key) h.set('AccountKey', options.key);
  const kv = options.kv || makeKV();
  return {
    request: new Request(`https://cloudcdn.pro/api/passkeys${path}`, {
      method,
      headers: h,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    }),
    env: {
      ACCOUNT_KEY: options.accountKey ?? 'admin-key',
      RATE_KV: kv,
      DASHBOARD_SECRET: options.dashboardSecret ?? 'test-secret',
    },
  };
}

describe('Passkeys API', () => {
  describe('POST /api/passkeys/register/begin', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('/register/begin');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('returns challenge and options', async () => {
      const ctx = makeCtx('/register/begin', 'POST', { key: 'admin-key' });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      expect(json.rp.name).toBe('CloudCDN');
      expect(json.pubKeyCredParams).toBeInstanceOf(Array);
      expect(json.pubKeyCredParams.length).toBeGreaterThan(0);
    });

    it('issues stateless challenge without touching KV', async () => {
      const kv = makeKV();
      const ctx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const res = await onRequestPost(ctx);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      // No challenge KV writes — stateless model avoids the KV daily quota.
      const challengePuts = kv.put.mock.calls.filter(c => c[0].startsWith('passkeys:challenge:'));
      expect(challengePuts).toHaveLength(0);
    });
  });

  describe('POST /api/passkeys/register/complete', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('/register/complete', 'POST', { body: {} });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('rejects missing fields', async () => {
      const ctx = makeCtx('/register/complete', 'POST', { key: 'admin-key', body: {} });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects invalid challenge', async () => {
      const ctx = makeCtx('/register/complete', 'POST', {
        key: 'admin-key',
        body: { credentialId: 'cred-1', publicKey: 'pk-1', challenge: 'invalid' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('expired');
    });

    it('registers credential with valid challenge', async () => {
      const kv = makeKV();
      // Mint a real signed challenge via /register/begin
      const beginCtx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const beginRes = await onRequestPost(beginCtx);
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/register/complete', 'POST', {
        key: 'admin-key', kv,
        body: { credentialId: 'cred-1', publicKey: 'pk-1', challenge, name: 'My YubiKey' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });
  });

  describe('POST /api/passkeys/auth/begin', () => {
    it('returns challenge and allowed credentials', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1' }]) });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.challenge).toBeTruthy();
      expect(json.allowCredentials).toHaveLength(1);
      expect(json.allowCredentials[0].id).toBe('cred-1');
    });
  });

  describe('POST /api/passkeys/auth/complete', () => {
    it('rejects invalid challenge', async () => {
      const ctx = makeCtx('/auth/complete', 'POST', {
        body: { credentialId: 'cred-1', challenge: 'bad' },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
    });

    it('rejects unknown credential', async () => {
      const kv = makeKV({ 'passkeys:credentials': '[]' });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'unknown', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
    });

    it('authenticates with valid credential and sets session cookie', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const cookie = res.headers.get('Set-Cookie');
      expect(cookie).toContain('cdn_session=');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('still authenticates when KV.put fails on signCount update (best-effort)', async () => {
      // Simulate the production failure mode: KV is over its daily write
      // quota, so saveCredentials throws — but the user's passkey is real
      // and shouldn't be rejected because we couldn't bump a counter.
      const credsList = [{ credentialId: 'cred-1', signCount: 5 }];
      const failingKv = {
        get: vi.fn(async (key) => {
          if (key === 'passkeys:credentials') return JSON.stringify(credsList);
          return null;
        }),
        put: vi.fn(async (key) => {
          if (key === 'passkeys:credentials') throw new Error('KV put() limit exceeded for the day.');
        }),
      };

      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv: failingKv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv: failingKv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('Set-Cookie')).toContain('cdn_session=');
      // The failure is surfaced via header so it's visible in logs.
      expect(res.headers.get('X-Passkey-Counter-Save')).toContain('KV put() limit exceeded');
    });

    it('sets the session cookie with Path=/ so /api/passkeys/* sees it', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.headers.get('Set-Cookie')).toContain('Path=/');
    });

    it('rejects a challenge issued for the register flow (cross-flow replay defence)', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      // Mint a register-flow challenge
      const regCtx = makeCtx('/register/begin', 'POST', { key: 'admin-key', kv });
      const regRes = await onRequestPost(regCtx);
      const { challenge } = await regRes.json();

      // Try to use it on auth/complete — must fail
      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('expired');
    });
  });

  describe('POST unknown path', () => {
    it('returns 404 for unknown passkey endpoint', async () => {
      const ctx = makeCtx('/unknown', 'POST');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/passkeys', () => {
    it('returns 401 without AccountKey', async () => {
      const ctx = makeCtx('', 'GET');
      // GET handler needs to be called directly
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(401);
    });

    it('lists registered passkeys without publicKey', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([
        { id: 'p1', credentialId: 'c1', publicKey: 'secret-key', name: 'YubiKey', createdAt: '2026-01-01', lastUsedAt: null, signCount: 3 },
      ]) });
      const ctx = makeCtx('', 'GET', { key: 'admin-key', kv });
      const res = await onRequestGet(ctx);
      const json = await res.json();
      expect(json.Passkeys).toHaveLength(1);
      expect(json.Passkeys[0].name).toBe('YubiKey');
      expect(json.Passkeys[0].publicKey).toBeUndefined();
      expect(json.Passkeys[0].credentialId).toBeUndefined();
    });
  });

  describe('DELETE /api/passkeys', () => {
    it('removes a passkey', async () => {
      const kv = makeKV({ 'passkeys:credentials': JSON.stringify([{ id: 'p1', credentialId: 'c1' }]) });
      const ctx = makeCtx('?id=p1', 'DELETE', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(200);
    });

    it('returns 404 for unknown passkey', async () => {
      const kv = makeKV({ 'passkeys:credentials': '[]' });
      const ctx = makeCtx('?id=nope', 'DELETE', { key: 'admin-key', kv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(404);
    });
  });

  describe('OPTIONS', () => {
    it('returns 204', async () => {
      const res = await onRequestOptions();
      expect(res.status).toBe(204);
    });
  });

  describe('resilience against corrupt KV state', () => {
    it('authBegin returns empty allowCredentials when KV value is malformed JSON', async () => {
      const kv = makeKV({ 'passkeys:credentials': '{not-json' });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.allowCredentials).toEqual([]);
    });

    it('authBegin tolerates a non-array KV value (returns empty list)', async () => {
      const kv = makeKV({ 'passkeys:credentials': '{"oops":"object-not-array"}' });
      const ctx = makeCtx('/auth/begin', 'POST', { kv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.allowCredentials).toEqual([]);
    });

    it('POST returns JSON 500 (not a Worker crash) when a handler throws', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('kv backplane unreachable')),
        put: vi.fn().mockRejectedValue(new Error('kv backplane unreachable')),
      };
      const ctx = makeCtx('/auth/begin', 'POST', { kv: throwingKv });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
      expect(json.detail).toContain('kv backplane');
    });

    it('GET returns JSON 500 when getCredentials KV-reads throw', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('storage offline')),
      };
      const ctx = makeCtx('', 'GET', { key: 'admin-key', kv: throwingKv });
      const res = await onRequestGet(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
    });

    it('DELETE returns JSON 500 when KV throws mid-operation', async () => {
      const throwingKv = {
        get: vi.fn().mockRejectedValue(new Error('boom')),
      };
      const ctx = makeCtx('?id=p1', 'DELETE', { key: 'admin-key', kv: throwingKv });
      const res = await onRequestDelete(ctx);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Passkey handler failed');
    });

    it('POST routes to a JSON 404 for unknown passkey path', async () => {
      const ctx = makeCtx('/nope/unknown', 'POST');
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('Unknown passkey endpoint');
    });
  });

  describe('WebAuthn assertion verification (Sprint 12)', () => {
    it('verifies a valid ES256 assertion end-to-end', async () => {
      const v = await mintAssertion();
      const result = await verifyAssertion(v);
      expect(result.valid).toBe(true);
      expect(result.alg).toBe('ES256');
    });

    it('rejects an assertion with the wrong origin', async () => {
      const v = await mintAssertion({ origin: 'https://attacker.example' });
      const result = await verifyAssertion({ ...v, expectedOrigin: 'https://cloudcdn.pro' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('origin mismatch');
    });

    it('rejects an assertion with a mismatched challenge', async () => {
      const v = await mintAssertion({ challenge: 'CHALLENGE-A' });
      const result = await verifyAssertion({ ...v, expectedChallengeB64: 'CHALLENGE-B' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('challenge mismatch');
    });

    it('rejects an assertion whose clientData.type is not webauthn.get', async () => {
      const wrongClientData = bytesToB64url(new TextEncoder().encode(
        JSON.stringify({ type: 'webauthn.create', challenge: 'X', origin: 'https://cloudcdn.pro' })
      ));
      const v = await mintAssertion();
      const result = await verifyAssertion({ ...v, clientDataJSONB64: wrongClientData });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('unexpected type');
    });

    it('rejects a tampered signature', async () => {
      const v = await mintAssertion();
      // Flip a byte deep in the DER signature.
      const sigBytes = Uint8Array.from(atob(v.signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      sigBytes[sigBytes.length - 1] ^= 0xff;
      const result = await verifyAssertion({ ...v, signatureB64: bytesToB64url(sigBytes) });
      expect(result.valid).toBe(false);
      // Either the DER reparses to a bad signature (failed verification) or the
      // flipped byte breaks the DER structure entirely (verify threw). Both
      // are acceptable failure modes — what matters is `valid: false`.
    });

    it('rejects clientDataJSON that is not valid JSON', async () => {
      const v = await mintAssertion();
      const garbage = bytesToB64url(new TextEncoder().encode('not-json'));
      const result = await verifyAssertion({ ...v, clientDataJSONB64: garbage });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not valid UTF-8 JSON');
    });

    it('reports missing fields as a structured failure', async () => {
      const result = await verifyAssertion({});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing assertion fields');
    });

    it('returns the legacy-SPKI hint when the stored publicKey is not SPKI', async () => {
      const v = await mintAssertion();
      // Replace publicKey with random bytes that aren't valid SPKI.
      const garbage = bytesToB64url(crypto.getRandomValues(new Uint8Array(64)));
      const result = await verifyAssertion({ ...v, storedPublicKeyB64: garbage });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('legacy credential');
    });

    it('derEcdsaToRaw produces 64 bytes for a P-256 signature', async () => {
      // Minimal valid DER: 30 06 02 01 01 02 01 01 → r=1, s=1
      const der = new Uint8Array([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]);
      const raw = derEcdsaToRaw(der);
      expect(raw.length).toBe(64);
      expect(raw[31]).toBe(1); // r padded to 32 bytes, value at last position
      expect(raw[63]).toBe(1); // s same
    });

    it('derEcdsaToRaw strips the DER leading-zero padding byte', async () => {
      // r and s with high bit set, DER prepends 0x00
      const r = new Uint8Array([0x00, 0x80]);
      const s = new Uint8Array([0x00, 0x81]);
      const der = new Uint8Array([0x30, 0x08, 0x02, r.length, ...r, 0x02, s.length, ...s]);
      const raw = derEcdsaToRaw(der);
      expect(raw.length).toBe(64);
      expect(raw[31]).toBe(0x80);
      expect(raw[63]).toBe(0x81);
    });

    it('importStoredPublicKey returns null for non-SPKI bytes', async () => {
      const result = await importStoredPublicKey(new Uint8Array([1, 2, 3, 4]));
      expect(result).toBeNull();
    });
  });

  describe('authComplete with assertion verification', () => {
    it('accepts a valid assertion and reports verification=ES256', async () => {
      const v = await mintAssertion();
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{
          credentialId: 'cred-1', publicKey: v.storedPublicKeyB64, signCount: 0,
        }]),
      });

      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      // Re-mint assertion with the actual challenge issued by authBegin so
      // the clientData.challenge matches what the server signed.
      const real = await mintAssertion({ challenge });
      // Inject the same publicKey we stored, so the verifier looks it up correctly.
      kv.put('passkeys:credentials', JSON.stringify([{
        credentialId: 'cred-1', publicKey: real.storedPublicKeyB64, signCount: 0,
      }]));

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: {
          credentialId: 'cred-1',
          challenge,
          authenticatorData: real.authenticatorDataB64,
          signature: real.signatureB64,
          clientDataJSON: real.clientDataJSONB64,
        },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Passkey-Verification')).toBe('ES256');
      const json = await res.json();
      expect(json.verification).toBe('ES256');
    });

    it('rejects an assertion with origin mismatch (401)', async () => {
      // Mint an assertion claiming a different origin.
      const v = await mintAssertion({ origin: 'https://attacker.example' });
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{
          credentialId: 'cred-1', publicKey: v.storedPublicKeyB64, signCount: 0,
        }]),
      });

      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();
      const tampered = await mintAssertion({ origin: 'https://attacker.example', challenge });
      kv.put('passkeys:credentials', JSON.stringify([{
        credentialId: 'cred-1', publicKey: tampered.storedPublicKeyB64, signCount: 0,
      }]));

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: {
          credentialId: 'cred-1',
          challenge,
          authenticatorData: tampered.authenticatorDataB64,
          signature: tampered.signatureB64,
          clientDataJSON: tampered.clientDataJSONB64,
        },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('verification failed');
      expect(json.detail).toContain('origin mismatch');
    });

    it('falls through in legacy mode when assertion fields are omitted', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Passkey-Verification')).toBe('legacy');
    });

    it('accepts assertion with legacy (non-SPKI) stored publicKey and flags as legacy-spki', async () => {
      // Use 4 short random bytes — guaranteed to not parse as ES256 (P-256
      // SPKI is 91 bytes) or RS256 (much longer), so importStoredPublicKey
      // returns null and verifyAssertion reports the legacy-credential reason.
      const legacyKey = bytesToB64url(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{
          credentialId: 'cred-1', publicKey: legacyKey, signCount: 0,
        }]),
      });

      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();
      const real = await mintAssertion({ challenge });

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: {
          credentialId: 'cred-1',
          challenge,
          authenticatorData: real.authenticatorDataB64,
          signature: real.signatureB64,
          clientDataJSON: real.clientDataJSONB64,
        },
      });
      const res = await onRequestPost(ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Passkey-Verification')).toBe('legacy-spki');
      expect(res.headers.get('X-Passkey-Verification-Reason')).toContain('re-registration');
    });

    it('clears the stale Path=/dashboard cookie on successful login (Slice 2)', async () => {
      const kv = makeKV({
        'passkeys:credentials': JSON.stringify([{ credentialId: 'cred-1', signCount: 0 }]),
      });
      const beginRes = await onRequestPost(makeCtx('/auth/begin', 'POST', { kv }));
      const { challenge } = await beginRes.json();

      const ctx = makeCtx('/auth/complete', 'POST', {
        kv,
        body: { credentialId: 'cred-1', challenge },
      });
      const res = await onRequestPost(ctx);
      // Headers.append('Set-Cookie', ...) preserves multiple values; getSetCookie
      // returns the array in modern runtimes.
      const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('Set-Cookie')];
      const clearCookie = cookies.find(c => c.includes('Path=/dashboard') && c.includes('Max-Age=0'));
      expect(clearCookie).toBeTruthy();
    });
  });
});
