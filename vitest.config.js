import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['website/scripts/tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: [
        'website/scripts/convert.mjs',
        'website/scripts/generate-manifest.mjs',
        'website/scripts/sync-knowledge.mjs',
        'functions/api/chat.js',
        'functions/api/transform.js',
      ],
      all: false,
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
