-- Phase 0 initial schema for the cloudcdn-pro-accounts D1 database.
--
-- One source of truth for users, accounts, sessions, OAuth identities,
-- passkeys, API keys, consents, signup attempts, email verification OTPs,
-- and the multi-tenant audit log. The existing KV-backed singletons in
-- tokens.js / passkeys/ / audit-logs.js continue to function unchanged
-- until Phase 1 migrates them in.
--
-- Apply with:
--   wrangler d1 execute cloudcdn-pro-accounts --remote --file migrations/0001_init.sql
-- Or for local dev:
--   wrangler d1 execute cloudcdn-pro-accounts --local --file migrations/0001_init.sql

PRAGMA foreign_keys = ON;

-- ── Users ──────────────────────────────────────────────────────────
-- id is a uuid (text) so it can be minted by the Pages worker without a
-- DB round-trip. Email is the natural login identifier; case-insensitive
-- via a lower(email) index. Soft-delete via deleted_at; reads filter it.
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  email_verified_at INTEGER,
  name              TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at     INTEGER,
  deleted_at        INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON users (lower(email)) WHERE deleted_at IS NULL;

-- Argon2id-encoded password (PHC string). Verified by the auth-hasher
-- Worker; never compared in the Pages runtime.
CREATE TABLE IF NOT EXISTS password_credentials (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hashed_password   TEXT NOT NULL,
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

-- OAuth identity links. A user may have one entry per provider.
CREATE TABLE IF NOT EXISTS oauth_identities (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('google', 'github', 'apple')),
  provider_user_id  TEXT NOT NULL,
  email             TEXT,
  raw_profile       TEXT,  -- JSON, useful for debugging linkage issues
  linked_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_identities (user_id);

-- Passkeys per user. Replaces the global passkeys:credentials KV blob
-- (functions/api/passkeys/index.js) once Phase 1 migrates the existing
-- admin passkeys in.
CREATE TABLE IF NOT EXISTS passkeys (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     BLOB NOT NULL UNIQUE,
  public_key        BLOB NOT NULL,
  sign_count        INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,    -- comma-separated: 'internal,hybrid,usb,nfc,ble'
  name              TEXT,    -- user-supplied label
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);

-- ── Accounts ───────────────────────────────────────────────────────
-- An account is the billing + permissions unit. Every new signup mints
-- both a user and a default account, with the user as the only member
-- (role=owner). monthly_cap_usd is Phase 2A's bill-predictability lever
-- — default 0 means "degrade-only, never bill overage".
CREATE TABLE IF NOT EXISTS accounts (
  id                TEXT PRIMARY KEY,
  owner_user_id     TEXT NOT NULL REFERENCES users(id),
  name              TEXT NOT NULL,
  plan              TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'business', 'legacy')),
  monthly_cap_usd   INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_accounts_owner ON accounts (owner_user_id);

-- Membership join table. Roles are deliberately simple in Phase 0;
-- richer permissions land in Phase 1.
CREATE TABLE IF NOT EXISTS memberships (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (user_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_account ON memberships (account_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user    ON memberships (user_id);

-- ── Sessions ───────────────────────────────────────────────────────
-- Opaque random token, SHA-256 hashed at rest. Trivial to revoke
-- (delete row) — preferable to JWT for a control plane this size.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash        TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id        TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at        INTEGER NOT NULL,
  ip                TEXT,
  user_agent        TEXT,
  revoked_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ── API keys ───────────────────────────────────────────────────────
-- Scoped to accounts, not users. SHA-256 hashed at rest; the prefix
-- (~14 chars) is kept in plaintext for human identification in lists.
CREATE TABLE IF NOT EXISTS api_keys (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  prefix              TEXT NOT NULL,
  hashed_secret       TEXT NOT NULL,
  scopes              TEXT NOT NULL,  -- JSON array of scope strings
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at        INTEGER,
  created_by_user_id  TEXT REFERENCES users(id),
  revoked_at          INTEGER,
  expires_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys (account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix  ON api_keys (prefix);

-- ── Consents (GDPR) ────────────────────────────────────────────────
-- One row per (user, type, version). Marketing consent is a separate
-- row from ToS — never bundled. Withdrawal sets withdrew_at; the
-- granted_at row is retained for the audit trail.
CREATE TABLE IF NOT EXISTS consents (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('tos', 'marketing', 'dpa', 'cookies')),
  granted_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  policy_version    TEXT NOT NULL,
  ip_country        TEXT,
  withdrew_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents (user_id);

-- ── Audit events ───────────────────────────────────────────────────
-- Persistent append-only event log. Replaces the KV-backed daily-bucket
-- log in functions/api/_shared.js once Phase 1 wires this in.
CREATE TABLE IF NOT EXISTS audit_events (
  id                TEXT PRIMARY KEY,
  account_id        TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  user_id           TEXT REFERENCES users(id)    ON DELETE SET NULL,
  action            TEXT NOT NULL,
  ip                TEXT,
  user_agent        TEXT,
  request_id        TEXT,
  meta              TEXT,  -- JSON, no secrets
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_account ON audit_events (account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_events (user_id,    created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_events (action,     created_at);

-- ── Signup attempts (anti-abuse telemetry) ─────────────────────────
-- Every signup POST writes one row regardless of outcome. Lets us tune
-- the anti-abuse score, surface spam waves, and back-fill defenses.
CREATE TABLE IF NOT EXISTS signup_attempts (
  id                TEXT PRIMARY KEY,
  email             TEXT,
  ip                TEXT,
  outcome           TEXT NOT NULL CHECK (outcome IN (
    'success', 'duplicate', 'rate_limited', 'bot_detected',
    'turnstile_fail', 'invalid', 'disposable_email', 'launch_gated'
  )),
  score             INTEGER,  -- composite anti-abuse heuristic score
  meta              TEXT,     -- JSON: per-signal breakdown
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_signup_email ON signup_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS idx_signup_ip    ON signup_attempts (ip,    created_at);

-- ── Email verification OTPs ────────────────────────────────────────
-- 6-digit numeric OTP, 10-min TTL, single-use, 5 attempts max per code.
-- The plaintext code never lands here — only its hash.
CREATE TABLE IF NOT EXISTS email_verifications (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  code_hash         TEXT NOT NULL,
  attempts          INTEGER NOT NULL DEFAULT 0,
  expires_at        INTEGER NOT NULL,
  consumed_at       INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_email_verif_email ON email_verifications (email, created_at);
