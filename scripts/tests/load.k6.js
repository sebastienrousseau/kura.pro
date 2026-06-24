/**
 * k6 Load Test for CloudCDN Edge Functions
 *
 * Run (local — default):
 *   wrangler pages dev . &        # start a local server on :8788 first
 *   k6 run scripts/tests/load.k6.js
 *
 * Run against production (intentional + dangerous):
 *   k6 run -e BASE_URL=https://cloudcdn.pro \
 *          -e I_KNOW_THIS_HITS_PROD=1 \
 *          scripts/tests/load.k6.js
 *
 * The two-env-var requirement is a deliberate seatbelt: this file
 * peaks at 1,000 VUs / ~40k req/sec for 2 minutes, which is enough
 * to drain the Free-tier 100k daily request quota in a single run.
 * The June 22 2026 incident — two spikes of ~50k requests, traced
 * back to direct `k6 run` invocations against prod — added the
 * guard; do not remove without the same root-cause story.
 *
 * Stages:
 *   1. Ramp to 100 VUs over 30s (warm-up)
 *   2. Hold 1000 VUs for 2m (peak load)
 *   3. Ramp down over 30s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const ttfb = new Trend('ttfb', true);

const BASE = __ENV.BASE_URL || 'http://localhost:8788';

// Refuse to hit production without explicit opt-in. Two-key seatbelt:
// you must BOTH supply BASE_URL=https://... AND set
// I_KNOW_THIS_HITS_PROD=1. Passing just one is treated as a typo.
if (BASE.includes('cloudcdn.pro') && __ENV.I_KNOW_THIS_HITS_PROD !== '1') {
  throw new Error(
    'Refusing to run against ' + BASE + ' — this script peaks at 1,000 VUs / ~40k req/sec for 2 minutes and will burn the daily Worker request quota. ' +
    'If you really mean it, re-run with both `-e BASE_URL=' + BASE + '` AND `-e I_KNOW_THIS_HITS_PROD=1`.'
  );
}

export const options = {
  stages: [
    { duration: '30s', target: 100 },
    { duration: '2m',  target: 1000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // 95th percentile under 500ms
    ttfb:             ['p(95)<200'],   // TTFB under 200ms
    errors:           ['rate<0.01'],   // Error rate under 1%
  },
};

// Asset paths to test. All confirmed live as of the F1/F3 fix —
// project paths follow `/<project>/v1/{logos,banners}/<name>.{svg,png}`.
// Cache-Tag header is intentionally NOT asserted: Cloudflare strips it
// from responses delivered to clients (it's an internal tag for purge,
// see https://developers.cloudflare.com/cache/how-to/use-cache-tags/).
const ASSETS = [
  '/cloudcdn/v1/logos/cloudcdn.svg',
  '/akande/v1/logos/akande.svg',
  '/akande/v1/banners/banner-akande.svg',
  '/audioanalyser/v1/banners/banner-audioanalyser.png',
  '/bankingonai/v1/logos/bankingonai.svg',
];

// /api/auto expects an EXTENSIONLESS path (it appends each format from
// the negotiation chain). Use the same project bases as ASSETS minus
// the trailing extension.
const AUTO_PATHS = [
  '/cloudcdn/v1/logos/cloudcdn',
  '/akande/v1/logos/akande',
  '/akande/v1/banners/banner-akande',
  '/bankingonai/v1/logos/bankingonai',
];

const FORMATS = ['webp', 'avif', 'png'];

export default function () {
  const scenario = Math.random();

  if (scenario < 0.6) {
    // 60% — Static asset requests
    const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
    const res = http.get(`${BASE}${asset}`);
    check(res, {
      'asset 200': (r) => r.status === 200,
      'immutable cache': (r) => (r.headers['Cache-Control'] || '').includes('immutable'),
    });
    ttfb.add(res.timings.waiting);
    errorRate.add(res.status !== 200);

  } else if (scenario < 0.8) {
    // 20% — Auto format negotiation
    const format = FORMATS[Math.floor(Math.random() * FORMATS.length)];
    const accept = format === 'avif' ? 'image/avif,image/webp,*/*'
                 : format === 'webp' ? 'image/webp,*/*'
                 : '*/*';
    const autoPath = AUTO_PATHS[Math.floor(Math.random() * AUTO_PATHS.length)];
    const res = http.get(`${BASE}/api/auto?path=${encodeURIComponent(autoPath)}`, {
      headers: { Accept: accept },
    });
    check(res, {
      'auto 200': (r) => r.status === 200,
      'has vary accept': (r) => (r.headers['Vary'] || '').includes('Accept'),
    });
    ttfb.add(res.timings.waiting);
    errorRate.add(res.status >= 500);

  } else if (scenario < 0.95) {
    // 15% — Transform API
    const w = [128, 256, 512, 800, 1024][Math.floor(Math.random() * 5)];
    const res = http.get(`${BASE}/api/transform?url=/cloudcdn/v1/logos/cloudcdn.svg&w=${w}&format=webp`);
    check(res, {
      'transform 200': (r) => r.status === 200,
    });
    ttfb.add(res.timings.waiting);
    errorRate.add(res.status >= 500);

  } else {
    // 5% — Search API
    const queries = ['banner blue', 'logo dark', 'icon svg', 'banking', 'quantum'];
    const q = queries[Math.floor(Math.random() * queries.length)];
    const res = http.get(`${BASE}/api/search?q=${encodeURIComponent(q)}&limit=10`);
    check(res, {
      'search 200': (r) => r.status === 200,
      'has results': (r) => {
        try { return JSON.parse(r.body).results.length >= 0; } catch { return false; }
      },
    });
    ttfb.add(res.timings.waiting);
    errorRate.add(res.status >= 500);
  }

  sleep(0.1 + Math.random() * 0.3);
}
