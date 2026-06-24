#!/usr/bin/env node
/**
 * One-shot migration: legacy KV `tokens:registry` → D1 `api_keys`.
 *
 * Idempotent. Re-runs are no-ops.
 *
 * The existing functions/api/tokens.js stores admin API keys
 * (`cdnsk_*` prefix) in KV under `tokens:registry`. Phase 1 added a
 * multi-tenant D1 `api_keys` table seeded by sign-up. This script
 * folds the KV keys into D1 under a single "legacy" account so the
 * future validator path can authoritatively read from D1.
 *
 * Both `cdnsk_*` (KV) and `cdn_test_*` / `cdn_live_*` (D1) tokens use
 * the same SHA-256 hex hash format, so the `hash` field copies across
 * unchanged.
 *
 * Usage:
 *   CLOUDFLARE_ACCOUNT_ID=ef87c6c09467b62b6d2256d46c72dd30 \
 *     node scripts/migrate-legacy-tokens-to-d1.mjs --remote
 *
 *   --remote   talk to remote KV + D1 (default)
 *   --local    talk to the local wrangler dev store
 *   --dry-run  print what would happen, don't write anything
 */

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

// Fixed UUIDs so re-running this script never spawns new rows.
export const LEGACY_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";
export const LEGACY_USER_ID    = "00000000-0000-0000-0000-000000000002";
export const LEGACY_EMAIL      = "legacy@cloudcdn.pro";
export const LEGACY_ACCOUNT_NAME = "Legacy (pre-multi-tenant)";

const KV_BINDING  = "RATE_KV";
const KV_KEY      = "tokens:registry";
const D1_DATABASE = "cloudcdn-pro-accounts";

/**
 * Pure: convert one KV token entry to the parameter tuple for the
 * D1 `api_keys` INSERT. Exported for unit tests.
 */
export function legacyTokenToD1Row(t) {
  if (!t || typeof t !== "object") throw new TypeError("legacy token entry must be an object");
  if (!t.id || !t.prefix || !t.hash) throw new TypeError("legacy token missing id/prefix/hash");
  return {
    id: t.id,
    account_id: LEGACY_ACCOUNT_ID,
    name: String(t.name || "legacy"),
    prefix: t.prefix,
    hashed_secret: t.hash,
    scopes: JSON.stringify(Array.isArray(t.scopes) ? t.scopes : []),
    created_by_user_id: LEGACY_USER_ID,
    expires_at: t.expiresAt || null,
    created_at: t.createdAt || null,
    last_used_at: t.lastUsedAt || null,
  };
}

/**
 * Pure: build the idempotent SQL batch for `wrangler d1 execute --command`.
 * `INSERT OR IGNORE` keys off the primary key (id) and the UNIQUE prefix
 * — a second run with the same token entry is a no-op.
 */
export function buildMigrationSql(rows) {
  const stmts = [
    // Anchor rows: account, user, membership. Always present after
    // first run; INSERT OR IGNORE makes re-runs free.
    `INSERT OR IGNORE INTO users (id, email, email_verified_at, name) ` +
      `VALUES ('${LEGACY_USER_ID}', '${LEGACY_EMAIL}', strftime('%s','now'), 'Legacy admin');`,
    `INSERT OR IGNORE INTO accounts (id, name, plan) ` +
      `VALUES ('${LEGACY_ACCOUNT_ID}', '${escapeSqlString(LEGACY_ACCOUNT_NAME)}', 'legacy');`,
    `INSERT OR IGNORE INTO memberships (id, account_id, user_id, role) ` +
      `VALUES ('00000000-0000-0000-0000-000000000003', '${LEGACY_ACCOUNT_ID}', '${LEGACY_USER_ID}', 'owner');`,
  ];
  for (const r of rows) {
    const expiresClause = r.expires_at
      ? `strftime('%s', '${escapeSqlString(r.expires_at)}')`
      : "NULL";
    stmts.push(
      `INSERT OR IGNORE INTO api_keys ` +
      `(id, account_id, name, prefix, hashed_secret, scopes, created_by_user_id, expires_at) ` +
      `VALUES ('${escapeSqlString(r.id)}', '${r.account_id}', '${escapeSqlString(r.name)}', ` +
      `'${escapeSqlString(r.prefix)}', '${escapeSqlString(r.hashed_secret)}', ` +
      `'${escapeSqlString(r.scopes)}', '${r.created_by_user_id}', ${expiresClause});`,
    );
  }
  return stmts.join("\n");
}

// Single-quote escape for SQLite string literals (double up apostrophes).
// Inputs in this script come from a trusted KV registry the admin
// controls — this is belt-and-braces, not the only defence.
export function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

// ── IO layer (only exercised in the CLI path) ──────────────────────
/* v8 ignore start — execSync paths require a real wrangler + network;
   covered by the dry-run integration test on a developer machine. */

function readKvRegistry({ remote }) {
  const flag = remote ? "--remote" : "--local";
  let raw;
  try {
    raw = execSync(
      `npx wrangler kv key get "${KV_KEY}" --binding ${KV_BINDING} ${flag}`,
      { stdio: ["ignore", "pipe", "pipe"] },
    ).toString();
  } catch (err) {
    if (String(err.stderr || "").includes("not found")) return [];
    throw err;
  }
  try { return JSON.parse(raw); }
  catch { return []; }
}

function executeD1(sql, { remote, dryRun }) {
  if (dryRun) {
    console.log("--- dry-run: would execute on D1 ---");
    console.log(sql);
    return;
  }
  const flag = remote ? "--remote" : "--local";
  execSync(
    `npx wrangler d1 execute ${D1_DATABASE} ${flag} --command ${JSON.stringify(sql)}`,
    { stdio: "inherit" },
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      remote:    { type: "boolean", default: true  },
      local:     { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const remote = !values.local;
  const dryRun = values["dry-run"];

  console.log(`legacy-tokens migration — ${remote ? "remote" : "local"}${dryRun ? " (dry-run)" : ""}`);
  const tokens = readKvRegistry({ remote });
  console.log(`found ${tokens.length} legacy token(s) in KV`);
  if (tokens.length === 0) {
    console.log("nothing to migrate — exiting clean");
    return;
  }
  const rows = tokens.map(legacyTokenToD1Row);
  const sql = buildMigrationSql(rows);
  executeD1(sql, { remote, dryRun });
  console.log(`done — ${rows.length} row(s) staged (INSERT OR IGNORE is idempotent)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
/* v8 ignore stop */
