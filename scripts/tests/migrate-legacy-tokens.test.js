/**
 * Unit tests for the pure transforms in
 * scripts/migrate-legacy-tokens-to-d1.mjs. The IO layer (execSync
 * against wrangler) is intentionally not unit-tested — it's marked
 * with a v8-ignore block in the source and covered by a manual
 * --dry-run rehearsal.
 */
import { describe, it, expect } from 'vitest';

const mod = await import('../../scripts/migrate-legacy-tokens-to-d1.mjs');

describe('legacyTokenToD1Row', () => {
  it('maps a typical KV token to a D1 row', () => {
    const row = mod.legacyTokenToD1Row({
      id: 'tok-abc',
      name: 'CI deploy bot',
      prefix: 'cdnsk_12345678',
      hash: 'a'.repeat(64),
      scopes: ['storage:write', 'purge:write'],
      createdAt: '2024-01-01T00:00:00Z',
      expiresAt: '2026-12-31T00:00:00Z',
      lastUsedAt: null,
    });
    expect(row.id).toBe('tok-abc');
    expect(row.account_id).toBe(mod.LEGACY_ACCOUNT_ID);
    expect(row.name).toBe('CI deploy bot');
    expect(row.prefix).toBe('cdnsk_12345678');
    expect(row.hashed_secret).toBe('a'.repeat(64));
    expect(JSON.parse(row.scopes)).toEqual(['storage:write', 'purge:write']);
    expect(row.created_by_user_id).toBe(mod.LEGACY_USER_ID);
    expect(row.expires_at).toBe('2026-12-31T00:00:00Z');
  });

  it('defaults a missing name to "legacy" and missing scopes to []', () => {
    const row = mod.legacyTokenToD1Row({
      id: 'tok-2',
      prefix: 'cdnsk_aaaaaaaa',
      hash: 'b'.repeat(64),
    });
    expect(row.name).toBe('legacy');
    expect(JSON.parse(row.scopes)).toEqual([]);
    expect(row.expires_at).toBeNull();
  });

  it('throws on a null entry', () => {
    expect(() => mod.legacyTokenToD1Row(null)).toThrow(/object/);
  });

  it('throws on an entry missing id/prefix/hash', () => {
    expect(() => mod.legacyTokenToD1Row({ id: 'x', prefix: 'p' })).toThrow(/missing/);
  });
});

describe('escapeSqlString', () => {
  it('doubles up single quotes', () => {
    expect(mod.escapeSqlString("O'Brien")).toBe("O''Brien");
  });

  it('leaves benign inputs unchanged', () => {
    expect(mod.escapeSqlString('hello world')).toBe('hello world');
  });

  it('coerces non-strings via String()', () => {
    expect(mod.escapeSqlString(42)).toBe('42');
  });
});

describe('buildMigrationSql', () => {
  it('emits the anchor rows + one INSERT per token', () => {
    const sql = mod.buildMigrationSql([
      mod.legacyTokenToD1Row({
        id: 'tok-x', prefix: 'cdnsk_00000000', hash: 'c'.repeat(64),
        scopes: ['read'], expiresAt: '2026-06-01T00:00:00Z',
      }),
    ]);
    expect(sql).toContain('INSERT OR IGNORE INTO users');
    expect(sql).toContain('INSERT OR IGNORE INTO accounts');
    expect(sql).toContain('INSERT OR IGNORE INTO memberships');
    expect(sql).toContain('INSERT OR IGNORE INTO api_keys');
    expect(sql).toContain("'tok-x'");
    expect(sql).toContain("'cdnsk_00000000'");
    expect(sql).toContain("strftime('%s', '2026-06-01T00:00:00Z')");
  });

  it('uses NULL for tokens without an expiry', () => {
    const sql = mod.buildMigrationSql([
      mod.legacyTokenToD1Row({
        id: 'tok-y', prefix: 'cdnsk_11111111', hash: 'd'.repeat(64),
      }),
    ]);
    // The NULL appears in the api_keys row's expires_at slot.
    expect(sql).toMatch(/INSERT OR IGNORE INTO api_keys[\s\S]+NULL\);/);
  });

  it('emits just the anchor rows for an empty token list', () => {
    const sql = mod.buildMigrationSql([]);
    expect(sql).toContain('INSERT OR IGNORE INTO users');
    expect(sql).not.toContain('INSERT OR IGNORE INTO api_keys');
  });

  it('escapes apostrophes in names', () => {
    const sql = mod.buildMigrationSql([
      mod.legacyTokenToD1Row({
        id: 'tok-z', prefix: 'cdnsk_22222222', hash: 'e'.repeat(64),
        name: "Bob's CI",
      }),
    ]);
    expect(sql).toContain("'Bob''s CI'");
  });
});

describe('exported anchor identifiers', () => {
  it('exposes stable UUIDs for re-runnability', () => {
    expect(mod.LEGACY_ACCOUNT_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(mod.LEGACY_USER_ID).toMatch(/^[0-9a-f-]{36}$/);
    expect(mod.LEGACY_ACCOUNT_ID).not.toBe(mod.LEGACY_USER_ID);
    expect(mod.LEGACY_EMAIL).toBe('legacy@cloudcdn.pro');
    expect(mod.LEGACY_ACCOUNT_NAME).toMatch(/legacy/i);
  });
});
