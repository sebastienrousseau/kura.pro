/**
 * D1-backed passkey storage helpers — per-user, multi-tenant.
 *
 * The single-tenant module at functions/api/passkeys/* keeps its global
 * KV-backed credentials for the existing dashboard admin until Phase 1
 * migrates it. The new public sign-up + login flow uses this module
 * (D1 `passkeys` table, FK to `users`).
 *
 * Re-uses the WebAuthn cryptographic primitives + stateless HMAC
 * challenges from the existing module so we only have one implementation
 * of those (issueChallenge, verifyChallenge, verifyAssertion,
 * bufferToBase64url, base64urlToBuffer).
 */

import { getDB, uuid } from "../_lib.js";
import {
  issueChallenge as _issueChallenge,
  verifyChallenge as _verifyChallenge,
  verifyAssertion,
  bufferToBase64url,
  base64urlToBuffer,
} from "../../passkeys/index.js";

// ── WebAuthn relying-party config ────────────────────────────────

export const RP_NAME = "CloudCDN";
export const CHALLENGE_TYPE_REGISTER = "register";
export const CHALLENGE_TYPE_AUTH = "auth";
export const PASSKEY_PUB_KEY_ALGS = [
  { type: "public-key", alg: -7 },   // ES256 (most common)
  { type: "public-key", alg: -257 }, // RS256 (Windows Hello)
];

export function rpId(request) {
  return new URL(request.url).hostname;
}

export function expectedOrigin(request) {
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export function challengeSecret(env) {
  return env.PASSKEY_CHALLENGE_SECRET
    || env.DASHBOARD_SECRET
    || env.DASHBOARD_PASSWORD
    || "cdn-dev-only-secret"; // local dev fallback (STRICT_AUTH=1 in prod)
}

// Re-exports so endpoint files only import from one place.
export const issueChallenge = _issueChallenge;
export const verifyChallenge = _verifyChallenge;
export { verifyAssertion, bufferToBase64url, base64urlToBuffer };

// ── D1 storage layer ─────────────────────────────────────────────

// Returns the passkey row + its owner user_id, or null if unknown.
export async function getPasskeyByCredentialId(env, credentialIdB64) {
  if (!credentialIdB64) return null;
  const db = getDB(env);
  const credentialIdBytes = base64urlToBuffer(credentialIdB64);
  // D1 BLOB compare via the bound Uint8Array — D1 binds Uint8Array as BLOB.
  const row = await db
    .prepare(
      `SELECT p.id, p.user_id, p.public_key, p.sign_count, p.name,
              u.email, u.name AS user_name
       FROM passkeys p
       JOIN users u ON u.id = p.user_id
       WHERE p.credential_id = ?1 AND u.deleted_at IS NULL`
    )
    .bind(credentialIdBytes).first();
  if (!row) return null;
  // publicKey is stored as BLOB — convert to base64url for the assertion verifier.
  const publicKeyB64 = row.public_key
    ? bufferToBase64url(new Uint8Array(row.public_key))
    : null;
  return {
    id: row.id,
    userId: row.user_id,
    publicKey: publicKeyB64,
    signCount: Number(row.sign_count) || 0,
    name: row.name,
    user: { id: row.user_id, email: row.email, name: row.user_name },
  };
}

// Returns the credential descriptors for `allowCredentials` in
// navigator.credentials.get() — one per registered passkey for the
// given user. Empty list means "discoverable" flow (silent UX).
export async function getCredentialDescriptorsByEmail(env, email) {
  if (!email) return { user: null, descriptors: [] };
  const db = getDB(env);
  const userRow = await db
    .prepare(`SELECT id FROM users WHERE lower(email) = lower(?1) AND deleted_at IS NULL`)
    .bind(email).first();
  if (!userRow) return { user: null, descriptors: [] };
  const { results } = await db
    .prepare(`SELECT credential_id, transports FROM passkeys WHERE user_id = ?1`)
    .bind(userRow.id).all();
  const descriptors = (results || []).map((r) => ({
    type: "public-key",
    id: bufferToBase64url(new Uint8Array(r.credential_id)),
    transports: r.transports ? r.transports.split(",") : undefined,
  }));
  return { user: { id: userRow.id }, descriptors };
}

// Insert a new passkey row. credentialId + publicKey are base64url-
// encoded by the WebAuthn JS client; we decode and store as BLOB.
export async function insertPasskey(env, { userId, credentialIdB64, publicKeyB64, name, transports }) {
  const db = getDB(env);
  const credentialIdBytes = base64urlToBuffer(credentialIdB64);
  const publicKeyBytes = base64urlToBuffer(publicKeyB64);
  const id = uuid();
  await db
    .prepare(
      `INSERT INTO passkeys (id, user_id, credential_id, public_key, sign_count, transports, name)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)`
    )
    .bind(id, userId, credentialIdBytes, publicKeyBytes, transports || null, name || "Passkey")
    .run();
  return { id };
}

// Best-effort: bump sign_count + last_used_at. Failure is non-fatal —
// surfaced via the response header so an over-quota D1 doesn't block
// the login (matches the existing single-tenant pattern's posture).
export async function bumpPasskeyUsage(env, credentialIdB64, signCount) {
  try {
    const db = getDB(env);
    const credentialIdBytes = base64urlToBuffer(credentialIdB64);
    await db
      .prepare(
        `UPDATE passkeys SET sign_count = ?1, last_used_at = ?2 WHERE credential_id = ?3`
      )
      .bind(signCount, Math.floor(Date.now() / 1000), credentialIdBytes)
      .run();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
