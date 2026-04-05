/**
 * k6 Load Test for CloudCDN Edge Functions
 *
 * Run: k6 run scripts/tests/load.k6.js
 * Override target: k6 run -e BASE_URL=https://cloudcdn.pro scripts/tests/load.k6.js
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

const BASE = __ENV.BASE_URL || 'https://cloudcdn.pro';

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

// Asset paths to test (mix of formats and sizes)
const ASSETS = [
  '/bankingonai/images/banners/banner-bankingonai.webp',
  '/shared/images/logos/cmn.svg',
  '/cloudcdn/v1/logos/logo.svg',
  '/shokunin/images/banners/banner-shokunin.avif',
  '/sebastienrousseau/images/banners/banner-sebastienrousseau.png',
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
      'has cache-tag': (r) => r.headers['Cache-Tag'] !== undefined,
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
    const res = http.get(`${BASE}/api/auto?path=/cloudcdn/v1/logos/logo`, {
      headers: { Accept: accept },
    });
    check(res, {
      'auto 200 or 404': (r) => r.status === 200 || r.status === 404,
      'has vary accept': (r) => (r.headers['Vary'] || '').includes('Accept'),
    });
    ttfb.add(res.timings.waiting);
    errorRate.add(res.status >= 500);

  } else if (scenario < 0.95) {
    // 15% — Transform API
    const w = [128, 256, 512, 800, 1024][Math.floor(Math.random() * 5)];
    const res = http.get(`${BASE}/api/transform?url=/cloudcdn/v1/logos/logo.svg&w=${w}&format=webp`);
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
