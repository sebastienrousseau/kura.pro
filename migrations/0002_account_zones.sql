-- account_zones — per-account zone metadata provisioned via the
-- onboarding wizard. Separate from the GitOps zones in
-- functions/api/core/zones.js (which are admin-bootstrapped tenant
-- pillars committed to git); this table is the multi-tenant
-- self-service surface that lands with Phase 0 onboarding.
--
-- Live edge-hostname routing is Phase 3 — for now the
-- `edge_hostname` column stores the aspirational hostname
-- (`<slug>.cdn.cloudcdn.pro`) and a `live` flag marks whether the
-- routing has been provisioned. Onboarding marks rows as not-live;
-- when the routing pipeline ships it flips the flag.
--
-- Apply with:
--   wrangler d1 execute cloudcdn-pro-accounts --remote --file migrations/0002_account_zones.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_zones (
  id                  TEXT PRIMARY KEY,
  account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,                       -- user-facing display name
  slug                TEXT NOT NULL,                       -- [a-z0-9-]{3,32}
  origin_url          TEXT NOT NULL,
  edge_hostname       TEXT NOT NULL,                       -- aspirational until live=1
  origin_status       TEXT,                                -- 'ok' | 'unreachable' | 'tls_error' | 'http_error:<code>'
  origin_checked_at   INTEGER,
  live                INTEGER NOT NULL DEFAULT 0,          -- 0 until Phase-3 routing provisions
  created_by_user_id  TEXT REFERENCES users(id),
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at          INTEGER,
  UNIQUE (account_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_account_zones_account  ON account_zones (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_zones_edge_hostname
  ON account_zones (lower(edge_hostname)) WHERE deleted_at IS NULL;
