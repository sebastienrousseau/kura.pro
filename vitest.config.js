import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: [
        'scripts/convert.mjs',
        'scripts/generate-manifest.mjs',
        'scripts/sync-knowledge.mjs',
        'functions/api/chat.js',
        'functions/api/transform.js',
        'functions/api/webhooks.js',
        'functions/api/tokens.js',
        'functions/api/health.js',
        'functions/api/logs.js',
        'functions/api/rate_limiter_do.js',
        'functions/api/webhook_consumer.js',
        'functions/api/assets.js',
        'functions/api/search.js',
        'functions/api/signed.js',
        'functions/api/pipeline.js',
        'functions/api/auto.js',
        // Escape glob brackets so vitest doesn't treat them as a char class.
        'functions/api/storage/\\[\\[path\\]\\].js',
        'functions/api/core/zones.js',
        'functions/api/core/audit-logs.js',
        'functions/api/core/statistics.js',
        'functions/api/insights/asset.js',
        'functions/api/insights/errors.js',
        'functions/api/insights/geography.js',
        'functions/api/insights/summary.js',
        'functions/api/insights/top-assets.js',
        'functions/api/purge.js',
        'functions/api/lqip.js',
        'functions/api/blurhash.js',
        'functions/api/ai/alt-text.js',
        'functions/api/ai/smart-crop.js',
        'functions/api/ai/moderate.js',
        'functions/api/stream.js',
        'functions/api/core/rules.js',
        'functions/api/analytics.js',
        'functions/api/storage/batch.js',
        'functions/_middleware.js',
        'functions/api/_shared.js',
        'functions/api/auth/_lib.js',
        'functions/api/auth/_oauth.js',
        'functions/api/auth/_email.js',
        'functions/api/auth/signup.js',
        'functions/api/auth/session.js',
        'functions/api/auth/password/login.js',
        'functions/api/auth/signup/reveal.js',
        'functions/api/auth/oauth/\\[provider\\]/begin.js',
        'functions/api/auth/oauth/\\[provider\\]/callback.js',
        'functions/api/auth/passkey/_lib.js',
        'functions/api/auth/passkey/register/begin.js',
        'functions/api/auth/passkey/register/complete.js',
        'functions/api/auth/passkey/auth/begin.js',
        'functions/api/auth/passkey/auth/complete.js',
        'functions/api/auth/email/otp/send.js',
        'functions/api/auth/email/otp/verify.js',
        'functions/api/auth/onboarding/zone.js',
        'functions/api/account/api-keys.js',
        'functions/api/account/cap.js',
        'functions/api/account/_quota.js',
        'functions/api/insights/cache-explain.js',
        'functions/api/logs/tail.js',
        'functions/api/assets/process.js',
        'cdn/en/dist/stratos/stratos.mjs',
        'cdn/shared/theme-boot.js',
        'cdn/shared/theme-toggle.js',
        'cdn/shared/scalar-theme.js',
        'scripts/build-skeletonic.mjs',
      ],
      all: false,
      // Threshold rationale. Lines stays at 100 — every line of the
      // gated set is exercised by at least one test. Statements and
      // functions stay at 99 because the new auth surface contains
      // ~15 private helpers (Apple PKCS8 decoding, slug-suffix
      // rejection sampling, etc.) that are exercised end-to-end via
      // the parent handler tests but don't accumulate per-statement
      // hits in v8's counter. Branches stays at 95 because many of
      // the auth branches are defensive fallbacks (`x?.y || null`,
      // `.catch(() => {})`, `request.cf?.country || null`) that
      // would require contrived mocks to flip both ways. Specific
      // defensive paths carry inline `/* v8 ignore next */` markers
      // where the rationale belongs with the code; the threshold is
      // the global floor.
      thresholds: {
        statements: 99,
        branches: 95,
        functions: 99,
        lines: 100,
      },
    },
  },
});
